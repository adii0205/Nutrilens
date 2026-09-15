import json

import numpy as np
from PIL import Image

from ml_backend.meal.prototype_builder import (
    build_prototypes,
    expand_candidate_components,
    scan_candidates,
)


def _write_sample(root, split, stem, class_id, box):
    image_dir = root / split / "images"
    mask_dir = root / split / "masks"
    image_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)
    image = np.full((100, 120, 3), (30, 40, 50), dtype=np.uint8)
    mask = np.zeros((100, 120), dtype=np.uint8)
    x0, y0, x1, y1 = box
    image[y0:y1, x0:x1] = (180, 90, 30)
    mask[y0:y1, x0:x1] = class_id
    Image.fromarray(image).save(image_dir / f"{stem}_leftImg8bit.jpg")
    Image.fromarray(mask).save(mask_dir / f"{stem}_gtFine_labelIds.png")


def test_build_prototypes_uses_training_split_and_writes_manifest(tmp_path):
    dataset = tmp_path / "ITD"
    _write_sample(dataset, "train", "20250101_120001", 1, (10, 10, 80, 80))
    _write_sample(dataset, "test", "20250102_120001", 1, (5, 5, 90, 90))
    class_map = tmp_path / "index_map.json"
    class_map.write_text(json.dumps({"0": "background", "1": "rajma"}))
    output = tmp_path / "prototypes"

    manifest = build_prototypes(
        dataset,
        class_map,
        output,
        prototypes_per_class=2,
        min_area_pixels=100,
        min_side_pixels=10,
    )

    assert manifest["totalPrototypes"] == 1
    assert manifest["coveredClasses"] == 1
    assert "20250101_120001" in manifest["prototypes"][0]["sample_stem"]
    assert (output / manifest["prototypes"][0]["prototypePath"]).is_file()


def test_scan_candidates_reports_unknown_mask_ids(tmp_path):
    dataset = tmp_path / "ITD"
    _write_sample(dataset, "train", "20250101_120001", 9, (10, 10, 80, 80))

    candidates, unknown = scan_candidates(
        dataset,
        {0: "background", 1: "rajma"},
        min_area_pixels=100,
        min_side_pixels=10,
    )

    assert candidates == {}
    assert unknown == {9}


def test_disconnected_regions_become_separate_candidates(tmp_path):
    dataset = tmp_path / "ITD"
    image_dir = dataset / "train" / "images"
    mask_dir = dataset / "train" / "masks"
    image_dir.mkdir(parents=True)
    mask_dir.mkdir(parents=True)
    Image.fromarray(np.zeros((100, 120, 3), dtype=np.uint8)).save(
        image_dir / "20250101_120001_leftImg8bit.jpg"
    )
    mask = np.zeros((100, 120), dtype=np.uint8)
    mask[5:35, 5:35] = 1
    mask[60:95, 70:115] = 1
    Image.fromarray(mask).save(mask_dir / "20250101_120001_gtFine_labelIds.png")

    candidates, unknown = scan_candidates(
        dataset,
        {0: "background", 1: "rajma"},
        min_area_pixels=100,
        min_side_pixels=10,
    )
    components = expand_candidate_components(
        candidates,
        pool_per_class=10,
        min_area_pixels=100,
        min_side_pixels=10,
    )

    assert unknown == set()
    assert len(candidates[1]) == 1
    assert len(components[1]) == 2
    assert {candidate.component_index for candidate in components[1]} == {1, 2}
