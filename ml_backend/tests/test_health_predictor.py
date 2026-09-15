import pytest

from ml_backend.models.health_predictor import HealthPredictor


VALID_NUTRIENTS = {
    "calories": 200,
    "saturatedFat": 2,
    "sugars": 5,
    "sodium": 300,
    "fiber": 3,
    "protein": 8,
}


def test_metadata_or_missing_artifact_uses_honest_rule_baseline():
    predictor = HealthPredictor(model_path="does-not-exist.pkl")

    result = predictor.predict(VALID_NUTRIENTS)

    assert result["inferenceSource"] == "rule_based"
    assert result["confidence"] is None
    assert result["modelName"] == "NutriLens rule-based health baseline"
    assert result["explanationMethod"] == "rule_contribution"


def test_missing_nutrients_are_rejected():
    predictor = HealthPredictor(model_path="does-not-exist.pkl")

    with pytest.raises(ValueError, match="Missing required nutrients: protein"):
        predictor.predict({key: value for key, value in VALID_NUTRIENTS.items() if key != "protein"})


def test_negative_nutrients_are_rejected():
    predictor = HealthPredictor(model_path="does-not-exist.pkl")
    nutrients = {**VALID_NUTRIENTS, "sodium": -1}

    with pytest.raises(ValueError, match="finite, non-negative"):
        predictor.predict(nutrients)
