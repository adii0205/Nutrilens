"""Command-line entry point for building ITD recognition prototypes."""

from __future__ import annotations

import argparse
from pathlib import Path

from ml_backend.meal.prototype_builder import build_prototypes


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", type=Path, required=True)
    parser.add_argument("--class-map", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--per-class", type=int, default=25)
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    last_reported = 0

    def report(position: int, total: int) -> None:
        nonlocal last_reported
        if position == total or position - last_reported >= 250:
            print(f"Scanned {position}/{total} masks", flush=True)
            last_reported = position

    manifest = build_prototypes(
        args.dataset_root,
        args.class_map,
        args.output,
        prototypes_per_class=args.per_class,
        workers=args.workers,
        progress=report,
    )
    print(
        f"Created {manifest['totalPrototypes']} prototypes across "
        f"{manifest['coveredClasses']} classes in {args.output}"
    )


if __name__ == "__main__":
    main()
