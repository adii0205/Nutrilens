# NutriLens analysis backend

This directory contains the Python API used by the NutriLens frontend.

## Current status

Version 1.3 adds a working, confirmation-gated Indian-meal ML pipeline:

- A versioned catalogue contains 30 common Indian dishes and fruits with
  aliases, typical portion ranges, estimated nutrients, caveats, and references.
- Users confirm dish names and approximate or measured weights.
- The service returns per-item and total calories, protein, total fat,
  carbohydrates, fibre, sugars, saturated fat, and sodium with indicative ranges.
- When the local model artifacts are present, image-only meal requests run the
  trained segmenter and OpenCLIP verifier and return editable dish suggestions.
- If model artifacts are absent, the API abstains and asks the user to select
  dishes; it never invents an ML result.
- Food images sent to the legacy endpoint are still assigned to one of ten demo
  categories with a mean-RGB heuristic.
- When nutrition-label values are provided, those values are used instead of the estimate.
- Health grades come from a documented weighted nutrient formula.
- Heuristic and rule-based results do not report a confidence probability.

The meal runtime now uses the trained LR-ASPP MobileNetV3 segmenter followed by
an OpenCLIP verifier for the 50 IIIT-H Indian Thali classes. It maps only
calibrated, explicitly supported classes to nutrition profiles. The model does
not directly measure nutrients or portions, so every suggestion remains
user-editable and requires confirmation.

The grade is a custom **NutriLens Health Grade**, not the official Nutri-Score.

## Run the API

Use Python 3.11 or 3.12 (3.12 is verified), then run from the repository root:

```bash
python -m pip install -r ml_backend/requirements.txt
python -m uvicorn ml_backend.main:app --reload --host 0.0.0.0 --port 8000 --env-file .env.local
```

API documentation is available at `http://localhost:8000/docs`.

The old zero-dependency `server.py` was removed because it duplicated the API
with incompatible, hash-based predictions.

## Configuration

- `NUTRILENS_CORS_ORIGINS`: comma-separated allowed frontend origins. Defaults
  to `http://localhost:5173,http://localhost:8443`.
- `NUTRILENS_MEAL_MODEL_ENABLED`: defaults to `auto`; set it to `0` to disable
  local Indian-meal model loading and use the safe manual-selection fallback.
- Frontend: set `VITE_ML_API_BASE_URL` to the deployed API origin. It defaults
  to `http://localhost:8000` for local development.

## API behavior

- Images are limited to 5 MB and must be JPEG, PNG, or WebP.
- All six health-score inputs are required: calories, saturated fat, sugars,
  sodium, fibre, and protein.
- Missing or invalid values return a validation error rather than a high score.
- `nutrientSource` identifies whether scoring used label values or a class-level
  estimate.

## Indian meal endpoints

- `GET /api/v1/meals/dishes` lists/searches supported dish profiles.
- `POST /api/v1/meals/analyze` validates a meal image and, when artifacts are
  installed, returns calibrated dish suggestions and nutrient ranges. Results
  always set `requiresUserConfirmation`; it never falls back to mean-colour guessing.
- `POST /api/v1/meals/recalculate` accepts confirmed dish IDs and portions and
  returns per-item and total nutrient estimates.

Recipe profiles are project-curated engineering estimates informed by INDB,
IFCT 2017, and USDA FoodData Central. They are not measurements of the
photographed meal, and no exact source record ID is claimed where it has not
been verified.

## Build the Indian-dish recognition index

Install the optional GPU ML dependencies separately so the ordinary API setup
does not download several gigabytes of PyTorch packages:

```bash
python -m pip install -r ml_backend/requirements-ml-index.txt
```

After generating the connected-component prototypes, build their OpenCLIP
embeddings and robust class centroids:

```bash
python -m ml_backend.scripts.build_openclip_index \
  --manifest .ml_artifacts/models/iiith/itd_prototypes_v1/manifest.json \
  --output-prefix .ml_artifacts/models/iiith/recognition_index_v1 \
  --cache-dir .ml_artifacts/models/openclip/cache \
  --batch-size 16
```

The command selects CUDA when available, normalizes every embedding, removes
visual outliers within each class, and writes a compressed `.npz` search index
plus a `.json` audit report. Model weights and generated artifacts stay under
the git-ignored `.ml_artifacts` directory and must not be committed.

## Evaluate and calibrate recognition

Run held-out evaluation against the separate ITD test split:

