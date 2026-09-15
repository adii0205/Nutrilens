import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from ml_backend.main import app


client = TestClient(app)


def image_data_url(color=(80, 160, 60)):
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), color).save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def test_health_endpoint_discloses_baseline_mode():
    response = client.get("/api/ml/health")

    assert response.status_code == 200
    assert response.json()["inferenceMode"] == "prototype_baselines"
    assert response.json()["visionModelLoaded"] is False


def test_missing_health_values_return_validation_error():
    response = client.post("/api/ml/predict-health", json={"calories": 100})

    assert response.status_code == 422


def test_invalid_base64_is_rejected():
    response = client.post(
        "/api/ml/classify-food-base64",
        json={"imageDataUrl": "data:image/png;base64,not-valid-base64"},
    )

    assert response.status_code == 422


def test_complete_analysis_uses_provided_label_values():
    nutrients = {
        "calories": 200,
        "saturatedFat": 2,
        "sugars": 5,
        "sodium": 300,
        "fiber": 3,
        "protein": 8,
    }
    response = client.post(
        "/api/ml/analyze-complete",
        json={"imageDataUrl": image_data_url(), "nutrients": nutrients},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["health"]["nutrientSource"] == "provided_label_values"
    assert data["health"]["nutrientsUsed"] == nutrients
    assert data["health"]["confidence"] is None
    assert data["vision"]["inferenceSource"] == "heuristic_baseline"
    assert data["vision"]["confidence"] is None


def test_unknown_endpoint_returns_404():
    assert client.post("/not-real", json={}).status_code == 404
