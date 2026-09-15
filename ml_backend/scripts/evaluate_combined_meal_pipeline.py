"""Evaluate predicted ITD regions and calibrate OpenCLIP verification."""

from __future__ import annotations

import argparse
from pathlib import Path

from ml_backend.meal.combined_evaluation import (
    build_predicted_region_crops,
    evaluate_region_verifier,
)
from ml_backend.meal.embedding_index import OpenClipImageEncoder


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--class-map", type=Path, required=True)
    parser.add_argument("--segmenter", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--crop-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--target-precision", type=float, default=0.90)
    args = parser.parse_args()

    manifest_path = args.crop_root / "manifest.json"
    if not manifest_path.is_file():
        manifest = build_predicted_region_crops(
            args.dataset_root,
            args.class_map,
            args.segmenter,
            args.crop_root,
            device=args.device,
            progress=lambda done, total, regions: print(
                f"Segmented {done}/{total} test images; saved {regions} regions",
                flush=True,
            ),
        )
        print(
            f"Prepared {manifest['predictedRegionCount']} predicted regions",
            flush=True,
        )
    else:
        print(f"Reusing {manifest_path}", flush=True)
    encoder = OpenClipImageEncoder(
        device=args.device,
        cache_dir=args.cache_dir,
        progress=lambda done, total, batch: (
            print(f"Encoded {done}/{total} regions", flush=True)
            if done == total or done % (batch * 10) == 0
            else None
        ),
    )
    report = evaluate_region_verifier(
        manifest_path,
        args.index,
        args.mapping,
        args.output,
        encoder,
        batch_size=args.batch_size,
        target_precision=args.target_precision,
    )
    result = report["evaluation"]
    print(
        f"Combined evaluation: raw={result['rawSegmentClassAccuracy']:.3f}, "
        f"verified={result['verifiedPrecision']:.3f}, "
        f"coverage={result['verifiedCoverage']:.3f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
