import base64
import io

from fastapi.testclient import TestClient
from PIL import Image

from ml_backend.main import app


client = TestClient(app)


def image_data_url():
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (190, 140, 70)).save(buffer, format="JPEG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def test_indian_dish_catalogue_is_versioned_and_searchable():
    response = client.get("/api/v1/meals/dishes", params={"query": "rajma"})

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["catalogVersion"] == "1.0.0"
    assert data["count"] == 1
    assert data["dishes"][0]["id"] == "rajma_curry"
    assert data["dishes"][0]["profileStatus"] == "prototype_estimate"
    assert data["provenance"]["references"]


def test_tiny_image_only_meal_request_requires_confirmation():
    response = client.post(
        "/api/v1/meals/analyze",
        json={"imageDataUrl": image_data_url()},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "needs_confirmation"
    assert data["recognition"]["status"] in {
        "low_confidence",
        "model_not_available",
    }
    assert data["recognition"]["confidence"] is None
    assert data["items"] == []
    assert data["requiresUserConfirmation"] is True


def test_confirmed_dishes_calculate_per_item_and_total_macros():
    response = client.post(
        "/api/v1/meals/recalculate",
        json={
            "items": [
                {
                    "dishId": "rajma_curry",
                    "portionGrams": 150,
                    "portionBasis": "measured",
                },
                {
                    "dishId": "roti",
                    "portionGrams": 40,
                    "portionBasis": "measured",
                },
            ]
        },
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "complete"
    assert data["requiresUserConfirmation"] is False
    assert data["requiresPortionConfirmation"] is False
    assert [item["dishId"] for item in data["items"]] == ["rajma_curry", "chapati"]
    assert data["items"][0]["nutrients"]["estimated"]["calories"] == 210.0
    assert data["totals"]["estimated"]["calories"] == 314.0
    assert data["totals"]["estimated"]["protein"] > 0
    assert data["totals"]["estimated"]["fat"] > 0
    assert data["totals"]["estimated"]["carbohydrates"] > 0
    assert data["totals"]["estimated"]["fiber"] > 0
    assert data["units"]["sodium"] == "mg"
    assert data["items"][0]["provenance"]["references"]


def test_unsupported_dish_is_rejected_with_catalogue_guidance():
    response = client.post(
        "/api/v1/meals/recalculate",
        json={"items": [{"dishId": "imaginary_curry"}]},
    )

    assert response.status_code == 422
    assert "Unsupported dish" in response.json()["detail"]


def test_invalid_meal_image_is_rejected():
    response = client.post(
        "/api/v1/meals/analyze",
        json={"imageDataUrl": "data:image/jpeg;base64,not-valid"},
    )

    assert response.status_code == 422


def test_base64_text_with_an_image_mime_type_is_rejected():
    encoded = base64.b64encode(b"this is not an image").decode("ascii")
    response = client.post(
        "/api/v1/meals/analyze",
        json={"imageDataUrl": f"data:image/jpeg;base64,{encoded}"},
    )

    assert response.status_code == 422
    assert "not a valid" in response.json()["detail"]
