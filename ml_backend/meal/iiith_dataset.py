"""Validation helpers for the IIIT-H Indian Thali Dataset (ITD).

The dataset is intentionally kept under ``.ml_artifacts`` and never committed.
These checks fail early when an image, mask, or class-map entry is missing so
prototype generation cannot silently train on an incomplete split.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


IMAGE_SUFFIX = "_leftImg8bit.jpg"
MASK_SUFFIX = "_gtFine_labelIds.png"


@dataclass(frozen=True)
class SplitSummary:
    name: str
    image_count: int
    mask_count: int
    paired_count: int
    missing_masks: tuple[str, ...]
    missing_images: tuple[str, ...]

    @property
    def valid(self) -> bool:
        return not self.missing_masks and not self.missing_images


def _sample_stem(path: Path, suffix: str) -> str:
    if not path.name.endswith(suffix):
        raise ValueError(f"Unexpected ITD filename: {path.name}")
    return path.name[: -len(suffix)]


def inspect_split(dataset_root: Path, split: str) -> SplitSummary:
    split_root = dataset_root / split
    image_dir = split_root / "images"
    mask_dir = split_root / "masks"
    if not image_dir.is_dir() or not mask_dir.is_dir():
        raise FileNotFoundError(
            f"Expected {image_dir} and {mask_dir}; extract ITD.tar.gz first."
        )

    images = {
        _sample_stem(path, IMAGE_SUFFIX): path
        for path in image_dir.glob(f"*{IMAGE_SUFFIX}")
    }
    masks = {
        _sample_stem(path, MASK_SUFFIX): path
        for path in mask_dir.glob(f"*{MASK_SUFFIX}")
    }
    image_stems = set(images)
    mask_stems = set(masks)
    return SplitSummary(
        name=split,
        image_count=len(images),
        mask_count=len(masks),
        paired_count=len(image_stems & mask_stems),
        missing_masks=tuple(sorted(image_stems - mask_stems)),
        missing_images=tuple(sorted(mask_stems - image_stems)),
    )


def load_class_map(path: Path) -> dict[int, str]:
    with path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    class_map = {int(index): str(name) for index, name in raw.items()}
    if class_map.get(0) != "background":
        raise ValueError("IIIT-H class map must define label 0 as background.")
    expected = set(range(max(class_map) + 1))
    if set(class_map) != expected:
        raise ValueError("IIIT-H class-map IDs must be consecutive.")
    return class_map


def inspect_dataset(dataset_root: Path, class_map_path: Path) -> dict:
    splits = [inspect_split(dataset_root, name) for name in ("train", "test")]
    class_map = load_class_map(class_map_path)
    return {
        "valid": all(split.valid for split in splits),
        "dataset": "IIIT-H Indian Thali Dataset (ITD)",
        "datasetRoot": str(dataset_root.resolve()),
        "classMapPath": str(class_map_path.resolve()),
        "foregroundClassCount": len(class_map) - 1,
        "totalPairedImages": sum(split.paired_count for split in splits),
        "splits": [asdict(split) | {"valid": split.valid} for split in splits],
    }
