"""OpenCLIP prototype encoding, robust outlier filtering, and index loading."""

from __future__ import annotations

import hashlib
import json
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Protocol, Sequence

import numpy as np
from PIL import Image


DEFAULT_MODEL_NAME = "ViT-B-32"
DEFAULT_PRETRAINED = "laion2b_s34b_b79k"


class ImageEncoder(Protocol):
    model_name: str
    pretrained: str
    device: str

    def encode(self, image_paths: Sequence[Path], batch_size: int) -> np.ndarray: ...


def _normalize_rows(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float32)
    if values.ndim != 2 or values.shape[1] == 0:
        raise ValueError("Embeddings must be a non-empty two-dimensional array.")
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if np.any(norms <= 1e-12):
        raise ValueError("Embedding model returned a zero-length vector.")
    return values / norms


class OpenClipImageEncoder:
    """Lazy OpenCLIP adapter with CUDA out-of-memory batch-size backoff."""

    def __init__(
        self,
        model_name: str = DEFAULT_MODEL_NAME,
        pretrained: str = DEFAULT_PRETRAINED,
        device: str = "auto",
        cache_dir: Path | None = None,
        progress: Callable[[int, int, int], None] | None = None,
    ):
        try:
            import open_clip
            import torch
        except ImportError as exc:
            raise RuntimeError(
                "Install ml_backend/requirements-ml-index.txt before generating embeddings."
            ) from exc

        resolved_device = (
            "cuda" if device == "auto" and torch.cuda.is_available() else device
        )
        if resolved_device == "auto":
            resolved_device = "cpu"
        if resolved_device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested, but PyTorch cannot access the GPU.")

        self._torch = torch
        self.model_name = model_name
        self.pretrained = pretrained
        self.device = resolved_device
        self.progress = progress
        self.effective_batch_size: int | None = None
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            model_name,
            pretrained=pretrained,
            cache_dir=str(cache_dir) if cache_dir else None,
        )
        self.model.eval().to(self.device)

    def _encode_image_batch(self, images: Sequence[Image.Image]) -> np.ndarray:
        tensors = [self.preprocess(image.convert("RGB")) for image in images]
        batch = self._torch.stack(tensors).to(self.device)
        autocast = (
            self._torch.autocast(device_type="cuda", dtype=self._torch.float16)
            if self.device == "cuda"
            else nullcontext()
        )
        with self._torch.inference_mode(), autocast:
            features = self.model.encode_image(batch)
        return features.float().cpu().numpy()

    def _encode_batch(self, image_paths: Sequence[Path]) -> np.ndarray:
        images = []
        for path in image_paths:
            with Image.open(path) as image:
                images.append(image.convert("RGB").copy())
        return self._encode_image_batch(images)

    def encode(self, image_paths: Sequence[Path], batch_size: int = 16) -> np.ndarray:
        if batch_size < 1:
            raise ValueError("batch_size must be at least 1.")
        outputs: list[np.ndarray] = []
        position = 0
        current_batch_size = batch_size
        while position < len(image_paths):
            current_paths = image_paths[position : position + current_batch_size]
            try:
                outputs.append(self._encode_batch(current_paths))
                position += len(current_paths)
                if self.progress is not None:
                    self.progress(position, len(image_paths), current_batch_size)
            except RuntimeError as exc:
                is_cuda_oom = (
                    "out of memory" in str(exc).lower() and self.device == "cuda"
                )
                if not is_cuda_oom or current_batch_size == 1:
                    raise
                current_batch_size = max(1, current_batch_size // 2)
                self._torch.cuda.empty_cache()
        self.effective_batch_size = current_batch_size
        return _normalize_rows(np.concatenate(outputs, axis=0))

    def encode_images(
        self, images: Sequence[Image.Image], batch_size: int = 16
    ) -> np.ndarray:
        """Encode in-memory crops for the live meal-recognition pipeline."""

        if batch_size < 1:
            raise ValueError("batch_size must be at least 1.")
        if not images:
            raise ValueError("At least one image is required.")
        outputs: list[np.ndarray] = []
        position = 0
        current_batch_size = batch_size
        while position < len(images):
            current_images = images[position : position + current_batch_size]
            try:
                outputs.append(self._encode_image_batch(current_images))
                position += len(current_images)
            except RuntimeError as exc:
                is_cuda_oom = (
                    "out of memory" in str(exc).lower() and self.device == "cuda"
                )
                if not is_cuda_oom or current_batch_size == 1:
                    raise
                current_batch_size = max(1, current_batch_size // 2)
                self._torch.cuda.empty_cache()
        self.effective_batch_size = current_batch_size
        return _normalize_rows(np.concatenate(outputs, axis=0))


def _robust_class_filter(
    embeddings: np.ndarray,
    *,
    minimum_similarity: float,
    mad_multiplier: float,
    seed_fraction: float,
    minimum_keep: int,
) -> tuple[np.ndarray, np.ndarray, float]:
    """Return keep flags, robust-centroid similarities, and applied threshold."""

    embeddings = _normalize_rows(embeddings)
    count = len(embeddings)
    if count <= minimum_keep:
        centroid = _normalize_rows(embeddings.mean(axis=0, keepdims=True))[0]
        similarities = embeddings @ centroid
        return np.ones(count, dtype=bool), similarities, -1.0

    pairwise = embeddings @ embeddings.T
    centrality = np.median(pairwise, axis=1)
    seed_count = min(count, max(minimum_keep, int(np.ceil(count * seed_fraction))))
    seed_indices = np.argsort(-centrality, kind="stable")[:seed_count]
    robust_centroid = _normalize_rows(
        embeddings[seed_indices].mean(axis=0, keepdims=True)
    )[0]
    similarities = embeddings @ robust_centroid
    median = float(np.median(similarities))
    mad = float(np.median(np.abs(similarities - median)))
    robust_threshold = median - mad_multiplier * 1.4826 * mad
    # MAD approaches zero for a visually consistent class. Keep a small
    # similarity margin so harmless viewpoint variation is not over-pruned.
    threshold = max(minimum_similarity, min(robust_threshold, median - 0.03))
    keep = similarities >= threshold
    if int(keep.sum()) < minimum_keep:
        keep[:] = False
        keep[np.argsort(-similarities, kind="stable")[:minimum_keep]] = True
    return keep, similarities, float(threshold)


def build_recognition_index(
    manifest_path: Path,
    output_prefix: Path,
    encoder: ImageEncoder,
    *,
    batch_size: int = 16,
    minimum_similarity: float = 0.60,
    mad_multiplier: float = 3.0,
    seed_fraction: float = 0.60,
    minimum_keep: int = 5,
) -> dict:
    """Encode prototypes, remove class outliers, and save NPZ plus JSON metadata."""

    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    records = list(manifest.get("prototypes", []))
    if not records:
        raise ValueError("Prototype manifest contains no prototype records.")
    prototype_root = manifest_path.parent
    image_paths = [prototype_root / record["prototypePath"] for record in records]
    missing = [str(path) for path in image_paths if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"Missing prototype image: {missing[0]}")

    all_embeddings = _normalize_rows(encoder.encode(image_paths, batch_size))
    if len(all_embeddings) != len(records):
        raise ValueError("Encoder returned a different number of embeddings than images.")

    retained = np.zeros(len(records), dtype=bool)
    similarities = np.zeros(len(records), dtype=np.float32)
    thresholds: dict[int, float] = {}
    class_ids = np.asarray([int(record["class_id"]) for record in records])
    for class_id in sorted(set(class_ids.tolist())):
        indices = np.flatnonzero(class_ids == class_id)
        keep, class_similarities, threshold = _robust_class_filter(
            all_embeddings[indices],
            minimum_similarity=minimum_similarity,
            mad_multiplier=mad_multiplier,
            seed_fraction=seed_fraction,
            minimum_keep=minimum_keep,
        )
        retained[indices] = keep
        similarities[indices] = class_similarities
        thresholds[class_id] = threshold

    kept_embeddings = all_embeddings[retained]
    kept_records = [record for record, keep in zip(records, retained) if keep]
    kept_class_ids = class_ids[retained].astype(np.int32)
    kept_class_names = np.asarray(
        [str(record["class_name"]) for record in kept_records]
    )
    kept_paths = np.asarray([str(record["prototypePath"]) for record in kept_records])

    centroid_ids: list[int] = []
    centroid_names: list[str] = []
    centroids: list[np.ndarray] = []
    for class_id in sorted(set(kept_class_ids.tolist())):
        indices = np.flatnonzero(kept_class_ids == class_id)
        centroid_ids.append(class_id)
        centroid_names.append(str(kept_class_names[indices[0]]))
        centroids.append(
            _normalize_rows(kept_embeddings[indices].mean(axis=0, keepdims=True))[0]
        )

    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    npz_path = output_prefix.with_suffix(".npz")
    metadata_path = output_prefix.with_suffix(".json")
    np.savez_compressed(
        npz_path,
        embeddings=kept_embeddings.astype(np.float32),
        class_ids=kept_class_ids,
        class_names=kept_class_names,
        prototype_paths=kept_paths,
        centroids=np.asarray(centroids, dtype=np.float32),
        centroid_class_ids=np.asarray(centroid_ids, dtype=np.int32),
        centroid_class_names=np.asarray(centroid_names),
    )

    audit = []
    for index, record in enumerate(records):
        class_id = int(record["class_id"])
        audit.append(
            {
                "prototypePath": record["prototypePath"],
                "classId": class_id,
                "className": record["class_name"],
                "similarityToRobustCentroid": round(float(similarities[index]), 6),
                "threshold": round(float(thresholds[class_id]), 6),
                "retained": bool(retained[index]),
            }
        )
    per_class = {}
    for class_id in centroid_ids:
        indices = np.flatnonzero(class_ids == class_id)
        first_index = int(indices[0])
        per_class[str(class_id)] = {
            "name": str(records[first_index]["class_name"]),
            "inputCount": int(len(indices)),
            "retainedCount": int(retained[indices].sum()),
            "outlierCount": int((~retained[indices]).sum()),
            "threshold": round(float(thresholds[class_id]), 6),
        }

    metadata = {
        "schemaVersion": "1.0.0",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceManifest": str(manifest_path.resolve()),
        "sourceManifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "model": {
            "architecture": encoder.model_name,
            "pretrained": encoder.pretrained,
            "device": encoder.device,
            "embeddingDimension": int(kept_embeddings.shape[1]),
            "requestedBatchSize": batch_size,
            "effectiveBatchSize": getattr(encoder, "effective_batch_size", batch_size),
        },
        "filter": {
            "minimumSimilarity": minimum_similarity,
            "madMultiplier": mad_multiplier,
            "seedFraction": seed_fraction,
            "minimumKeepPerClass": minimum_keep,
        },
        "inputPrototypeCount": len(records),
        "retainedPrototypeCount": int(retained.sum()),
        "outlierCount": int((~retained).sum()),
        "classCount": len(centroid_ids),
        "perClass": per_class,
        "prototypeAudit": audit,
    }
    metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    return metadata


class RecognitionIndex:
    """Read-only cosine search over class centroids or retained prototypes."""

    def __init__(self, npz_path: Path):
        with np.load(npz_path, allow_pickle=False) as data:
            self.centroids = _normalize_rows(data["centroids"])
            self.class_ids = data["centroid_class_ids"].astype(np.int32)
            self.class_names = data["centroid_class_names"].astype(str)
            self.prototype_embeddings = _normalize_rows(data["embeddings"])
            self.prototype_class_ids = data["class_ids"].astype(np.int32)
        if len(self.centroids) != len(self.class_ids):
            raise ValueError("Recognition index contains mismatched centroid metadata.")
        if len(self.prototype_embeddings) != len(self.prototype_class_ids):
            raise ValueError("Recognition index contains mismatched prototype metadata.")
        unknown_ids = set(self.prototype_class_ids.tolist()) - set(self.class_ids.tolist())
        if unknown_ids:
            raise ValueError("Prototype classes are missing from centroid metadata.")

    def score_batch(
        self, embeddings: np.ndarray, *, strategy: str = "centroid"
    ) -> np.ndarray:
        """Return one cosine-similarity score per query and class."""

        queries = _normalize_rows(np.asarray(embeddings, dtype=np.float32))
        if queries.shape[1] != self.centroids.shape[1]:
            raise ValueError("Query embedding dimension does not match the index.")
        if strategy == "centroid":
            return queries @ self.centroids.T
        if strategy != "prototype_max":
            raise ValueError("strategy must be 'centroid' or 'prototype_max'.")

        prototype_scores = queries @ self.prototype_embeddings.T
        class_scores = np.full(
            (len(queries), len(self.class_ids)), -np.inf, dtype=np.float32
        )
        for position, class_id in enumerate(self.class_ids):
            members = self.prototype_class_ids == class_id
            class_scores[:, position] = prototype_scores[:, members].max(axis=1)
        return class_scores

    def search(
        self,
        embedding: np.ndarray,
        top_k: int = 5,
        *,
        strategy: str = "centroid",
    ) -> list[dict]:
        if top_k < 1:
            raise ValueError("top_k must be at least 1.")
        scores = self.score_batch(
            np.asarray(embedding, dtype=np.float32).reshape(1, -1),
            strategy=strategy,
        )[0]
        order = np.argsort(-scores, kind="stable")[: min(top_k, len(scores))]
        return [
            {
                "classId": int(self.class_ids[index]),
                "className": str(self.class_names[index]),
                "similarity": round(float(scores[index]), 6),
            }
            for index in order
        ]
