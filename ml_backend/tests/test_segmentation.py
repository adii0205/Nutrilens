import hashlib
import json

import numpy as np
import torch
from PIL import Image

from ml_backend.meal.segmentation import (
    ITDSegmentationDataset,
    ITDMealSegmenter,
    MODEL_ARCHITECTURE,
    SegmentationSample,
    _stable_validation_member,
    build_lraspp_model,
    discover_segmentation_samples,
    estimate_class_weights,
)


def _write_sample(root, stem, class_id=1):
    image_dir = root / "train" / "images"
    mask_dir = root / "train" / "masks"
    image_dir.mkdir(parents=True, exist_ok=True)
    mask_dir.mkdir(parents=True, exist_ok=True)
    image = np.full((18, 24, 3), [90, 130, 70], dtype=np.uint8)
    mask = np.zeros((18, 24), dtype=np.uint8)
    mask[4:15, 6:20] = class_id
    Image.fromarray(image).save(image_dir / f"{stem}_leftImg8bit.jpg")
    Image.fromarray(mask).save(mask_dir / f"{stem}_gtFine_labelIds.png")


def test_train_validation_partition_is_deterministic_and_disjoint(tmp_path):
    for index in range(30):
        _write_sample(tmp_path, f"meal_{index:03d}")

    training = discover_segmentation_samples(
        tmp_path, partition="train", validation_fraction=0.25
    )
    validation = discover_segmentation_samples(
        tmp_path, partition="validation", validation_fraction=0.25
    )

    assert len(training) + len(validation) == 30
    assert {sample.stem for sample in training}.isdisjoint(
        sample.stem for sample in validation
    )
    repeated = discover_segmentation_samples(
        tmp_path, partition="validation", validation_fraction=0.25
    )
    assert [sample.stem for sample in validation] == [sample.stem for sample in repeated]


def test_adjacent_camera_frames_stay_in_the_same_partition(tmp_path):
    del tmp_path
    first = _stable_validation_member("20250616_130811", 0.5)
    second = _stable_validation_member("20250616_130816", 0.5)

    assert first == second


def test_dataset_letterboxes_image_and_preserves_mask_ids(tmp_path):
    _write_sample(tmp_path, "meal_one", class_id=2)
    samples = [
        SegmentationSample(
            "meal_one",
            tmp_path / "train" / "images" / "meal_one_leftImg8bit.jpg",
            tmp_path / "train" / "masks" / "meal_one_gtFine_labelIds.png",
        )
    ]
    dataset = ITDSegmentationDataset(samples, image_size=64, augment=False)

    image, mask = dataset[0]

    assert image.shape == (3, 64, 64)
    assert mask.shape == (64, 64)
    assert set(mask.unique().tolist()) == {0, 2}
    weights = estimate_class_weights([samples[0].mask_path], 3, sample_size=16)
    assert weights.shape == (3,)
    assert np.isclose(weights[0], 0.2)


def test_lraspp_model_emits_one_logit_plane_per_class():
    model = build_lraspp_model(3, pretrained=False).eval()

    with torch.inference_mode():
        output = model(torch.zeros(1, 3, 64, 64))["out"]

    assert output.shape == (1, 3, 64, 64)


def test_checkpoint_loader_restores_prediction_to_original_size(tmp_path):
    class_map_path = tmp_path / "classes.json"
    class_map_path.write_text(
        json.dumps({"0": "background", "1": "rajma", "2": "rice"}),
        encoding="utf-8",
    )
    model = build_lraspp_model(3, pretrained=False)
    checkpoint_path = tmp_path / "segmenter.pt"
    torch.save(
        {
            "architecture": MODEL_ARCHITECTURE,
            "numClasses": 3,
            "imageSize": 64,
            "classMapSha256": hashlib.sha256(class_map_path.read_bytes()).hexdigest(),
            "epoch": 2,
            "modelState": model.state_dict(),
        },
        checkpoint_path,
    )
    segmenter = ITDMealSegmenter(checkpoint_path, class_map_path, device="cpu")

    prediction = segmenter.predict(Image.new("RGB", (48, 30), "white"))

    assert prediction.label_map.shape == (30, 48)
    assert prediction.image_size == (48, 30)
    assert prediction.model_name.endswith("epoch-2")
