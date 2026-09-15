from ml_backend.meal.recognizer import RecognitionAttempt
from ml_backend.meal.service import MealAnalysisService


class FakeMealRecognizer:
    model_loaded = True
    model_name = "fake-combined-model"

    def predict(self, image_bytes):
        assert image_bytes == b"meal-image"
        return RecognitionAttempt(
            status="recognized",
            model_loaded=True,
            model_name=self.model_name,
            confidence=0.91,
            predictions=(
                {"dishId": "chapati", "confidence": 0.90},
                {"dishId": "chapati", "confidence": 0.93},
                {"dishId": "dal_tadka", "confidence": 0.88},
            ),
            message="Three mapped regions need confirmation.",
        )


def test_model_suggestions_are_grouped_and_remain_unconfirmed():
    service = MealAnalysisService(recognizer=FakeMealRecognizer())

    result = service.needs_confirmation(b"meal-image")

    assert result["status"] == "needs_confirmation"
    assert result["requiresUserConfirmation"] is True
    assert result["recognition"]["status"] == "recognized"
    assert result["recognition"]["confidence"] == 0.91
    assert [item["dishId"] for item in result["items"]] == ["chapati", "dal_tadka"]
    assert result["items"][0]["recognitionSource"] == "model"
    assert result["items"][0]["confidence"] == 0.93
    assert result["items"][0]["portion"]["selectedGrams"] == 80.0
    assert result["totals"]["estimated"]["calories"] > 0
