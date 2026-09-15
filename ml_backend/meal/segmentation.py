"""Lightweight semantic segmentation training and inference for ITD meals."""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

import numpy as np
import cv2
from PIL import Image

from ml_backend.meal.iiith_dataset import IMAGE_SUFFIX, MASK_SUFFIX, load_class_map


MODEL_ARCHITECTURE = "lraspp_mobilenet_v3_large"
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


@dataclass(frozen=True)
class SegmentationSample:
    stem: str
    image_path: Path
    mask_path: Path


@dataclass(frozen=True)
class SegmentedRegion:
    class_id: int
    class_name: str
    confidence: float
    bbox: tuple[int, int, int, int]
    area_pixels: int
    area_fraction: float
    mask: np.ndarray


@dataclass(frozen=True)
class SegmentationPrediction:
    label_map: np.ndarray
    regions: tuple[SegmentedRegion, ...]
    model_name: str
    image_size: tuple[int, int]


def _view_group(stem: str) -> str:
    """Group adjacent ITD frames captured within the same minute."""

    return stem[:13]


def _stable_validation_member(stem: str, validation_fraction: float) -> bool:
    digest = hashlib.sha256(_view_group(stem).encode("utf-8")).digest()
    fraction = int.from_bytes(digest[:8], "big") / float(2**64)
    return fraction < validation_fraction


def discover_segmentation_samples(
    dataset_root: Path,
    *,
    partition: str,
    validation_fraction: float = 0.15,
) -> list[SegmentationSample]:
    """Split ITD train by capture group so neighbouring views cannot leak."""

    if partition not in {"train", "validation"}:
        raise ValueError("partition must be 'train' or 'validation'.")
    if not 0 < validation_fraction < 1:
        raise ValueError("validation_fraction must be between zero and one.")
    image_dir = dataset_root / "train" / "images"
    mask_dir = dataset_root / "train" / "masks"
    samples = []
    for mask_path in sorted(mask_dir.glob(f"*{MASK_SUFFIX}")):
        stem = mask_path.name[: -len(MASK_SUFFIX)]
        is_validation = _stable_validation_member(stem, validation_fraction)
        if (partition == "validation") != is_validation:
            continue
        image_path = image_dir / f"{stem}{IMAGE_SUFFIX}"
        if not image_path.is_file():
            raise FileNotFoundError(f"Missing paired ITD image: {image_path}")
        samples.append(SegmentationSample(stem, image_path, mask_path))
    if not samples:
        raise ValueError(f"No ITD samples found for partition '{partition}'.")
    return samples


