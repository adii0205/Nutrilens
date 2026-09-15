"""Generate the NutriLens OpenCLIP prototype recognition index."""

from __future__ import annotations

import argparse
from pathlib import Path

from ml_backend.meal.embedding_index import (
    DEFAULT_MODEL_NAME,
    DEFAULT_PRETRAINED,
    OpenClipImageEncoder,
    build_recognition_index,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output-prefix", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--model", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--pretrained", default=DEFAULT_PRETRAINED)
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args()

    encoder = OpenClipImageEncoder(
        model_name=args.model,
        pretrained=args.pretrained,
        device=args.device,
        cache_dir=args.cache_dir,
        progress=lambda position, total, batch: print(
            f"Encoded {position}/{total} prototypes (batch size {batch})",
            flush=True,
        ),
    )
    metadata = build_recognition_index(
        args.manifest,
        args.output_prefix,
        encoder,
        batch_size=args.batch_size,
    )
    print(
        f"Saved {metadata['retainedPrototypeCount']} embeddings and "
        f"{metadata['classCount']} centroids; removed "
        f"{metadata['outlierCount']} outliers."
    )


if __name__ == "__main__":
    main()
