import json

import pytest

from ml_backend.meal.iiith_dataset import inspect_dataset, inspect_split


def _touch_pair(root, split, stem, *, image=True, mask=True):
    image_dir = root / split / "images"
    mask_dir = root / split / "masks"
    image_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)
    if image:
        (image_dir / f"{stem}_leftImg8bit.jpg").touch()
    if mask:
        (mask_dir / f"{stem}_gtFine_labelIds.png").touch()


def test_inspect_dataset_reports_real_pairs_and_classes(tmp_path):
    dataset_root = tmp_path / "ITD"
    _touch_pair(dataset_root, "train", "plate-a")
    _touch_pair(dataset_root, "test", "plate-b")
    class_map = tmp_path / "index_map.json"
    class_map.write_text(
        json.dumps({"0": "background", "1": "rajma", "2": "steamed-rice"}),
        encoding="utf-8",
    )

    report = inspect_dataset(dataset_root, class_map)

    assert report["valid"] is True
    assert report["totalPairedImages"] == 2
    assert report["foregroundClassCount"] == 2


def test_inspect_split_detects_an_unpaired_image(tmp_path):
    dataset_root = tmp_path / "ITD"
    _touch_pair(dataset_root, "train", "plate-a", mask=False)

    report = inspect_split(dataset_root, "train")

    assert report.valid is False
    assert report.missing_masks == ("plate-a",)


def test_class_map_must_include_background(tmp_path):
    dataset_root = tmp_path / "ITD"
    _touch_pair(dataset_root, "train", "plate-a")
    _touch_pair(dataset_root, "test", "plate-b")
    class_map = tmp_path / "index_map.json"
    class_map.write_text(json.dumps({"0": "rajma"}), encoding="utf-8")

    with pytest.raises(ValueError, match="background"):
        inspect_dataset(dataset_root, class_map)