```bash
python -m ml_backend.scripts.evaluate_openclip_index \
  --dataset-root .ml_artifacts/datasets/iiith/extracted/ITD \
  --class-map ml_backend/data/iiith_itd_class_map.json \
  --index .ml_artifacts/models/iiith/recognition_index_v1.npz \
  --crop-root .ml_artifacts/evaluation/iiith_test_crops_v1 \
  --output .ml_artifacts/evaluation/recognition_evaluation_v1.json \
  --cache-dir .ml_artifacts/models/openclip/cache \
  --batch-size 16 \
  --target-precision 0.80
```

The evaluator keeps all crops from one source image in the same partition,
selects the recognition strategy on 5,647 calibration crops, and reports final
metrics on 5,859 untouched evaluation crops. Version 1 selected centroid
scoring and a top-1 versus top-2 cosine-margin threshold of `0.038652`:

- raw top-1 accuracy: 56.19%
- raw top-5 accuracy: 86.84%
- accepted-prediction accuracy: 80.36%
- accepted coverage: 32.58%

The small deployable configuration is versioned in
`data/iiith_recognition_calibration_v1.json`; the full prediction audit remains
under `.ml_artifacts`. This crop-level evaluation used released ground-truth
masks to isolate each dish. The combined evaluation below instead uses regions
predicted from the complete meal photo.

## Train the Indian-meal segmenter

The region proposal stage uses torchvision LR-ASPP with a MobileNetV3 backbone.
It is small enough to train locally on a 4 GB GPU. The released reference
scanner uses the much larger GroundingDINO-base plus SAM2-large combination.

```bash
python -m ml_backend.scripts.train_itd_segmenter \
  --dataset-root .ml_artifacts/datasets/iiith/extracted/ITD \
  --class-map ml_backend/data/iiith_itd_class_map.json \
  --output-dir .ml_artifacts/models/iiith/segmenter_lraspp_grouped_v1 \
  --image-size 384 \
  --batch-size 12 \
  --epochs 8 \
  --workers 2
```

The 15% validation partition is grouped by capture minute so neighbouring
views of one plate cannot cross the split. The completed run used 5,296
training and 1,015 validation images and reached 82.07% foreground mean-IoU.
Its settings are recorded in `data/iiith_segmentation_model_v1.json`.

```bash
python -m ml_backend.scripts.predict_itd_segmentation \
  --checkpoint .ml_artifacts/models/iiith/segmenter_lraspp_grouped_v1/best.pt \
  --class-map ml_backend/data/iiith_itd_class_map.json \
  --image path/to/meal.jpg \
  --output-dir .ml_artifacts/evaluation/my_segmentation
```

Inference writes a colour mask, overlay, and JSON region metadata.

## Evaluate and run the combined meal pipeline

Run the full-photo evaluation after the segmenter and OpenCLIP index exist:

```bash
python -m ml_backend.scripts.evaluate_combined_meal_pipeline \\
  --dataset-root .ml_artifacts/datasets/iiith/extracted/ITD \\
  --class-map ml_backend/data/iiith_itd_class_map.json \\
  --segmenter .ml_artifacts/models/iiith/segmenter_lraspp_grouped_v1/best.pt \\
  --index .ml_artifacts/models/iiith/recognition_index_v1.npz \\
  --mapping ml_backend/data/iiith_to_nutrition_map.json \\
  --crop-root .ml_artifacts/evaluation/combined_predicted_regions_v1 \\
  --output .ml_artifacts/evaluation/combined_pipeline_evaluation_v1.json \\
  --cache-dir .ml_artifacts/models/openclip/cache \\
  --batch-size 16 \\
  --target-precision 0.90
```

The held-out combined evaluation used 1,587 test photos and 11,600 predicted
regions. On the untouched evaluation partition it reached:

- dish-region detection recall at IoU 0.50: 98.12%
- class-correct detection recall at IoU 0.50: 97.77%
- calibrated verified-region precision: 99.49%
- calibrated verified-region coverage: 95.86%
- supported nutrition-mapping precision: 99.37%

These metrics cover known IIIT-H classes photographed in the released dataset;
they do not establish accuracy for arbitrary restaurant or phone photos. Runtime
model files remain under the git-ignored `.ml_artifacts` directory. With the
checkpoint and index in their documented locations, restarting the API enables
the ML recognizer automatically.

## Tests

Run the Week 1 contract tests after installing the dependencies:

```bash
python -m pytest ml_backend/tests
```
