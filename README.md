# NutriLens

NutriLens is a BTech group-project prototype for scanning packaged-food labels
and prepared-food images, presenting nutrition information, and explaining the
result in an accessible interface.

## Components

- React/Vite frontend with camera capture, client-side Tesseract OCR, scan
  history, profiles, and optional Gemini explanations.
- FastAPI analysis service in `ml_backend/`.
- An Indian-meal confirmation workflow backed by 30 versioned dish/fruit
  profiles, portion ranges, source metadata, and per-item/meal nutrition totals.
- A transparent RGB heuristic retained only as a legacy comparison baseline.
  It is not a trained food-recognition model.

## Indian meal MVP

Choose **Indian meal**, take or upload a photo, then confirm every visible dish
and its approximate or measured weight. The backend calculates calories,
protein, total fat, carbohydrates, fibre, sugars, saturated fat, and sodium,
with indicative ranges and documented source metadata.

The image-recognition boundary currently abstains instead of guessing. The next
ML milestone is integrating and evaluating the IIIT-H Indian Thali segmentation,
prototype-classification, and portion-weight pipeline. Until that validated
checkpoint is installed, dish selection is intentionally user-confirmed.

## Local setup

Use Python 3.11 or 3.12 for the backend; Python 3.12 is the verified environment.

```bash
cp .env.example .env.local
npm ci
npm run dev
```

In a second terminal:

```bash
python -m pip install -r ml_backend/requirements.txt
python -m uvicorn ml_backend.main:app --reload --host 0.0.0.0 --port 8000 --env-file .env.local
```

Update `.env.local` when the backend or frontend uses a non-default URL.

## Verification

```bash
npx tsc --noEmit
npm run build
python -m pytest ml_backend/tests
```

See `ml_backend/README.md` for the current API contract and its limitations.