def _letterbox(
    image: Image.Image,
    mask: Image.Image,
    size: int,
) -> tuple[Image.Image, Image.Image]:
    width, height = image.size
    scale = size / max(width, height)
    resized = (max(1, round(width * scale)), max(1, round(height * scale)))
    image = image.resize(resized, Image.Resampling.BILINEAR)
    mask = mask.resize(resized, Image.Resampling.NEAREST)
    image_canvas = Image.new("RGB", (size, size), (124, 116, 104))
    mask_canvas = Image.new("L", (size, size), 0)
    offset = ((size - resized[0]) // 2, (size - resized[1]) // 2)
    image_canvas.paste(image, offset)
    mask_canvas.paste(mask, offset)
    return image_canvas, mask_canvas


class ITDSegmentationDataset:
    """Torch-compatible paired image/mask dataset with conservative augmentation."""

    def __init__(
        self,
        samples: Sequence[SegmentationSample],
        *,
        image_size: int = 384,
        augment: bool = False,
    ):
        self.samples = list(samples)
        self.image_size = image_size
        self.augment = augment

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        import torch
        from torchvision.transforms import functional as transform

        sample = self.samples[index]
        with Image.open(sample.image_path) as source:
            image = source.convert("RGB")
        with Image.open(sample.mask_path) as source:
            mask = source.convert("L")
        if image.size != mask.size:
            raise ValueError(f"Image and mask dimensions differ for {sample.stem}.")
        image, mask = _letterbox(image, mask, self.image_size)
        if self.augment and random.random() < 0.5:
            image = transform.hflip(image)
            mask = transform.hflip(mask)
        if self.augment:
            image = transform.adjust_brightness(image, random.uniform(0.85, 1.15))
            image = transform.adjust_contrast(image, random.uniform(0.85, 1.15))
            image = transform.adjust_saturation(image, random.uniform(0.85, 1.15))
        image_tensor = transform.normalize(
            transform.to_tensor(image), IMAGENET_MEAN, IMAGENET_STD
        )
        mask_tensor = torch.from_numpy(np.asarray(mask, dtype=np.uint8).copy()).long()
        return image_tensor, mask_tensor


def build_lraspp_model(num_classes: int, *, pretrained: bool = True):
    """Build LR-ASPP and replace its COCO head with the ITD class head."""

    import torch.nn as nn
    from torchvision.models.segmentation import (
        LRASPP_MobileNet_V3_Large_Weights,
        lraspp_mobilenet_v3_large,
    )

    if pretrained:
        model = lraspp_mobilenet_v3_large(
            weights=LRASPP_MobileNet_V3_Large_Weights.DEFAULT
        )
        low = model.classifier.low_classifier
        high = model.classifier.high_classifier
        model.classifier.low_classifier = nn.Conv2d(low.in_channels, num_classes, 1)
        model.classifier.high_classifier = nn.Conv2d(high.in_channels, num_classes, 1)
    else:
        model = lraspp_mobilenet_v3_large(
            weights=None,
            weights_backbone=None,
            num_classes=num_classes,
        )
    return model


def estimate_class_weights(
    mask_paths: Sequence[Path],
    num_classes: int,
    *,
    sample_size: int = 96,
) -> np.ndarray:
    """Estimate inverse-square-root pixel weights using cheap mask thumbnails."""

    counts = np.zeros(num_classes, dtype=np.int64)
    for mask_path in mask_paths:
        with Image.open(mask_path) as source:
            mask = source.convert("L").resize(
                (sample_size, sample_size), Image.Resampling.NEAREST
            )
        values = np.asarray(mask, dtype=np.uint8)
        if int(values.max()) >= num_classes:
            raise ValueError(f"Unexpected class ID in {mask_path}.")
        counts += np.bincount(values.ravel(), minlength=num_classes)
    frequencies = counts / max(1, counts.sum())
    weights = 1.0 / np.sqrt(np.maximum(frequencies, 1e-12))
    foreground = weights[1:]
    weights[1:] = np.clip(foreground / np.median(foreground), 0.25, 4.0)
    weights[0] = 0.20
    return weights.astype(np.float32)


def _metrics_from_confusion(confusion: np.ndarray) -> dict:
    true_pixels = confusion.sum(axis=1)
    predicted_pixels = confusion.sum(axis=0)
    intersection = np.diag(confusion)
    union = true_pixels + predicted_pixels - intersection
    present = union > 0
    foreground_present = present.copy()
    foreground_present[0] = False
    iou = np.divide(
        intersection,
        union,
        out=np.full_like(intersection, np.nan, dtype=np.float64),
        where=present,
    )
    return {
        "pixelAccuracy": round(float(intersection.sum() / max(1, confusion.sum())), 6),
        "meanIoU": round(float(np.nanmean(iou[present])), 6),
        "foregroundMeanIoU": round(
            float(np.nanmean(iou[foreground_present])), 6
        ),
        "perClassIoU": [round(float(value), 6) if not math.isnan(value) else None for value in iou],
    }


def _update_confusion(confusion: np.ndarray, truth, prediction, num_classes: int) -> None:
    truth_values = truth.detach().cpu().numpy().astype(np.int64).ravel()
    prediction_values = prediction.detach().cpu().numpy().astype(np.int64).ravel()
    valid = (truth_values >= 0) & (truth_values < num_classes)
    encoded = num_classes * truth_values[valid] + prediction_values[valid]
    confusion += np.bincount(encoded, minlength=num_classes**2).reshape(
        num_classes, num_classes
    )


def train_segmenter(
    dataset_root: Path,
    class_map_path: Path,
    output_dir: Path,
    *,
    image_size: int = 384,
    batch_size: int = 2,
    epochs: int = 8,
    learning_rate: float = 3e-4,
    validation_fraction: float = 0.15,
    workers: int = 2,
    device: str = "auto",
    pretrained: bool = True,
    resume_path: Path | None = None,
    max_train_batches: int | None = None,
    max_validation_batches: int | None = None,
    progress: Callable[[dict], None] | None = None,
) -> dict:
    """Train a checkpointed LR-ASPP baseline on ITD semantic masks."""

    import torch
    import torch.nn.functional as functional
    from torch.utils.data import DataLoader

    class_map_bytes = class_map_path.read_bytes()
    class_map = load_class_map(class_map_path)
    num_classes = len(class_map)
    resolved_device = "cuda" if device == "auto" and torch.cuda.is_available() else device
    if resolved_device == "auto":
        resolved_device = "cpu"
    if resolved_device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA was requested, but PyTorch cannot access the GPU.")

    train_samples = discover_segmentation_samples(
        dataset_root,
        partition="train",
        validation_fraction=validation_fraction,
    )
    validation_samples = discover_segmentation_samples(
        dataset_root,
        partition="validation",
        validation_fraction=validation_fraction,
    )
    train_dataset = ITDSegmentationDataset(
        train_samples, image_size=image_size, augment=True
    )
    validation_dataset = ITDSegmentationDataset(
        validation_samples, image_size=image_size, augment=False
    )
    loader_options = {
        "batch_size": batch_size,
        "num_workers": max(0, workers),
        "pin_memory": resolved_device == "cuda",
        "persistent_workers": workers > 0,
    }
    train_loader = DataLoader(train_dataset, shuffle=True, **loader_options)
    validation_loader = DataLoader(validation_dataset, shuffle=False, **loader_options)

    model = build_lraspp_model(num_classes, pretrained=pretrained)
    model.to(resolved_device)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=learning_rate, weight_decay=1e-4
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=max(1, epochs)
    )
    class_weights = estimate_class_weights(
        [sample.mask_path for sample in train_samples], num_classes
    )
    loss_weights = torch.from_numpy(class_weights).to(resolved_device)
    amp_enabled = resolved_device == "cuda"
    scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)
    if amp_enabled:
        torch.cuda.reset_peak_memory_stats()
    output_dir.mkdir(parents=True, exist_ok=True)
    start_epoch = 0
    best_foreground_miou = -1.0
    history = []
    if resume_path is not None:
        checkpoint = torch.load(resume_path, map_location=resolved_device, weights_only=False)
        model.load_state_dict(checkpoint["modelState"])
        optimizer.load_state_dict(checkpoint["optimizerState"])
        scheduler.load_state_dict(checkpoint["schedulerState"])
        start_epoch = int(checkpoint["epoch"])
        best_foreground_miou = float(checkpoint["bestForegroundMeanIoU"])
        history = list(checkpoint.get("history", []))

    for epoch_index in range(start_epoch, epochs):
        model.train()
        train_loss = 0.0
        train_batches = 0
        for batch_index, (images, masks) in enumerate(train_loader, start=1):
            if max_train_batches is not None and batch_index > max_train_batches:
                break
            images = images.to(resolved_device, non_blocking=True)
            masks = masks.to(resolved_device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(
                device_type=resolved_device,
                dtype=torch.float16,
                enabled=amp_enabled,
            ):
                logits = model(images)["out"]
                loss = functional.cross_entropy(logits, masks, weight=loss_weights)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            train_loss += float(loss.detach().cpu())
            train_batches += 1
            if progress is not None and (batch_index == 1 or batch_index % 25 == 0):
                progress(
                    {
                        "stage": "train",
                        "epoch": epoch_index + 1,
                        "epochs": epochs,
                        "batch": batch_index,
                        "batches": min(
                            len(train_loader), max_train_batches or len(train_loader)
                        ),
                        "loss": train_loss / train_batches,
                    }
                )

        model.eval()
        validation_loss = 0.0
        validation_batches = 0
        confusion = np.zeros((num_classes, num_classes), dtype=np.int64)
        with torch.inference_mode():
            for batch_index, (images, masks) in enumerate(validation_loader, start=1):
                if (
                    max_validation_batches is not None
                    and batch_index > max_validation_batches
                ):
                    break
                images = images.to(resolved_device, non_blocking=True)
                masks = masks.to(resolved_device, non_blocking=True)
                with torch.autocast(
                    device_type=resolved_device,
                    dtype=torch.float16,
                    enabled=amp_enabled,
                ):
                    logits = model(images)["out"]
                    loss = functional.cross_entropy(logits, masks, weight=loss_weights)
                prediction = logits.argmax(dim=1)
                _update_confusion(confusion, masks, prediction, num_classes)
                validation_loss += float(loss.detach().cpu())
                validation_batches += 1
        metrics = _metrics_from_confusion(confusion)
        epoch_record = {
            "epoch": epoch_index + 1,
            "learningRate": optimizer.param_groups[0]["lr"],
            "trainLoss": round(train_loss / max(1, train_batches), 6),
            "validationLoss": round(
                validation_loss / max(1, validation_batches), 6
            ),
            "peakGpuMemoryMb": (
                round(torch.cuda.max_memory_allocated() / 1024**2, 2)
                if amp_enabled
                else None
            ),
            **metrics,
        }
        history.append(epoch_record)
        scheduler.step()
        improved = metrics["foregroundMeanIoU"] > best_foreground_miou
        if improved:
            best_foreground_miou = metrics["foregroundMeanIoU"]
        checkpoint = {
            "schemaVersion": "1.0.0",
            "architecture": MODEL_ARCHITECTURE,
            "numClasses": num_classes,
            "imageSize": image_size,
            "classMapSha256": hashlib.sha256(class_map_bytes).hexdigest(),
            "classMap": class_map,
            "classWeights": class_weights.tolist(),
            "epoch": epoch_index + 1,
            "bestForegroundMeanIoU": best_foreground_miou,
            "modelState": model.state_dict(),
            "optimizerState": optimizer.state_dict(),
            "schedulerState": scheduler.state_dict(),
            "history": history,
        }
        torch.save(checkpoint, output_dir / "last.pt")
        if improved:
            torch.save(checkpoint, output_dir / "best.pt")
        (output_dir / "training_history.json").write_text(
            json.dumps(
                {
                    "schemaVersion": "1.0.0",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "architecture": MODEL_ARCHITECTURE,
                    "device": resolved_device,
                    "trainSampleCount": len(train_samples),
                    "validationSampleCount": len(validation_samples),
                    "settings": {
                        "imageSize": image_size,
                        "batchSize": batch_size,
                        "epochs": epochs,
                        "learningRate": learning_rate,
                        "validationFraction": validation_fraction,
                        "validationGrouping": "capture-minute view group",
                        "pretrained": pretrained,
                        "maxTrainBatches": max_train_batches,
                        "maxValidationBatches": max_validation_batches,
                    },
                    "bestForegroundMeanIoU": best_foreground_miou,
                    "history": history,
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        if progress is not None:
            progress({"stage": "epoch_complete", **epoch_record})
    return json.loads((output_dir / "training_history.json").read_text(encoding="utf-8"))


class ITDMealSegmenter:
    """Load a trained LR-ASPP checkpoint and propose labelled dish regions."""

    def __init__(
        self,
        checkpoint_path: Path,
        class_map_path: Path,
        *,
        device: str = "auto",
    ):
        import torch

        resolved_device = "cuda" if device == "auto" and torch.cuda.is_available() else device
        if resolved_device == "auto":
            resolved_device = "cpu"
        if resolved_device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested, but PyTorch cannot access the GPU.")
        checkpoint = torch.load(
            checkpoint_path, map_location=resolved_device, weights_only=False
        )
        if checkpoint.get("architecture") != MODEL_ARCHITECTURE:
            raise ValueError("Unsupported segmentation checkpoint architecture.")
        class_map_bytes = class_map_path.read_bytes()
        expected_hash = hashlib.sha256(class_map_bytes).hexdigest()
        if checkpoint.get("classMapSha256") != expected_hash:
            raise ValueError("Segmentation checkpoint and class map do not match.")
        self.class_map = load_class_map(class_map_path)
        self.image_size = int(checkpoint["imageSize"])
        self.device = resolved_device
        self._torch = torch
        self.model = build_lraspp_model(len(self.class_map), pretrained=False)
        self.model.load_state_dict(checkpoint["modelState"])
        self.model.eval().to(self.device)
        self.model_name = f"{MODEL_ARCHITECTURE}:epoch-{checkpoint['epoch']}"

    def predict(
        self,
        image: Image.Image,
        *,
        minimum_area_fraction: float = 0.001,
        minimum_area_pixels: int = 128,
    ) -> SegmentationPrediction:
        from torchvision.transforms import functional as transform

        image = image.convert("RGB")
        original_width, original_height = image.size
        blank_mask = Image.new("L", image.size, 0)
        prepared, _ = _letterbox(image, blank_mask, self.image_size)
        tensor = transform.normalize(
            transform.to_tensor(prepared), IMAGENET_MEAN, IMAGENET_STD
        ).unsqueeze(0).to(self.device)
        with self._torch.inference_mode(), self._torch.autocast(
            device_type=self.device,
            dtype=self._torch.float16,
            enabled=self.device == "cuda",
        ):
            logits = self.model(tensor)["out"][0]
            probabilities = logits.softmax(dim=0)
            confidence, labels = probabilities.max(dim=0)

        scale = self.image_size / max(original_width, original_height)
        resized_width = max(1, round(original_width * scale))
        resized_height = max(1, round(original_height * scale))
        offset_x = (self.image_size - resized_width) // 2
        offset_y = (self.image_size - resized_height) // 2
        labels = labels[
            offset_y : offset_y + resized_height,
            offset_x : offset_x + resized_width,
        ].byte().cpu().numpy()
        confidence = confidence[
            offset_y : offset_y + resized_height,
            offset_x : offset_x + resized_width,
        ].float().cpu().numpy()
        label_map = np.asarray(
            Image.fromarray(labels, mode="L").resize(
                (original_width, original_height), Image.Resampling.NEAREST
            ),
            dtype=np.uint8,
        )
        confidence_map = np.asarray(
            Image.fromarray(confidence, mode="F").resize(
                (original_width, original_height), Image.Resampling.BILINEAR
            ),
            dtype=np.float32,
        )

        image_area = original_width * original_height
        minimum_area = max(
            minimum_area_pixels, round(image_area * minimum_area_fraction)
        )
        regions = []
        for raw_class_id in np.unique(label_map):
            class_id = int(raw_class_id)
            if class_id == 0 or class_id not in self.class_map:
                continue
            component_count, component_labels = cv2.connectedComponents(
                (label_map == class_id).astype(np.uint8), connectivity=8
            )
            for component_index in range(1, component_count):
                component = component_labels == component_index
                ys, xs = np.where(component)
                area = int(xs.size)
                if area < minimum_area:
                    continue
                regions.append(
                    SegmentedRegion(
                        class_id=class_id,
                        class_name=self.class_map[class_id],
                        confidence=round(float(confidence_map[component].mean()), 6),
                        bbox=(
                            int(xs.min()),
                            int(ys.min()),
                            int(xs.max()) + 1,
                            int(ys.max()) + 1,
                        ),
                        area_pixels=area,
                        area_fraction=round(area / image_area, 6),
                        mask=component,
                    )
                )
        regions.sort(key=lambda region: region.area_pixels, reverse=True)
        return SegmentationPrediction(
            label_map=label_map,
            regions=tuple(regions),
            model_name=self.model_name,
            image_size=(original_width, original_height),
        )
