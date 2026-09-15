"""Replaceable image-recognition boundary for Indian meal inference."""

from __future__ import annotations

import io
import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class RecognitionAttempt:
    status: str
    model_loaded: bool
    model_name: str | None
    confidence: float | None
    predictions: tuple = ()
    message: str = ""


class UnavailableMealRecognizer:
    """Honest fallback until a validated Indian-food model is installed.

    Mean colour and ImageNet labels are not reliable evidence for recognising
    individual foods in a thali, so this adapter deliberately abstains.
    """

    model_loaded = False
    model_name = None

    def predict(self, image_bytes: bytes) -> RecognitionAttempt:
        del image_bytes
        return RecognitionAttempt(
            status="model_not_available",
            model_loaded=False,
            model_name=None,
            confidence=None,
            predictions=(),
            message=(
                "No validated Indian-dish recognition model is installed yet. "
                "Select the foods visible in the image to calculate an estimate."
            ),
        )


def _masked_region_crop(image: Image.Image, mask: np.ndarray, bbox) -> Image.Image:
    pixels = np.asarray(image.convert("RGB"))
    x0, y0, x1, y1 = bbox
    pad_x = round((x1 - x0) * 0.08)
    pad_y = round((y1 - y0) * 0.08)
    x0, x1 = max(0, x0 - pad_x), min(pixels.shape[1], x1 + pad_x)
    y0, y1 = max(0, y0 - pad_y), min(pixels.shape[0], y1 + pad_y)
    crop = pixels[y0:y1, x0:x1].copy()
    crop_mask = mask[y0:y1, x0:x1]
    foreground = crop[crop_mask]
    if not len(foreground):
        raise ValueError("Segmentation region contains no pixels.")
    crop[~crop_mask] = np.median(foreground, axis=0).astype(np.uint8)
    return Image.fromarray(crop, mode="RGB")


