"""Held-out ITD crop generation, recognition evaluation, and calibration."""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

import cv2
import numpy as np
from PIL import Image

from ml_backend.meal.embedding_index import ImageEncoder, RecognitionIndex
from ml_backend.meal.iiith_dataset import IMAGE_SUFFIX, MASK_SUFFIX, load_class_map


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._& -]+", "_", value).strip() or "class"


def _partition(sample_stem: str, calibration_fraction: float) -> str:
    digest = hashlib.sha256(sample_stem.encode("utf-8")).digest()
    fraction = int.from_bytes(digest[:8], "big") / float(2**64)
    return "calibration" if fraction < calibration_fraction else "evaluation"


def build_evaluation_crops(
    dataset_root: Path,
    class_map_path: Path,
    output_root: Path,
    *,
    split: str = "test",
    min_area_pixels: int = 2_048,
    min_side_pixels: int = 48,
    padding: float = 0.08,
    calibration_fraction: float = 0.5,
    workers: int = 4,
    progress: Callable[[int, int], None] | None = None,
) -> dict:
    """Create masked connected-component crops from a held-out ITD split."""

    if split == "train":
        raise ValueError("Recognition evaluation must not use the training split.")
    if not 0 < calibration_fraction < 1:
        raise ValueError("calibration_fraction must be between zero and one.")
    if output_root.exists() and any(output_root.iterdir()):
        raise FileExistsError(
            f"Evaluation output is not empty: {output_root}. Choose a new directory."
        )

    class_map = load_class_map(class_map_path)
    mask_paths = sorted((dataset_root / split / "masks").glob(f"*{MASK_SUFFIX}"))
    image_dir = dataset_root / split / "images"
    if not mask_paths or not image_dir.is_dir():
        raise FileNotFoundError(f"No paired ITD data found for split '{split}'.")
    output_root.mkdir(parents=True, exist_ok=True)

    def process_mask(mask_path: Path) -> tuple[list[dict], set[int]]:
        sample_stem = mask_path.name[: -len(MASK_SUFFIX)]
        image_path = image_dir / f"{sample_stem}{IMAGE_SUFFIX}"
        if not image_path.is_file():
            raise FileNotFoundError(f"Missing paired ITD image: {image_path}")
        with Image.open(image_path) as source:
            image = np.asarray(source.convert("RGB"))
        with Image.open(mask_path) as source:
            semantic_mask = np.asarray(source.convert("L"))
        if image.shape[:2] != semantic_mask.shape:
            raise ValueError(f"Image and mask dimensions differ for {sample_stem}.")

        records: list[dict] = []
        unknown_ids: set[int] = set()
        for raw_class_id in np.unique(semantic_mask):
            class_id = int(raw_class_id)
            if class_id == 0:
                continue
            if class_id not in class_map:
                unknown_ids.add(class_id)
                continue
            component_count, labels = cv2.connectedComponents(
                (semantic_mask == class_id).astype(np.uint8), connectivity=8
            )
            for component_index in range(1, component_count):
                component = labels == component_index
                ys, xs = np.where(component)
                area = int(xs.size)
                if area < min_area_pixels:
                    continue
                x0, x1 = int(xs.min()), int(xs.max()) + 1
                y0, y1 = int(ys.min()), int(ys.max()) + 1
                if min(x1 - x0, y1 - y0) < min_side_pixels:
                    continue

                pad_x = round((x1 - x0) * padding)
                pad_y = round((y1 - y0) * padding)
                crop_x0, crop_x1 = max(0, x0 - pad_x), min(image.shape[1], x1 + pad_x)
                crop_y0, crop_y1 = max(0, y0 - pad_y), min(image.shape[0], y1 + pad_y)
                crop = image[crop_y0:crop_y1, crop_x0:crop_x1].copy()
                crop_mask = component[crop_y0:crop_y1, crop_x0:crop_x1]
                fill_colour = np.median(crop[crop_mask], axis=0).astype(np.uint8)
                crop[~crop_mask] = fill_colour

                relative_path = Path(
                    f"{class_id:02d}_{_safe_name(class_map[class_id])}"
                ) / f"{sample_stem}_c{component_index}.png"
                destination = output_root / relative_path
                destination.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(crop, mode="RGB").save(
                    destination, format="PNG", optimize=True
                )
                records.append(
                    {
                        "classId": class_id,
                        "className": class_map[class_id],
                        "sampleStem": sample_stem,
                        "componentIndex": component_index,
                        "bbox": [x0, y0, x1, y1],
                        "areaPixels": area,
                        "cropPath": relative_path.as_posix(),
                        "partition": _partition(sample_stem, calibration_fraction),
                    }
                )
        return records, unknown_ids

    records: list[dict] = []
    unknown_ids: set[int] = set()
    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        for position, (found, unknown) in enumerate(
            executor.map(process_mask, mask_paths), start=1
        ):
            records.extend(found)
            unknown_ids.update(unknown)
            if progress is not None:
                progress(position, len(mask_paths))
    if unknown_ids:
        raise ValueError(
            "ITD masks contain IDs missing from the class map: "
            + ", ".join(map(str, sorted(unknown_ids)))
        )
    if not records:
        raise ValueError("No evaluation crops passed the size filters.")

    counts = Counter(record["classId"] for record in records)
    partitions = Counter(record["partition"] for record in records)
    manifest = {
        "schemaVersion": "1.0.0",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceDataset": "IIIT-H Indian Thali Dataset (ITD)",
        "datasetRoot": str(dataset_root.resolve()),
        "classMapPath": str(class_map_path.resolve()),
        "split": split,
        "settings": {
            "minAreaPixels": min_area_pixels,
            "minSidePixels": min_side_pixels,
            "paddingFraction": padding,
            "calibrationFraction": calibration_fraction,
        },
        "sourceImageCount": len(mask_paths),
        "cropCount": len(records),
        "partitionCounts": dict(partitions),
        "perClassCounts": {str(key): value for key, value in sorted(counts.items())},
        "crops": records,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest


def _classification_metrics(
    scores: np.ndarray,
    true_ids: np.ndarray,
    class_ids: np.ndarray,
    class_names: Sequence[str],
) -> dict:
    order = np.argsort(-scores, axis=1, kind="stable")
    predicted_ids = class_ids[order[:, 0]]
    correct = predicted_ids == true_ids
    top_k = min(5, len(class_ids))
    top5 = np.any(class_ids[order[:, :top_k]] == true_ids[:, None], axis=1)
    per_class = {}
    recalls = []
    for class_id, class_name in zip(class_ids, class_names):
        members = true_ids == class_id
        support = int(members.sum())
        if support:
            accuracy = float(correct[members].mean())
            recalls.append(accuracy)
        else:
            accuracy = None
        per_class[str(int(class_id))] = {
            "name": str(class_name),
            "support": support,
            "top1Accuracy": round(accuracy, 6) if accuracy is not None else None,
        }
    return {
        "sampleCount": len(true_ids),
        "top1Accuracy": round(float(correct.mean()), 6),
        "top5Accuracy": round(float(top5.mean()), 6),
        "macroTop1Accuracy": round(float(np.mean(recalls)), 6),
        "perClass": per_class,
    }


def calibrate_threshold(
    confidence: np.ndarray,
    correct: np.ndarray,
    *,
    target_precision: float,
    minimum_accepted: int,
) -> dict:
    """Choose the lowest threshold meeting precision, maximizing coverage."""

    if not 0 < target_precision <= 1:
        raise ValueError("target_precision must be in (0, 1].")
    confidence = np.asarray(confidence, dtype=np.float32)
    correct = np.asarray(correct, dtype=bool)
    candidates = np.unique(confidence)
    options = []
    for threshold in candidates:
        accepted = confidence >= threshold
        count = int(accepted.sum())
        if count < minimum_accepted:
            continue
        precision = float(correct[accepted].mean())
        options.append(
            {
                "threshold": float(threshold),
                "acceptedCount": count,
                "coverage": count / len(confidence),
                "precision": precision,
                "targetMet": precision >= target_precision,
            }
        )
    if not options:
        raise ValueError("Not enough calibration samples for threshold selection.")
    feasible = [option for option in options if option["targetMet"]]
    if feasible:
        chosen = max(feasible, key=lambda item: (item["coverage"], item["precision"]))
    else:
        chosen = max(options, key=lambda item: (item["precision"], item["coverage"]))
    return {
        key: round(value, 6) if isinstance(value, float) else value
        for key, value in chosen.items()
    }


def _prediction_arrays(scores: np.ndarray, true_ids: np.ndarray, class_ids: np.ndarray):
    order = np.argsort(-scores, axis=1, kind="stable")
    top1_positions = order[:, 0]
    top2_positions = order[:, 1]
    predicted_ids = class_ids[top1_positions]
    top1_similarity = scores[np.arange(len(scores)), top1_positions]
    top2_similarity = scores[np.arange(len(scores)), top2_positions]
    return predicted_ids, top1_similarity, top1_similarity - top2_similarity


def evaluate_recognition_index(
    crop_manifest_path: Path,
    index_path: Path,
    output_path: Path,
    encoder: ImageEncoder,
    *,
    batch_size: int = 16,
    target_precision: float = 0.80,
) -> dict:
    """Evaluate strategies, calibrate confidence, and save an audit report."""

    manifest_bytes = crop_manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    records = list(manifest.get("crops", []))
    if not records:
        raise ValueError("Evaluation crop manifest contains no records.")
    crop_root = crop_manifest_path.parent
    image_paths = [crop_root / record["cropPath"] for record in records]
    missing = [str(path) for path in image_paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Missing evaluation crop: {missing[0]}")

    embeddings = encoder.encode(image_paths, batch_size)
    index = RecognitionIndex(index_path)
    true_ids = np.asarray([int(record["classId"]) for record in records])
    partitions = np.asarray([record["partition"] for record in records])
    calibration_mask = partitions == "calibration"
    evaluation_mask = partitions == "evaluation"
    if not calibration_mask.any() or not evaluation_mask.any():
        raise ValueError("Both calibration and evaluation partitions are required.")

    strategies = {}
    score_sets = {}
    for strategy in ("centroid", "prototype_max"):
        scores = index.score_batch(embeddings, strategy=strategy)
        score_sets[strategy] = scores
        strategies[strategy] = {
            "calibration": _classification_metrics(
                scores[calibration_mask],
                true_ids[calibration_mask],
                index.class_ids,
                index.class_names,
            ),
            "evaluation": _classification_metrics(
                scores[evaluation_mask],
                true_ids[evaluation_mask],
                index.class_ids,
                index.class_names,
            ),
        }
    selected_strategy = max(
        strategies,
        key=lambda name: (
            strategies[name]["calibration"]["top1Accuracy"],
            strategies[name]["calibration"]["top5Accuracy"],
        ),
    )
    scores = score_sets[selected_strategy]
    predicted_ids, similarities, margins = _prediction_arrays(
        scores, true_ids, index.class_ids
    )
    correct = predicted_ids == true_ids
    minimum_accepted = max(10, int(calibration_mask.sum() * 0.02))
    calibration_options = {}
    for method, confidence in (("similarity", similarities), ("margin", margins)):
        calibration_options[method] = calibrate_threshold(
            confidence[calibration_mask],
            correct[calibration_mask],
            target_precision=target_precision,
            minimum_accepted=minimum_accepted,
        )
    feasible_methods = [
        name for name, result in calibration_options.items() if result["targetMet"]
    ]
    method_pool = feasible_methods or list(calibration_options)
    confidence_method = max(
        method_pool,
        key=lambda name: (
            calibration_options[name]["coverage"],
            calibration_options[name]["precision"],
        ),
    )
    threshold_result = calibration_options[confidence_method]
    confidence = similarities if confidence_method == "similarity" else margins
    accepted = confidence >= threshold_result["threshold"]
    evaluated_acceptance = accepted & evaluation_mask
    accepted_count = int(evaluated_acceptance.sum())
    selective_evaluation = {
        "sampleCount": int(evaluation_mask.sum()),
        "acceptedCount": accepted_count,
        "rejectedCount": int(evaluation_mask.sum()) - accepted_count,
        "coverage": round(accepted_count / int(evaluation_mask.sum()), 6),
        "acceptedAccuracy": (
            round(float(correct[evaluated_acceptance].mean()), 6)
            if accepted_count
            else None
        ),
    }

    id_to_name = {
        int(class_id): str(name)
        for class_id, name in zip(index.class_ids, index.class_names)
    }
    predictions = []
    for position, record in enumerate(records):
        predictions.append(
            {
                "cropPath": record["cropPath"],
                "sampleStem": record["sampleStem"],
                "partition": record["partition"],
                "trueClassId": int(true_ids[position]),
                "trueClassName": record["className"],
                "predictedClassId": int(predicted_ids[position]),
                "predictedClassName": id_to_name[int(predicted_ids[position])],
                "top1Similarity": round(float(similarities[position]), 6),
                "margin": round(float(margins[position]), 6),
                "correct": bool(correct[position]),
                "accepted": bool(accepted[position]),
            }
        )

    report = {
        "schemaVersion": "1.0.0",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "cropManifest": str(crop_manifest_path.resolve()),
        "cropManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "recognitionIndex": str(index_path.resolve()),
        "model": {
            "architecture": encoder.model_name,
            "pretrained": encoder.pretrained,
            "device": encoder.device,
            "requestedBatchSize": batch_size,
            "effectiveBatchSize": getattr(encoder, "effective_batch_size", batch_size),
        },
        "partitionCounts": {
            "calibration": int(calibration_mask.sum()),
            "evaluation": int(evaluation_mask.sum()),
        },
        "strategyResults": strategies,
        "selectedStrategy": selected_strategy,
        "confidenceCalibration": {
            "scope": "in-distribution selective prediction",
            "targetPrecision": target_precision,
            "minimumAccepted": minimum_accepted,
            "options": calibration_options,
            "selectedMethod": confidence_method,
            "selectedThreshold": threshold_result["threshold"],
        },
        "selectiveEvaluation": selective_evaluation,
        "predictions": predictions,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
