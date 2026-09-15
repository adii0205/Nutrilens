import math
import pickle
from pathlib import Path


GRADE_LABELS = ["A", "B", "C", "D", "F"]
REQUIRED_NUTRIENTS = (
    "calories",
    "saturatedFat",
    "sugars",
    "sodium",
    "fiber",
    "protein",
)


class HealthPredictor:
    """Run a trained estimator when available, otherwise an honest rule baseline."""

    def __init__(self, model_path=None):
        self.model_path = Path(model_path) if model_path else Path(__file__).with_name("health_predictor.pkl")
        self.payload = None
        self.model_loaded = False
        self.load_model()

    def load_model(self):
        self.payload = None
        self.model_loaded = False
        if not self.model_path.exists():
            print("[INFO] No trained health model found; using the rule-based baseline.")
            return

        try:
            with self.model_path.open("rb") as model_file:
                payload = pickle.load(model_file)
        except Exception as exc:
            print(f"[WARNING] Could not load health model ({exc}); using the rule baseline.")
            return

        if not isinstance(payload, dict) or not {"classifier", "regressor"}.issubset(payload):
            print("[INFO] The existing artifact contains metadata only; using the rule baseline.")
            return

        self.payload = payload
        self.model_loaded = True
        print(f"[SUCCESS] Loaded trained health model from {self.model_path}")

    @staticmethod
    def _validated_features(nutrients):
        if not isinstance(nutrients, dict):
            raise ValueError("Nutrients must be provided as an object.")

        missing = [name for name in REQUIRED_NUTRIENTS if nutrients.get(name) is None]
        if missing:
            raise ValueError(f"Missing required nutrients: {', '.join(missing)}")

        values = []
        for name in REQUIRED_NUTRIENTS:
            try:
                value = float(nutrients[name])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Nutrient '{name}' must be numeric.") from exc
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"Nutrient '{name}' must be a finite, non-negative number.")
            values.append(value)
        return values

    def predict(self, nutrients):
        features = self._validated_features(nutrients)
        calories, sat_fat, sugars, sodium, fiber, protein = features

        if self.model_loaded:
            classifier = self.payload["classifier"]
            regressor = self.payload["regressor"]
            raw_grade = classifier.predict([features])[0]
            grade = GRADE_LABELS[int(raw_grade)] if isinstance(raw_grade, (int, float)) else str(raw_grade)
            if grade not in GRADE_LABELS:
                raise ValueError(f"Trained model returned unsupported grade '{grade}'.")
            health_score = max(0, min(100, round(float(regressor.predict([features])[0]), 1)))
            confidence = None
            if hasattr(classifier, "predict_proba"):
                confidence = round(float(max(classifier.predict_proba([features])[0])) * 100, 1)
            model_name = self.payload.get("model_name", "Trained health prediction model")
            source = "trained_model"
            explanation_method = "model_feature_importance"
        else:
            negative = (
                (calories / 800 * 25)
                + (sat_fat / 25 * 25)
                + (sugars / 50 * 25)
                + (sodium / 2000 * 25)
            )
            positive = (fiber / 15 * 50) + (protein / 40 * 50)
            health_score = round(max(5, min(98, 100 - negative + positive * 0.4)), 1)

            if health_score >= 80:
                grade = "A"
            elif health_score >= 62:
                grade = "B"
            elif health_score >= 45:
                grade = "C"
            elif health_score >= 28:
                grade = "D"
            else:
                grade = "F"

            confidence = None
            model_name = "NutriLens rule-based health baseline"
            source = "rule_based"
            explanation_method = "rule_contribution"

        risk_factors = []
        if sat_fat > 5.0:
            risk_factors.append({
                "factor": "High Saturated Fat",
                "severity": "high" if sat_fat > 10.0 else "moderate",
                "message": f"Saturated fat ({sat_fat}g/100g) exceeds the 5.0g project threshold.",
            })
        if sugars > 12.5:
            risk_factors.append({
                "factor": "Elevated Sugar",
                "severity": "high" if sugars > 22.0 else "moderate",
                "message": f"Sugar content is {sugars}g/100g.",
            })
        if sodium > 600:
            risk_factors.append({
                "factor": "Elevated Sodium",
                "severity": "high" if sodium > 1000 else "moderate",
                "message": f"Sodium content is {sodium}mg/100g.",
            })
        if fiber >= 3.0:
            risk_factors.append({
                "factor": "Fiber Contribution",
                "severity": "good",
                "message": f"Fiber contributes positively at {fiber}g/100g.",
            })
        if protein >= 8.0:
            risk_factors.append({
                "factor": "Protein Contribution",
                "severity": "good",
                "message": f"Protein contributes positively at {protein}g/100g.",
            })

        factor_contributions = [
            {"name": "Calories", "impact": round(calories / 800 * 30, 1), "direction": "negative"},
            {"name": "Saturated Fat", "impact": round(sat_fat / 25 * 30, 1), "direction": "negative"},
            {"name": "Sugars", "impact": round(sugars / 50 * 25, 1), "direction": "negative"},
            {"name": "Sodium", "impact": round(sodium / 2000 * 25, 1), "direction": "negative"},
            {"name": "Fiber", "impact": round(fiber / 15 * 25, 1), "direction": "positive"},
            {"name": "Protein", "impact": round(protein / 40 * 25, 1), "direction": "positive"},
        ]

        return {
            "predictedGrade": grade,
            "healthScore": health_score,
            "confidence": confidence,
            "riskFactors": risk_factors,
            # Kept for frontend compatibility; explanationMethod makes its
            # meaning explicit until genuine model explanations are added.
            "featureImportance": factor_contributions,
            "explanationMethod": explanation_method,
            "modelName": model_name,
            "inferenceSource": source,
        }


# Compatibility alias for existing imports outside this repository.
HealthPredictorML = HealthPredictor
