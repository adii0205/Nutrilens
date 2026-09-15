"""Train the lightweight ITD meal segmentation model."""

from __future__ import annotations

import argparse
from pathlib import Path

from ml_backend.meal.segmentation import train_segmenter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--class-map", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--image-size", type=int, default=384)
    parser.add_argument("--batch-size", type=int, default=2)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--validation-fraction", type=float, default=0.15)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--max-train-batches", type=int)
    parser.add_argument("--max-validation-batches", type=int)
    parser.add_argument("--no-pretrained", action="store_true")
    args = parser.parse_args()

    def show_progress(update: dict) -> None:
        if update["stage"] == "train":
            print(
                f"Epoch {update['epoch']}/{update['epochs']} "
                f"batch {update['batch']}/{update['batches']} "
                f"loss={update['loss']:.4f}",
                flush=True,
            )
        else:
            print(
                f"Epoch {update['epoch']} complete: "
                f"train_loss={update['trainLoss']:.4f}, "
                f"val_loss={update['validationLoss']:.4f}, "
                f"foreground_mIoU={update['foregroundMeanIoU']:.4f}, "
                f"peak_gpu_mb={update['peakGpuMemoryMb']}",
                flush=True,
            )

    report = train_segmenter(
        args.dataset_root,
        args.class_map,
        args.output_dir,
        image_size=args.image_size,
        batch_size=args.batch_size,
        epochs=args.epochs,
        learning_rate=args.learning_rate,
        validation_fraction=args.validation_fraction,
        workers=args.workers,
        device=args.device,
        pretrained=not args.no_pretrained,
        resume_path=args.resume,
        max_train_batches=args.max_train_batches,
        max_validation_batches=args.max_validation_batches,
        progress=show_progress,
    )
    print(
        f"Saved checkpoint; best foreground mIoU="
        f"{report['bestForegroundMeanIoU']:.4f}",
        flush=True,
    )


if __name__ == "__main__":
    main()
