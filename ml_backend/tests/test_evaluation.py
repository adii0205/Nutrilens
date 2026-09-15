import json

import numpy as np
from PIL import Image

from ml_backend.meal.evaluation import (
    build_evaluation_crops,
    calibrate_threshold,
    evaluate_recognition_index,
)


class FakeEncoder:
    model_name = "fake-evaluator"
    pretrained = "fixture"
    device = "cpu"

    def __init__(self, embeddings):
        self.embeddings = np.asarray(embeddings, dtype=np.float32)
        self.effective_batch_size = 4

    def encode(self, image_paths, batch_size):
        assert len(image_paths) == len(self.embeddings)
        return self.embeddings


def test_build_evaluation_crops_uses_test_components(tmp_path):
    dataset = tmp_path / "ITD"
    image_dir = dataset / "test" / "images"
    mask_dir = dataset / "test" / "masks"
    image_dir.mkdir(parents=True)
    mask_dir.mkdir(parents=True)
    stem = "sample_001"
    image = np.full((24, 32, 3), [40, 90, 140], dtype=np.uint8)
    mask = np.zeros((24, 32), dtype=np.uint8)
    mask[2:10, 2:10] = 1
    mask[13:22, 20:30] = 1
    Image.fromarray(image).save(image_dir / f"{stem}_leftImg8bit.jpg")
    Image.fromarray(mask).save(mask_dir / f"{stem}_gtFine_labelIds.png")
    class_map = tmp_path / "classes.json"
    class_map.write_text(json.dumps({"0": "background", "1": "rajma"}))

    manifest = build_evaluation_crops(
        dataset,
        class_map,
        tmp_path / "evaluation-crops",
        min_area_pixels=16,
        min_side_pixels=4,
        workers=1,
    )

    assert manifest["sourceImageCount"] == 1
    assert manifest["cropCount"] == 2
    assert {record["partition"] for record in manifest["crops"]} in (
        {"calibration"},
        {"evaluation"},
    )
    for record in manifest["crops"]:
        assert (tmp_path / "evaluation-crops" / record["cropPath"]).is_file()


def test_calibrate_threshold_maximizes_coverage_at_target_precision():
    result = calibrate_threshold(
        np.asarray([0.9, 0.8, 0.7, 0.6]),
        np.asarray([True, True, False, False]),
        target_precision=1.0,
        minimum_accepted=1,
    )

    assert result["threshold"] == 0.8
    assert result["acceptedCount"] == 2
    assert result["coverage"] == 0.5
    assert result["targetMet"] is True


def test_evaluate_index_uses_calibration_then_evaluation(tmp_path):
    crop_root = tmp_path / "crops"
    crop_root.mkdir()
    records = []
    embeddings = []
    for position in range(30):
        class_id = 1 if position % 2 == 0 else 2
        class_name = "rajma" if class_id == 1 else "rice"
        crop_path = f"crop_{position}.png"
        Image.new("RGB", (4, 4), "white").save(crop_root / crop_path)
        records.append(
            {
                "classId": class_id,
                "className": class_name,
                "sampleStem": f"sample_{position}",
                "cropPath": crop_path,
                "partition": "calibration" if position < 20 else "evaluation",
            }
        )
        embeddings.append([1.0, 0.02] if class_id == 1 else [0.02, 1.0])
    manifest_path = crop_root / "manifest.json"
    manifest_path.write_text(json.dumps({"crops": records}), encoding="utf-8")

    index_path = tmp_path / "index.npz"
    np.savez_compressed(
        index_path,
        embeddings=np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
        class_ids=np.asarray([1, 2], dtype=np.int32),
        class_names=np.asarray(["rajma", "rice"]),
        prototype_paths=np.asarray(["one.png", "two.png"]),
        centroids=np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
        centroid_class_ids=np.asarray([1, 2], dtype=np.int32),
        centroid_class_names=np.asarray(["rajma", "rice"]),
    )
    output_path = tmp_path / "report.json"

    report = evaluate_recognition_index(
        manifest_path,
        index_path,
        output_path,
        FakeEncoder(embeddings),
        batch_size=4,
        target_precision=0.9,
    )

    assert report["partitionCounts"] == {"calibration": 20, "evaluation": 10}
    assert report["selectedStrategy"] in {"centroid", "prototype_max"}
    assert report["strategyResults"]["centroid"]["evaluation"]["top1Accuracy"] == 1.0
    assert report["selectiveEvaluation"]["acceptedAccuracy"] == 1.0
    assert output_path.is_file()
