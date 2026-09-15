"""Build a compact, reproducible prototype crop set from ITD ground-truth masks."""

from __future__ import annotations

import json
import math
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import cv2
from PIL import Image

from ml_backend.meal.iiith_dataset import IMAGE_SUFFIX, MASK_SUFFIX, load_class_map


@dataclass(frozen=True)
class PrototypeCandidate:
    class_id: int
    class_name: str
    component_index: int
    sample_stem: str
    image_path: str
    mask_path: str
    bbox: tuple[int, int, int, int]
    area_pixels: int
    area_fraction: float
    fill_ratio: float
    touches_edge: bool
    quality_score: float

    @property
    def view_group(self) -> str:
        # ITD filenames use YYYYMMDD_HHMMSS. Images captured within the same
        # minute are usually neighbouring views of one plate.
        return self.sample_stem[:13]


def _candidate_from_component(
    component: np.ndarray,
    class_id: int,
    class_name: str,
    component_index: int,
    sample_stem: str,
    image_path: Path,
    mask_path: Path,
    min_area_pixels: int,
    min_side_pixels: int,
) -> PrototypeCandidate | None:
    ys, xs = np.where(component)
    area = int(xs.size)
    if area < min_area_pixels:
        return None

    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    width, height = x1 - x0, y1 - y0
    if min(width, height) < min_side_pixels:
        return None

    image_area = int(component.shape[0] * component.shape[1])
    box_area = width * height
    fill_ratio = area / box_area
    area_fraction = area / image_area
    touches_edge = (
        x0 == 0
        or y0 == 0
        or x1 == component.shape[1]
        or y1 == component.shape[0]
    )
    edge_factor = 0.75 if touches_edge else 1.0
    quality_score = area_fraction * math.sqrt(fill_ratio) * edge_factor
    return PrototypeCandidate(
        class_id=class_id,
        class_name=class_name,
        component_index=component_index,
        sample_stem=sample_stem,
        image_path=str(image_path.resolve()),
        mask_path=str(mask_path.resolve()),
        bbox=(x0, y0, x1, y1),
        area_pixels=area,
        area_fraction=round(area_fraction, 8),
        fill_ratio=round(fill_ratio, 8),
        touches_edge=touches_edge,
        quality_score=round(quality_score, 8),
    )


def scan_candidates(
    dataset_root: Path,
    class_map: dict[int, str],
    *,
    min_area_pixels: int = 2_048,
    min_side_pixels: int = 48,
    workers: int = 4,
    progress: Callable[[int, int], None] | None = None,
) -> tuple[dict[int, list[PrototypeCandidate]], set[int]]:
    """Scan only the ITD training split and collect lightweight crop metadata."""

    mask_paths = sorted((dataset_root / "train" / "masks").glob(f"*{MASK_SUFFIX}"))
    image_dir = dataset_root / "train" / "images"
    candidates: dict[int, list[PrototypeCandidate]] = defaultdict(list)
    unexpected_ids: set[int] = set()

    def scan_mask(mask_path: Path) -> tuple[list[PrototypeCandidate], set[int]]:
        sample_stem = mask_path.name[: -len(MASK_SUFFIX)]
        image_path = image_dir / f"{sample_stem}{IMAGE_SUFFIX}"
        if not image_path.is_file():
            raise FileNotFoundError(f"Missing paired ITD image: {image_path}")

        with Image.open(mask_path) as image:
            mask = np.asarray(image.convert("L"))
        found: list[PrototypeCandidate] = []
        unknown: set[int] = set()
        for raw_class_id in np.unique(mask):
            class_id = int(raw_class_id)
            if class_id == 0:
                continue
            if class_id not in class_map:
                unknown.add(class_id)
                continue
            candidate = _candidate_from_component(
                mask == class_id,
                class_id,
                class_map[class_id],
                0,
                sample_stem,
                image_path,
                mask_path,
                min_area_pixels,
                min_side_pixels,
            )
            if candidate is not None:
                found.append(candidate)
        return found, unknown

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        results = executor.map(scan_mask, mask_paths)
        for position, (found, unknown) in enumerate(results, start=1):
            for candidate in found:
                candidates[candidate.class_id].append(candidate)
            unexpected_ids.update(unknown)
            if progress is not None:
                progress(position, len(mask_paths))

    return dict(candidates), unexpected_ids


def expand_candidate_components(
    candidates: dict[int, list[PrototypeCandidate]],
    *,
    pool_per_class: int,
    min_area_pixels: int,
    min_side_pixels: int,
) -> dict[int, list[PrototypeCandidate]]:
    """Split only the strongest candidate pool into contiguous regions.

    Running connected-components for every class in every full-resolution mask
    is unnecessarily expensive. The inexpensive semantic-mask scan ranks a
    larger pool first; precise component analysis is then limited to that pool.
    """

    expanded: dict[int, list[PrototypeCandidate]] = defaultdict(list)
    for class_id, class_candidates in candidates.items():
        pool = sorted(
            class_candidates,
            key=lambda item: (-item.quality_score, item.sample_stem),
        )[:pool_per_class]
        for candidate in pool:
            with Image.open(candidate.mask_path) as source_mask:
                semantic_mask = np.asarray(source_mask.convert("L"))
            component_count, component_labels = cv2.connectedComponents(
                (semantic_mask == class_id).astype(np.uint8), connectivity=8
            )
            for component_index in range(1, component_count):
                component_candidate = _candidate_from_component(
                    component_labels == component_index,
                    class_id,
                    candidate.class_name,
                    component_index,
                    candidate.sample_stem,
                    Path(candidate.image_path),
                    Path(candidate.mask_path),
                    min_area_pixels,
                    min_side_pixels,
                )
                if component_candidate is not None:
                    expanded[class_id].append(component_candidate)
    return dict(expanded)


