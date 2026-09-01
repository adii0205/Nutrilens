# NutriLens Machine Learning FastAPI Backend

This directory contains the Machine Learning backend microservice for the NutriLens group project.

## Architecture & Features

1. **Food Vision Model (`ml_backend/models/food_classifier.py`)**:
   - PyTorch MobileNetV3 vision backbone + Feature Extractor.
   - Classifies images into food categories (Salad, Grain Bowl, Burger, Pasta, Curry, Desserts, etc.).
   - Computes confidence scores and estimated macro profiles.

2. **Nutritional Health Risk & Grade Predictor (`ml_backend/models/health_predictor.py`)**:
   - Scikit-Learn **RandomForestClassifier** & **GradientBoostingRegressor** models trained on Nutri-Score standards.
   - Predicts Nutri-Score Grade (A, B, C, D, F) and continuous Health Risk Score (0 - 100).
   - Generates risk factor alerts and Explainable AI (XAI) feature importances.

3. **FastAPI Web API (`ml_backend/main.py`)**:
   - RESTful JSON API endpoints for complete multi-modal inference.
   - Enables CORS for frontend connection.

---

## Quick Start Instructions

### 1. Create Virtual Environment & Install Dependencies
```bash
python -m venv venv
# On Windows PowerShell:
.\venv\bin\python.exe -m pip install -r requirements.txt
```

### 2. Train Models (Automated on startup)
```bash
python ml_backend/train_models.py
```

### 3. Run FastAPI Backend Server
```bash
python -m uvicorn ml_backend.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`. API docs can be accessed at `http://localhost:8000/docs`.
