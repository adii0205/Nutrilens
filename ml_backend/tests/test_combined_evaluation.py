import json

import numpy as np
from PIL import Image

from ml_backend.meal.combined_evaluation import _partition, evaluate_region_verifier


class FakeEncoder:
    model_name = "fake"
    pretrained = "fixture"
    device = "cpu"
    effective_batch_size = 16

    def __init__(self, embeddings):
        self.embeddings = np.asarray(embeddings, dtype=np.float32)

    def encode(self, paths, batch_size):
        assert len(paths) == len(self.embeddings)
        return self.embeddings


def test_combined_partition_groups_adjacent_frames():
    assert _partition("20250616_150253") == _partition("20250616_150259")


def test_region_verifier_calibrates_and_reports_evaluation(tmp_path):
    crop_root = tmp_path / "regions"
    crop_root.mkdir()
    records = []
    embeddings = []
    for position in range(240):
        class_id = 1 if position % 2 == 0 else 2
        crop_name = f"{position}.png"
        Image.new("RGB", (4, 4), "white").save(crop_root / crop_name)
        records.append(
            {
                "cropPath": crop_name,
                "partition": "calibration" if position < 120 else "evaluation",
                "segmentClassId": class_id,
                "segmentConfidence": 0.95,
                "trueClassId": class_id,
            }
        )
        embeddings.append([1.0, 0.0] if class_id == 1 else [0.0, 1.0])
    manifest_path = crop_root / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "regions": records,
                "detection": {"calibration": {}, "evaluation": {}},
            }
        ),
        encoding="utf-8",
    )
    index_path = tmp_path / "index.npz"
    np.savez_compressed(
        index_path,
        embeddings=np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
        class_ids=np.asarray([1, 2], dtype=np.int32),
        class_names=np.asarray(["one", "two"]),
        prototype_paths=np.asarray(["one.png", "two.png"]),
        centroids=np.asarray([[1.0, 0.0], [0.0, 1.0]], dtype=np.float32),
        centroid_class_ids=np.asarray([1, 2], dtype=np.int32),
        centroid_class_names=np.asarray(["one", "two"]),
    )
    mapping_path = tmp_path / "mapping.json"
    mapping_path.write_text(
        json.dumps(
            {
                "mappings": {
                    "1": {"dishId": "one", "mappingType": "direct"},
                    "2": {"dishId": "two", "mappingType": "direct"},
                }
            }
        ),
        encoding="utf-8",
    )
    output_path = tmp_path / "report.json"

    report = evaluate_region_verifier(
        manifest_path,
        index_path,
        mapping_path,
        output_path,
        FakeEncoder(embeddings),
        target_precision=0.9,
    )

    assert report["evaluation"]["rawSegmentClassAccuracy"] == 1.0
    assert report["evaluation"]["verifiedPrecision"] == 1.0
    assert report["evaluation"]["verifiedCoverage"] == 1.0
    assert output_path.is_file()
