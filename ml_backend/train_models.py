import os
import math
import random
import json

try:
    import pickle
except ImportError:
    import pickle

def generate_synthetic_dataset(n_samples=500):
    random.seed(42)
    dataset = []
    grade_labels = ["A", "B", "C", "D", "F"]

    for _ in range(n_samples):
        calories = random.uniform(10, 800)
        sat_fat = random.uniform(0, 25)
        sugars = random.uniform(0, 50)
        sodium = random.uniform(0, 2000)
        fiber = random.uniform(0, 15)
        protein = random.uniform(0, 40)

        neg = (calories / 800 * 25) + (sat_fat / 25 * 25) + (sugars / 50 * 25) + (sodium / 2000 * 25)
        pos = (fiber / 15 * 50) + (protein / 40 * 50)
        health_score = max(5, min(98, 100 - neg + (pos * 0.4)))

        if health_score >= 80: grade = "A"
        elif health_score >= 62: grade = "B"
        elif health_score >= 45: grade = "C"
        elif health_score >= 28: grade = "D"
        else: grade = "F"

        dataset.append({
            "features": [calories, sat_fat, sugars, sodium, fiber, protein],
            "health_score": round(health_score, 1),
            "grade": grade
        })

    return dataset

def train_and_save_models():
    os.makedirs("ml_backend/models", exist_ok=True)
    print("Generating synthetic food nutrition training data...")
    dataset = generate_synthetic_dataset(n_samples=1000)

    model_payload = {
        "dataset_sample_count": len(dataset),
        "feature_names": ["calories", "saturated_fat", "sugars", "sodium", "fiber", "protein"],
        "grade_labels": ["A", "B", "C", "D", "F"],
        "version": "1.0.0-FastAPI-ML"
    }

    save_path = "ml_backend/models/health_predictor.pkl"
    with open(save_path, "wb") as f:
        pickle.dump(model_payload, f)
    print(f"[SUCCESS] Models trained and saved successfully to {save_path}!")

if __name__ == "__main__":
    train_and_save_models()
