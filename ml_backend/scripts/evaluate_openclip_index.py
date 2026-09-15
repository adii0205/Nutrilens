"""Build held-out ITD crops and evaluate the OpenCLIP recognition index."""

from __future__ import annotations

import argparse
from pathlib import Path

from ml_backend.meal.embedding_index import (
    DEFAULT_MODEL_NAME,
    DEFAULT_PRETRAINED,
    OpenClipImageEncoder,
)
from ml_backend.meal.evaluation import (
    build_evaluation_crops,
    evaluate_recognition_index,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--class-map", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--crop-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--pretrained", default=DEFAULT_PRETRAINED)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--target-precision", type=float, default=0.80)
    args = parser.parse_args()

    manifest_path = args.crop_root / "manifest.json"
    if manifest_path.is_file():
        print(f"Reusing evaluation crops from {manifest_path}", flush=True)
    else:
        manifest = build_evaluation_crops(
            args.dataset_root,
            args.class_map,
            args.crop_root,
            workers=args.workers,
            progress=lambda position, total: print(
                f"Prepared crops from {position}/{total} test images",
                flush=True,
            )
            if position == total or position % 100 == 0
            else None,
        )
        print(
            f"Saved {manifest['cropCount']} held-out crops: "
            f"{json.dumps(manifest['partitionCounts'], sort_keys=True)}",
            flush=True,
        )

    encoder = OpenClipImageEncoder(
        model_name=args.model,
        pretrained=args.pretrained,
        device=args.device,
        cache_dir=args.cache_dir,
        progress=lambda position, total, batch: print(
            f"Encoded {position}/{total} evaluation crops (batch size {batch})",
            flush=True,
        )
        if position == total or position % 160 == 0
        else None,
    )
    report = evaluate_recognition_index(
        manifest_path,
        args.index,
        args.output,
        encoder,
        batch_size=args.batch_size,
        target_precision=args.target_precision,
    )
    selected = report["selectedStrategy"]
    metrics = report["strategyResults"][selected]["evaluation"]
    selective = report["selectiveEvaluation"]
    print(
        f"Selected {selected}: top-1={metrics['top1Accuracy']:.3f}, "
        f"top-5={metrics['top5Accuracy']:.3f}, "
        f"selective accuracy={selective['acceptedAccuracy']}, "
        f"coverage={selective['coverage']:.3f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
