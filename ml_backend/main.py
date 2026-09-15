import base64
import binascii
import io
import os

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

from ml_backend.models.food_classifier import FoodImageBaseline
from ml_backend.models.health_predictor import HealthPredictor
from ml_backend.meal import DishCatalog, MealAnalysisService
from ml_backend.meal.catalog import DishNotFoundError
from ml_backend.meal.recognizer import create_default_meal_recognizer
from ml_backend.meal.schemas import (
    DishCatalogueResponse,
    MealAnalysisInput,
    MealAnalysisResponse,
    MealRecalculateInput,
)


MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

app = FastAPI(
    title="NutriLens Analysis Service",
    description=(
        "Indian meal portion/nutrition estimates with explicit confirmation, "
        "plus the legacy packaged-label prototype endpoints."
    ),
    version="1.2.0",
)

configured_origins = [
    origin.strip()
    for origin in os.getenv(
        "NUTRILENS_CORS_ORIGINS",
        (
            "http://localhost:5173,http://localhost:8443,"
            "http://127.0.0.1:5173,http://127.0.0.1:8443"
        ),
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

food_classifier = FoodImageBaseline()
health_predictor = HealthPredictor()
meal_service = MealAnalysisService(DishCatalog(), create_default_meal_recognizer())


class NutrientInput(BaseModel):
    calories: float = Field(ge=0)
    saturatedFat: float = Field(ge=0)
    sugars: float = Field(ge=0)
    sodium: float = Field(ge=0)
    fiber: float = Field(ge=0)
    protein: float = Field(ge=0)


class ImageBase64Input(BaseModel):
    imageDataUrl: str = Field(min_length=1)


class CompleteAnalysisInput(ImageBase64Input):
    nutrients: NutrientInput | None = None


def decode_image_data_url(image_data_url: str) -> bytes:
    raw_base64 = image_data_url
    if image_data_url.startswith("data:"):
        try:
            header, raw_base64 = image_data_url.split(",", 1)
        except ValueError as exc:
            raise ValueError("Malformed image data URL.") from exc
        mime_type = header[5:].split(";", 1)[0].lower()
        if mime_type not in ALLOWED_IMAGE_TYPES:
            raise ValueError("Only JPEG, PNG, and WebP images are supported.")

    estimated_size = len(raw_base64) * 3 // 4
    if estimated_size > MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds the 5 MB size limit.")

    try:
        image_bytes = base64.b64decode(raw_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("Image contains invalid base64 data.") from exc

    if not image_bytes:
        raise ValueError("Image data is empty.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError("Image exceeds the 5 MB size limit.")

    try:
        with Image.open(io.BytesIO(image_bytes)) as image:
            image_format = (image.format or "").upper()
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ValueError("Decoded data is not a valid JPEG, PNG, or WebP image.") from exc
    if image_format not in {"JPEG", "PNG", "WEBP"}:
        raise ValueError("Only JPEG, PNG, and WebP images are supported.")
    return image_bytes


def analyze_image(image_bytes: bytes, nutrients: NutrientInput | None = None):
    try:
        vision_result = food_classifier.predict_image(image_bytes)
        nutrient_values = (
            nutrients.model_dump()
            if nutrients is not None
            else vision_result["estimatedNutrients"]
        )
        health_result = health_predictor.predict(nutrient_values)
        health_result["nutrientSource"] = (
            "provided_label_values" if nutrients is not None else "class_profile_estimate"
        )
        health_result["nutrientsUsed"] = nutrient_values
        return vision_result, health_result
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"Image could not be analyzed: {exc}") from exc


@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "NutriLens Analysis Service",
        "version": "1.2.0",
        "inferenceMode": "trained_model" if health_predictor.model_loaded else "prototype_baselines",
        "endpoints": [
            "/api/ml/health",
            "/api/ml/classify-food",
            "/api/ml/classify-food-base64",
            "/api/ml/predict-health",
            "/api/ml/analyze-complete",
            "/api/v1/meals/dishes",
            "/api/v1/meals/analyze",
            "/api/v1/meals/recalculate",
        ],
    }


@app.get("/api/ml/health")
def ml_health():
    return {
        "status": "healthy",
        "visionModelLoaded": False,
        "healthModelLoaded": health_predictor.model_loaded,
        "indianMealRecognitionModelLoaded": meal_service.recognizer.model_loaded,
        "indianDishProfiles": meal_service.catalog.count,
        "inferenceMode": "prototype_baselines" if not health_predictor.model_loaded else "mixed",
        "framework": "FastAPI",
    }


@app.get("/api/v1/meals/dishes", response_model=DishCatalogueResponse)
def list_indian_dishes(
    query: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=200),
):
    """List supported Indian dish and fruit profiles for confirmation UI."""

    return {"success": True, "data": meal_service.catalogue(query, limit)}


@app.post("/api/v1/meals/analyze", response_model=MealAnalysisResponse)
def analyze_indian_meal(payload: MealAnalysisInput):
    """Validate a meal photo, then recognise or calculate confirmed items.

    The current recogniser intentionally abstains when no validated thali model
    is installed. In that case the response asks the caller to select dishes.
    """

    try:
        image_bytes = decode_image_data_url(payload.imageDataUrl)
        if payload.items:
            result = meal_service.calculate(payload.items)
        else:
            result = meal_service.needs_confirmation(image_bytes)
        return {"success": True, "data": result}
    except DishNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/v1/meals/recalculate", response_model=MealAnalysisResponse)
def recalculate_indian_meal(payload: MealRecalculateInput):
    """Recalculate nutrition after the user corrects dishes or portions."""

    try:
        return {"success": True, "data": meal_service.calculate(payload.items)}
    except DishNotFoundError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/ml/classify-food")
async def classify_food_file(file: UploadFile = File(...)):
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, and WebP images are supported.")
    image_bytes = await file.read(MAX_IMAGE_BYTES + 1)
    if not image_bytes:
        raise HTTPException(status_code=422, detail="Uploaded image is empty.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 5 MB size limit.")
    try:
        return {"success": True, "data": food_classifier.predict_image(image_bytes)}
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid image: {exc}") from exc


@app.post("/api/ml/classify-food-base64")
def classify_food_base64(payload: ImageBase64Input):
    try:
        image_bytes = decode_image_data_url(payload.imageDataUrl)
        return {"success": True, "data": food_classifier.predict_image(image_bytes)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid image: {exc}") from exc


@app.post("/api/ml/predict-health")
def predict_health(nutrients: NutrientInput):
    try:
        return {"success": True, "data": health_predictor.predict(nutrients.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/ml/analyze-complete")
def analyze_complete(payload: CompleteAnalysisInput):
    try:
        image_bytes = decode_image_data_url(payload.imageDataUrl)
        vision_result, health_result = analyze_image(image_bytes, payload.nutrients)
        return {
            "success": True,
            "data": {"vision": vision_result, "health": health_result},
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("ml_backend.main:app", host="0.0.0.0", port=8000, reload=True)
