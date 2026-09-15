"""Run a trained ITD segmenter and save a visual prediction audit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from ml_backend.meal.segmentation import ITDMealSegmenter


def _palette(class_count: int) -> np.ndarray:
    generator = np.random.default_rng(2026)
    colours = generator.integers(40, 256, size=(class_count, 3), dtype=np.uint8)
    colours[0] = 0
    return colours


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--class-map", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    args = parser.parse_args()

    segmenter = ITDMealSegmenter(
        args.checkpoint, args.class_map, device=args.device
    )
    with Image.open(args.image) as source:
        image = source.convert("RGB")
    prediction = segmenter.predict(image)
    colours = _palette(len(segmenter.class_map))
    colour_mask = colours[prediction.label_map]
    overlay = (
        np.asarray(image, dtype=np.float32) * 0.58
        + colour_mask.astype(np.float32) * 0.42
    ).clip(0, 255).astype(np.uint8)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(colour_mask, mode="RGB").save(args.output_dir / "mask.png")
    Image.fromarray(overlay, mode="RGB").save(args.output_dir / "overlay.png")
    summary = {
        "schemaVersion": "1.0.0",
        "sourceImage": str(args.image.resolve()),
        "model": prediction.model_name,
        "imageSize": list(prediction.image_size),
        "regionCount": len(prediction.regions),
        "regions": [
            {
                "classId": region.class_id,
                "className": region.class_name,
                "confidence": region.confidence,
                "bbox": list(region.bbox),
                "areaPixels": region.area_pixels,
                "areaFraction": region.area_fraction,
            }
            for region in prediction.regions
        ],
    }
    (args.output_dir / "prediction.json").write_text(
        json.dumps(summary, indent=2), encoding="utf-8"
    )
    print(
        f"Saved {len(prediction.regions)} regions to {args.output_dir}", flush=True
    )


if __name__ == "__main__":
    main()
