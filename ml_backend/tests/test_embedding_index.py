import json

import numpy as np
from PIL import Image

from ml_backend.meal.embedding_index import RecognitionIndex, build_recognition_index


class FakeEncoder:
    model_name = "fake-test-encoder"
    pretrained = "fixture"
    device = "cpu"
    effective_batch_size = 4

    def __init__(self, embeddings):
        self.embeddings = np.asarray(embeddings, dtype=np.float32)

    def encode(self, image_paths, batch_size):
        assert len(image_paths) == len(self.embeddings)
        assert batch_size == 4
        return self.embeddings


def _write_manifest(tmp_path):
    root = tmp_path / "prototypes"
    root.mkdir()
    records = []
    embeddings = []
    classes = [
        (
            1,
            "rajma",
            [[1, 0], [0.99, 0.05], [0.98, -0.04], [0.97, 0.02], [1, 0.01], [-1, 0]],
        ),
        (
            2,
            "rice",
            [[0, 1], [0.04, 0.99], [-0.03, 0.98], [0.01, 1], [0.02, 0.97], [0, 1]],
        ),
    ]
    for class_id, class_name, class_embeddings in classes:
        for position, embedding in enumerate(class_embeddings):
            relative = f"{class_id}_{position}.png"
            Image.new("RGB", (8, 8), "white").save(root / relative)
            records.append(
                {
                    "class_id": class_id,
                    "class_name": class_name,
                    "prototypePath": relative,
                }
            )
            embeddings.append(embedding)
    manifest = root / "manifest.json"
    manifest.write_text(json.dumps({"prototypes": records}), encoding="utf-8")
    return manifest, embeddings


def test_build_filters_outlier_and_saves_loadable_index(tmp_path):
    manifest, embeddings = _write_manifest(tmp_path)
    output = tmp_path / "recognition_index_v1"

    metadata = build_recognition_index(
        manifest,
        output,
        FakeEncoder(embeddings),
        batch_size=4,
        minimum_similarity=0.6,
        minimum_keep=3,
    )

    assert metadata["inputPrototypeCount"] == 12
    assert metadata["retainedPrototypeCount"] == 11
    assert metadata["outlierCount"] == 1
    assert metadata["classCount"] == 2
    assert output.with_suffix(".npz").is_file()
    assert output.with_suffix(".json").is_file()

    index = RecognitionIndex(output.with_suffix(".npz"))
    results = index.search(np.asarray([1.0, 0.0]), top_k=2)
    assert results[0]["className"] == "rajma"
    assert results[0]["similarity"] > results[1]["similarity"]
    prototype_results = index.search(
        np.asarray([1.0, 0.0]), top_k=2, strategy="prototype_max"
    )
    assert prototype_results[0]["className"] == "rajma"


def test_search_rejects_wrong_embedding_dimension(tmp_path):
    manifest, embeddings = _write_manifest(tmp_path)
    output = tmp_path / "recognition_index_v1"
    build_recognition_index(
        manifest,
        output,
        FakeEncoder(embeddings),
        batch_size=4,
        minimum_keep=3,
    )

    index = RecognitionIndex(output.with_suffix(".npz"))
    try:
        index.search(np.asarray([1.0, 0.0, 0.0]))
        assert False, "Expected a dimension mismatch"
    except ValueError as exc:
        assert "dimension" in str(exc)

    try:
        index.search(np.asarray([1.0, 0.0]), strategy="unsupported")
        assert False, "Expected an unsupported strategy error"
    except ValueError as exc:
        assert "strategy" in str(exc)
