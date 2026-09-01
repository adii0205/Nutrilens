import os
import base64
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List

from ml_backend.models.food_classifier import FoodClassifierML
from ml_backend.models.health_predictor import HealthPredictorML
from ml_backend.train_models import train_and_save_models

app = FastAPI(
    title="NutriLens Machine Learning Service",
    description="FastAPI backend providing Computer Vision food classification and Random Forest health score predictions.",
    version="1.0.0"
)

# Enable CORS for React frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Instantiate ML Model Engines
food_classifier = FoodClassifierML()
health_predictor = HealthPredictorML()

@app.on_event("startup")
def startup_event():
    print("🚀 NutriLens ML FastAPI service booting up...")
    model_file = "ml_backend/models/health_predictor.pkl"
    if not os.path.exists(model_file):
        print("📦 Pre-trained ML model file not found. Running train_models script...")
        train_and_save_models()
        health_predictor.load_model()

class NutrientInput(BaseModel):
    calories: Optional[float] = 0.0
    saturatedFat: Optional[float] = 0.0
    sugars: Optional[float] = 0.0
    sodium: Optional[float] = 0.0
    fiber: Optional[float] = 0.0
    protein: Optional[float] = 0.0

class ImageBase64Input(BaseModel):
    imageDataUrl: str

@app.get("/")
def read_root():
    return {
        "status": "online",
        "service": "NutriLens ML Backend",
        "version": "1.0.0",
        "endpoints": [
            "/api/ml/health",
            "/api/ml/classify-food",
            "/api/ml/predict-health",
            "/api/ml/analyze-complete"
        ]
    }

@app.get("/api/ml/health")
def ml_health():
    return {
        "status": "healthy",
        "visionModel": food_classifier.model_loaded,
        "tabularModelLoaded": health_predictor.payload is not None,
        "framework": "FastAPI + PyTorch + Scikit-Learn"
    }

@app.post("/api/ml/classify-food")
async def classify_food_file(file: UploadFile = File(...)):
    try:
        image_bytes = await file.read()
        result = food_classifier.predict_image(image_bytes)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image classification failed: {str(e)}")

@app.post("/api/ml/classify-food-base64")
def classify_food_base64(payload: ImageBase64Input):
    try:
        # Strip data URL prefix if present
        raw_b64 = payload.imageDataUrl
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]
        image_bytes = base64.b64decode(raw_b64)
        result = food_classifier.predict_image(image_bytes)
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Base64 image classification failed: {str(e)}")

@app.post("/api/ml/predict-health")
def predict_health(nutrients: NutrientInput):
    try:
        result = health_predictor.predict(nutrients.dict())
        return {"success": True, "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health prediction failed: {str(e)}")

@app.post("/api/ml/analyze-complete")
def analyze_complete(payload: ImageBase64Input):
    try:
        raw_b64 = payload.imageDataUrl
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",")[1]
        image_bytes = base64.b64decode(raw_b64)
        
        # 1. Vision ML Classification
        vision_res = food_classifier.predict_image(image_bytes)
        
        # 2. Tabular ML Prediction using estimated nutrients
        health_res = health_predictor.predict(vision_res["estimatedNutrients"])

        return {
            "success": True,
            "data": {
                "vision": vision_res,
                "health": health_res
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Complete ML analysis failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("ml_backend.main:app", host="0.0.0.0", port=8000, reload=True)