class OpenClipMealRecognizer:
    """Lazy segmentation plus OpenCLIP verifier for user-editable suggestions."""

    model_loaded = True
    model_name = "ITD-LRASPP-OpenCLIP-v1"

    def __init__(
        self,
        *,
        segmenter_checkpoint: Path,
        recognition_index: Path,
        class_map_path: Path,
        mapping_path: Path,
        calibration_path: Path,
        openclip_cache_dir: Path,
        device: str = "auto",
    ):
        self.segmenter_checkpoint = segmenter_checkpoint
        self.recognition_index = recognition_index
        self.class_map_path = class_map_path
        self.mapping_path = mapping_path
        self.calibration_path = calibration_path
        self.openclip_cache_dir = openclip_cache_dir
        self.device = device
        self._lock = threading.Lock()
        self._runtime = None

    def _ensure_runtime(self):
        if self._runtime is not None:
            return self._runtime
        with self._lock:
            if self._runtime is None:
                from ml_backend.meal.embedding_index import (
                    OpenClipImageEncoder,
                    RecognitionIndex,
                )
                from ml_backend.meal.segmentation import ITDMealSegmenter

                mapping = json.loads(self.mapping_path.read_text(encoding="utf-8"))[
                    "mappings"
                ]
                calibration = json.loads(
                    self.calibration_path.read_text(encoding="utf-8")
                )
                self._runtime = (
                    ITDMealSegmenter(
                        self.segmenter_checkpoint,
                        self.class_map_path,
                        device=self.device,
                    ),
                    OpenClipImageEncoder(
                        device=self.device,
                        cache_dir=self.openclip_cache_dir,
                    ),
                    RecognitionIndex(self.recognition_index),
                    mapping,
                    calibration,
                )
        return self._runtime

    def predict(self, image_bytes: bytes) -> RecognitionAttempt:
        with Image.open(io.BytesIO(image_bytes)) as source:
            image = source.convert("RGB")
        if min(image.size) < 64:
            return RecognitionAttempt(
                status="low_confidence",
                model_loaded=True,
                model_name=self.model_name,
                confidence=None,
                message="The meal image is too small for reliable dish suggestions.",
            )

        segmenter, encoder, index, mapping, calibration = self._ensure_runtime()
        segmentation = segmenter.predict(image)
        if not segmentation.regions:
            return RecognitionAttempt(
                status="low_confidence",
                model_loaded=True,
                model_name=self.model_name,
                confidence=None,
                message="No sufficiently large dish regions were detected.",
            )
        crops = [
            _masked_region_crop(image, region.mask, region.bbox)
            for region in segmentation.regions
        ]
        embeddings = encoder.encode_images(crops, batch_size=16)
        strategy = calibration["selection"]["strategy"]
        verification = calibration["combinedVerification"]
        verifier_top_k = int(verification["clipVerifierTopK"])
        segment_threshold = float(verification["segmentConfidenceThreshold"])
        scores = index.score_batch(embeddings, strategy=strategy)
        order = np.argsort(-scores, axis=1, kind="stable")
        predictions = []
        for position, region in enumerate(segmentation.regions):
            ranked_ids = index.class_ids[
                order[position, :verifier_top_k]
            ].tolist()
            clip_top1_position = int(order[position, 0])
            clip_top2_position = int(order[position, 1])
            clip_top1_id = int(index.class_ids[clip_top1_position])
            clip_margin = float(
                scores[position, clip_top1_position]
                - scores[position, clip_top2_position]
            )
            mapped = mapping.get(str(region.class_id))
            verified = (
                region.confidence >= segment_threshold
                and region.class_id in ranked_ids
            )
            if mapped is None or not verified:
                continue
            predictions.append(
                {
                    "classId": region.class_id,
                    "className": region.class_name,
                    "dishId": mapped["dishId"],
                    "mappingType": mapped["mappingType"],
                    "confidence": region.confidence,
                    "areaFraction": region.area_fraction,
                    "clipTop1ClassId": clip_top1_id,
                    "clipTop1ClassName": str(
                        index.class_names[clip_top1_position]
                    ),
                    "clipMargin": round(clip_margin, 6),
                    "clipVerifierRank": (
                        ranked_ids.index(region.class_id) + 1
                        if region.class_id in ranked_ids
                        else None
                    ),
                    "verified": verified,
                }
            )
        if not predictions:
            return RecognitionAttempt(
                status="low_confidence",
                model_loaded=True,
                model_name=self.model_name,
                confidence=None,
                message=(
                    "Dish regions were detected, but none has a safe nutrition-profile mapping."
                ),
            )
        confidence = float(np.mean([item["confidence"] for item in predictions]))
        return RecognitionAttempt(
            status="recognized",
            model_loaded=True,
            model_name=self.model_name,
            confidence=round(confidence, 6),
            predictions=tuple(predictions),
            message=(
                f"Detected {len(segmentation.regions)} regions and mapped "
                f"{len(predictions)} calibrated, OpenCLIP-verified suggestions "
                "to nutrition profiles. Confirm every dish and portion."
            ),
        )


def create_default_meal_recognizer():
    """Use local generated artifacts when available, otherwise abstain."""

    enabled = os.getenv("NUTRILENS_MEAL_MODEL_ENABLED", "auto").casefold()
    if enabled in {"0", "false", "no", "off"}:
        return UnavailableMealRecognizer()
    project_root = Path(__file__).resolve().parents[2]
    paths = {
        "segmenter_checkpoint": project_root
        / ".ml_artifacts/models/iiith/segmenter_lraspp_grouped_v1/best.pt",
        "recognition_index": project_root
        / ".ml_artifacts/models/iiith/recognition_index_v1.npz",
        "class_map_path": project_root / "ml_backend/data/iiith_itd_class_map.json",
        "mapping_path": project_root / "ml_backend/data/iiith_to_nutrition_map.json",
        "calibration_path": project_root
        / "ml_backend/data/iiith_recognition_calibration_v1.json",
        "openclip_cache_dir": project_root / ".ml_artifacts/models/openclip/cache",
    }
    required = [value for key, value in paths.items() if key != "openclip_cache_dir"]
    if not all(path.is_file() for path in required):
        return UnavailableMealRecognizer()
    return OpenClipMealRecognizer(**paths)