def select_candidates(
    candidates: dict[int, list[PrototypeCandidate]],
    *,
    prototypes_per_class: int = 25,
    max_per_view_group: int = 1,
) -> dict[int, list[PrototypeCandidate]]:
    """Choose high-quality crops while limiting near-duplicate plate views."""

    selected: dict[int, list[PrototypeCandidate]] = {}
    for class_id, class_candidates in candidates.items():
        ordered = sorted(
            class_candidates,
            key=lambda item: (-item.quality_score, item.sample_stem),
        )
        group_counts: dict[str, int] = defaultdict(int)
        chosen: list[PrototypeCandidate] = []
        for candidate in ordered:
            if group_counts[candidate.view_group] >= max_per_view_group:
                continue
            chosen.append(candidate)
            group_counts[candidate.view_group] += 1
            if len(chosen) == prototypes_per_class:
                break
        selected[class_id] = chosen
    return selected


def _save_masked_crop(candidate: PrototypeCandidate, output_path: Path, padding: float) -> None:
    with Image.open(candidate.image_path) as source_image:
        image = np.asarray(source_image.convert("RGB"))
    with Image.open(candidate.mask_path) as source_mask:
        semantic_mask = np.asarray(source_mask.convert("L"))
    _, component_labels = cv2.connectedComponents(
        (semantic_mask == candidate.class_id).astype(np.uint8), connectivity=8
    )
    mask = component_labels == candidate.component_index

    x0, y0, x1, y1 = candidate.bbox
    pad_x = round((x1 - x0) * padding)
    pad_y = round((y1 - y0) * padding)
    x0, x1 = max(0, x0 - pad_x), min(image.shape[1], x1 + pad_x)
    y0, y1 = max(0, y0 - pad_y), min(image.shape[0], y1 + pad_y)
    crop = image[y0:y1, x0:x1].copy()
    crop_mask = mask[y0:y1, x0:x1]
    foreground = crop[crop_mask]
    fill_colour = np.median(foreground, axis=0).astype(np.uint8)
    crop[~crop_mask] = fill_colour
    output_path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(crop, mode="RGB").save(output_path, format="PNG", optimize=True)


def build_prototypes(
    dataset_root: Path,
    class_map_path: Path,
    output_root: Path,
    *,
    prototypes_per_class: int = 25,
    max_per_view_group: int = 1,
    min_area_pixels: int = 2_048,
    min_side_pixels: int = 48,
    padding: float = 0.08,
    workers: int = 4,
    progress: Callable[[int, int], None] | None = None,
) -> dict:
    """Create class folders and a manifest; refuses to overwrite existing data."""

    if output_root.exists() and any(output_root.iterdir()):
        raise FileExistsError(
            f"Prototype output is not empty: {output_root}. Choose a new directory."
        )
    class_map = load_class_map(class_map_path)
    candidates, unexpected_ids = scan_candidates(
        dataset_root,
        class_map,
        min_area_pixels=min_area_pixels,
        min_side_pixels=min_side_pixels,
        workers=workers,
        progress=progress,
    )
    if unexpected_ids:
        raise ValueError(
            "ITD masks contain IDs missing from the released class map: "
            + ", ".join(map(str, sorted(unexpected_ids)))
        )

    component_candidates = expand_candidate_components(
        candidates,
        pool_per_class=max(prototypes_per_class * 4, prototypes_per_class),
        min_area_pixels=min_area_pixels,
        min_side_pixels=min_side_pixels,
    )
    selected = select_candidates(
        component_candidates,
        prototypes_per_class=prototypes_per_class,
        max_per_view_group=max_per_view_group,
    )
    output_root.mkdir(parents=True, exist_ok=True)
    records: list[dict] = []
    for class_id in sorted(selected):
        class_name = class_map[class_id]
        for rank, candidate in enumerate(selected[class_id], start=1):
            relative_path = Path(f"{class_id:02d}_{class_name}") / (
                f"{rank:03d}_{candidate.sample_stem}_c{candidate.component_index}.png"
            )
            _save_masked_crop(candidate, output_root / relative_path, padding)
            records.append(
                asdict(candidate)
                | {"rank": rank, "prototypePath": relative_path.as_posix()}
            )

    per_class = {
        str(class_id): {
            "name": class_map[class_id],
            "candidateCount": len(component_candidates.get(class_id, [])),
            "prototypeCount": len(selected.get(class_id, [])),
        }
        for class_id in sorted(class_id for class_id in class_map if class_id != 0)
    }
    manifest = {
        "schemaVersion": "1.0.0",
        "sourceDataset": "IIIT-H Indian Thali Dataset (ITD) training split",
        "classMapPath": str(class_map_path.resolve()),
        "settings": {
            "prototypesPerClass": prototypes_per_class,
            "maxPerViewGroup": max_per_view_group,
            "minAreaPixels": min_area_pixels,
            "minSidePixels": min_side_pixels,
            "paddingFraction": padding,
        },
        "totalPrototypes": len(records),
        "coveredClasses": sum(value["prototypeCount"] > 0 for value in per_class.values()),
        "perClass": per_class,
        "prototypes": records,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    return manifest
