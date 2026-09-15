"""End-to-end evaluation for predicted segmentation regions plus OpenCLIP."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import cv2
import numpy as np
from PIL import Image

from ml_backend.meal.embedding_index import ImageEncoder, RecognitionIndex
from ml_backend.meal.iiith_dataset import IMAGE_SUFFIX, MASK_SUFFIX, load_class_map
from ml_backend.meal.recognizer import _masked_region_crop
from ml_backend.meal.segmentation import ITDMealSegmenter


def _partition(stem: str, calibration_fraction: float = 0.5) -> str:
    digest = hashlib.sha256(stem[:13].encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big") / float(2**64)
    return "calibration" if value < calibration_fraction else "evaluation"


def build_predicted_region_crops(
    dataset_root: Path,
    class_map_path: Path,
    checkpoint_path: Path,
    output_root: Path,
    *,
    device: str = "auto",
    progress: Callable[[int, int, int], None] | None = None,
) -> dict:
    """Run the actual segmenter over ITD test images and persist its crops."""

    if output_root.exists() and any(output_root.iterdir()):
        raise FileExistsError(f"Combined evaluation output is not empty: {output_root}")
    output_root.mkdir(parents=True, exist_ok=True)
    class_map = load_class_map(class_map_path)
    segmenter = ITDMealSegmenter(checkpoint_path, class_map_path, device=device)
    image_paths = sorted((dataset_root / "test" / "images").glob(f"*{IMAGE_SUFFIX}"))
    mask_dir = dataset_root / "test" / "masks"
    if not image_paths:
        raise FileNotFoundError("No ITD test images were found.")

    records = []
    source_partition_counts = Counter()
    gt_components = Counter()
    detected_components = Counter()
    class_correct_components = Counter()
    for image_position, image_path in enumerate(image_paths, start=1):
        stem = image_path.name[: -len(IMAGE_SUFFIX)]
        partition = _partition(stem)
        source_partition_counts[partition] += 1
        mask_path = mask_dir / f"{stem}{MASK_SUFFIX}"
        if not mask_path.is_file():
            raise FileNotFoundError(f"Missing paired ITD mask: {mask_path}")
        with Image.open(image_path) as source:
            image = source.convert("RGB")
        with Image.open(mask_path) as source:
            truth = np.asarray(source.convert("L"), dtype=np.uint8)
        prediction = segmenter.predict(image)

        for region_index, region in enumerate(prediction.regions, start=1):
            truth_values = truth[region.mask]
            foreground_values = truth_values[truth_values != 0]
            if len(foreground_values):
                counts = np.bincount(foreground_values, minlength=len(class_map))
                true_class_id = int(np.argmax(counts))
                purity = float(counts[true_class_id] / len(truth_values))
            else:
                true_class_id = 0
                purity = 0.0
            relative_path = Path(f"{stem}/{region_index:02d}.png")
            destination = output_root / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            _masked_region_crop(image, region.mask, region.bbox).save(
                destination, format="PNG", optimize=True
            )
            records.append(
                {
                    "cropPath": relative_path.as_posix(),
                    "sampleStem": stem,
                    "partition": partition,
                    "segmentClassId": region.class_id,
                    "segmentClassName": region.class_name,
                    "segmentConfidence": region.confidence,
                    "areaFraction": region.area_fraction,
                    "trueClassId": true_class_id,
                    "trueClassName": class_map.get(true_class_id, "background"),
                    "groundTruthPurity": round(purity, 6),
                    "segmentClassCorrect": region.class_id == true_class_id,
                }
            )

        for raw_class_id in np.unique(truth):
            class_id = int(raw_class_id)
            if class_id == 0:
                continue
            component_count, labels = cv2.connectedComponents(
                (truth == class_id).astype(np.uint8), connectivity=8
            )
            for component_index in range(1, component_count):
                component = labels == component_index
                ys, xs = np.where(component)
                component_area = int(xs.size)
                if component_area < max(128, round(component.size * 0.001)):
                    continue
                gt_bbox = (
                    int(xs.min()),
                    int(ys.min()),
                    int(xs.max()) + 1,
                    int(ys.max()) + 1,
                )
                gt_components[partition] += 1
                best_iou = 0.0
                best_region = None
                for region in prediction.regions:
                    x0 = max(gt_bbox[0], region.bbox[0])
                    y0 = max(gt_bbox[1], region.bbox[1])
                    x1 = min(gt_bbox[2], region.bbox[2])
                    y1 = min(gt_bbox[3], region.bbox[3])
                    if x0 >= x1 or y0 >= y1:
                        continue
                    intersection = int(
                        np.logical_and(
                            component[y0:y1, x0:x1],
                            region.mask[y0:y1, x0:x1],
                        ).sum()
                    )
                    if not intersection:
                        continue
                    union = component_area + region.area_pixels - intersection
                    iou = intersection / union
                    if iou > best_iou:
                        best_iou = iou
                        best_region = region
                if best_iou >= 0.5:
                    detected_components[partition] += 1
                    if best_region is not None and best_region.class_id == class_id:
                        class_correct_components[partition] += 1
        if progress is not None and (
            image_position == len(image_paths) or image_position % 25 == 0
        ):
            progress(image_position, len(image_paths), len(records))

    manifest = {
        "schemaVersion": "1.0.0",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceImageCount": len(image_paths),
        "predictedRegionCount": len(records),
        "sourcePartitionCounts": dict(source_partition_counts),
        "detection": {
            partition: {
                "groundTruthComponents": gt_components[partition],
                "detectedAtIoU50": detected_components[partition],
                "classCorrectAtIoU50": class_correct_components[partition],
                "recallAtIoU50": round(
                    detected_components[partition] / max(1, gt_components[partition]), 6
                ),
                "classCorrectRecallAtIoU50": round(
                    class_correct_components[partition]
                    / max(1, gt_components[partition]),
                    6,
                ),
            }
            for partition in ("calibration", "evaluation")
        },
        "regions": records,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest


def evaluate_region_verifier(
    manifest_path: Path,
    index_path: Path,
    mapping_path: Path,
    output_path: Path,
    encoder: ImageEncoder,
    *,
    batch_size: int = 16,
    target_precision: float = 0.90,
) -> dict:
    """Calibrate OpenCLIP verification of semantic-segmentation suggestions."""

    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    records = list(manifest["regions"])
    crop_root = manifest_path.parent
    paths = [crop_root / record["cropPath"] for record in records]
    embeddings = encoder.encode(paths, batch_size)
    index = RecognitionIndex(index_path)
    scores = index.score_batch(embeddings, strategy="centroid")
    order = np.argsort(-scores, axis=1, kind="stable")
    class_ids = index.class_ids
    segment_ids = np.asarray([record["segmentClassId"] for record in records])
    true_ids = np.asarray([record["trueClassId"] for record in records])
    segment_confidence = np.asarray(
        [record["segmentConfidence"] for record in records], dtype=np.float32
    )
    correct = segment_ids == true_ids
    valid_truth = true_ids != 0
    partitions = np.asarray([record["partition"] for record in records])
    calibration = partitions == "calibration"
    evaluation = partitions == "evaluation"
    mappings = json.loads(mapping_path.read_text(encoding="utf-8"))["mappings"]
    mapped = np.asarray([str(class_id) in mappings for class_id in segment_ids])

    options = []
    for top_k in (1, 3, 5, 10):
        verified = np.any(
            class_ids[order[:, :top_k]] == segment_ids[:, None], axis=1
        )
        for threshold in np.unique(segment_confidence[calibration]):
            accepted = verified & (segment_confidence >= threshold)
            selected = accepted & calibration & valid_truth
            count = int(selected.sum())
            if count < 100:
                continue
            precision = float(correct[selected].mean())
            options.append(
                {
                    "topK": top_k,
                    "segmentConfidenceThreshold": float(threshold),
                    "acceptedCount": count,
                    "coverage": count / int((calibration & valid_truth).sum()),
                    "precision": precision,
                    "targetMet": precision >= target_precision,
                }
            )
    feasible = [option for option in options if option["targetMet"]]
    pool = feasible or options
    selected_option = max(
        pool, key=lambda option: (option["coverage"], option["precision"])
    )
    top_k = selected_option["topK"]
    threshold = selected_option["segmentConfidenceThreshold"]
    verified = np.any(class_ids[order[:, :top_k]] == segment_ids[:, None], axis=1)
    accepted = verified & (segment_confidence >= threshold)

    def metrics(mask: np.ndarray) -> dict:
        eligible = mask & valid_truth
        accepted_mask = eligible & accepted
        mapped_mask = eligible & mapped
        return {
            "regionCount": int(mask.sum()),
            "matchedGroundTruthCount": int(eligible.sum()),
            "rawSegmentClassAccuracy": round(float(correct[eligible].mean()), 6),
            "openClipTop1Accuracy": round(
                float((class_ids[order[:, 0]][eligible] == true_ids[eligible]).mean()),
                6,
            ),
            "verifiedAcceptedCount": int(accepted_mask.sum()),
            "verifiedCoverage": round(
                int(accepted_mask.sum()) / max(1, int(eligible.sum())), 6
            ),
            "verifiedPrecision": (
                round(float(correct[accepted_mask].mean()), 6)
                if accepted_mask.any()
                else None
            ),
            "mappedSuggestionCount": int(mapped_mask.sum()),
            "mappedSuggestionPrecision": (
                round(float(correct[mapped_mask].mean()), 6)
                if mapped_mask.any()
                else None
            ),
        }

    report = {
        "schemaVersion": "1.0.0",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "targetPrecision": target_precision,
        "calibrationOptionsEvaluated": len(options),
        "selectedVerification": {
            key: round(value, 6) if isinstance(value, float) else value
            for key, value in selected_option.items()
        },
        "calibration": metrics(calibration),
        "evaluation": metrics(evaluation),
        "detection": manifest["detection"],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
