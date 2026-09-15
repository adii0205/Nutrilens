"""Indian meal orchestration and deterministic nutrition calculation.

Image recognition is deliberately behind a replaceable adapter. Until a
validated Indian-thali checkpoint is installed, the adapter abstains and the
caller confirms dish names and portions. Nutrition is calculated from the
versioned profile catalogue; it is never inferred from image colour.
"""

from __future__ import annotations

from uuid import uuid4

from ml_backend.meal.catalog import DishCatalog
from ml_backend.meal.recognizer import UnavailableMealRecognizer
from ml_backend.meal.schemas import MealItemInput


NUTRIENT_KEYS = (
    "calories",
    "protein",
    "fat",
    "carbohydrates",
    "fiber",
    "sugars",
    "saturatedFat",
    "sodium",
)

UNITS = {
    "calories": "kcal",
    "protein": "g",
    "fat": "g",
    "carbohydrates": "g",
    "fiber": "g",
    "sugars": "g",
    "saturatedFat": "g",
    "sodium": "mg",
}


def _round_nutrients(values: dict[str, float]) -> dict[str, float]:
    return {key: round(float(values.get(key, 0.0)), 2) for key in NUTRIENT_KEYS}


def _zero_nutrients() -> dict[str, float]:
    return {key: 0.0 for key in NUTRIENT_KEYS}


class MealAnalysisService:
    """Build API results from recognised or user-confirmed Indian dishes."""

    def __init__(
        self,
        catalog: DishCatalog | None = None,
        recognizer: object | None = None,
    ):
        self.catalog = catalog or DishCatalog()
        self.recognizer = recognizer or UnavailableMealRecognizer()

    def catalogue(self, query: str | None, limit: int) -> dict:
        return self.catalog.public_catalog(query, limit)

    @staticmethod
    def _portion(profile: dict, item: MealItemInput) -> dict:
        typical = profile["typical_portion"]
        description = str(typical.get("description", "Typical serving"))

        if item.portionGrams is None:
            selected = float(typical["default_g"]) * item.servings
            minimum = float(typical["min_g"]) * item.servings
            maximum = float(typical["max_g"]) * item.servings
            basis = "standard_portion_profile"
            if item.servings != 1:
                description = f"{item.servings:g} x {description.lower()}"
        else:
            selected = float(item.portionGrams)
            if item.portionBasis == "measured":
                minimum = selected
                maximum = selected
                basis = "user_measured_weight"
                description = "Weight entered as measured by the user"
            else:
                selected_error = 0.20
                minimum = selected * (1.0 - selected_error)
                maximum = selected * (1.0 + selected_error)
                basis = "user_estimated_weight"
                description = "Approximate weight entered by the user"

        return {
            "selectedGrams": round(selected, 2),
            "minimumGrams": round(max(0.0, minimum), 2),
            "maximumGrams": round(maximum, 2),
            "basis": basis,
            "description": description,
        }

    @staticmethod
    def _nutrient_range(
        per_100g: dict[str, float],
        portion: dict,
        density_uncertainty_percent: float,
    ) -> dict:
        density_fraction = density_uncertainty_percent / 100.0
        estimated = {
            key: per_100g[key] * portion["selectedGrams"] / 100.0
            for key in NUTRIENT_KEYS
        }
        minimum = {
            key: max(
                0.0,
                per_100g[key]
                * portion["minimumGrams"]
                / 100.0
                * (1.0 - density_fraction),
            )
            for key in NUTRIENT_KEYS
        }
        maximum = {
            key: per_100g[key]
            * portion["maximumGrams"]
            / 100.0
            * (1.0 + density_fraction)
            for key in NUTRIENT_KEYS
        }
        return {
            "estimated": _round_nutrients(estimated),
            "minimum": _round_nutrients(minimum),
            "maximum": _round_nutrients(maximum),
        }

    @staticmethod
    def _sum_ranges(items: list[dict]) -> dict:
        totals = {
            range_name: _zero_nutrients()
            for range_name in ("estimated", "minimum", "maximum")
        }
        for item in items:
            for range_name in totals:
                for nutrient in NUTRIENT_KEYS:
                    totals[range_name][nutrient] += item["nutrients"][range_name][nutrient]
        return {
            range_name: _round_nutrients(values)
            for range_name, values in totals.items()
        }

    def _item_result(
        self,
        item: MealItemInput,
        index: int,
        *,
        recognition_source: str = "user_confirmed",
        confidence: float | None = None,
    ) -> dict:
        profile = self.catalog.get(item.dishId)
        public_profile = self.catalog.public_profile(profile)
        portion = self._portion(profile, item)
        nutrients = self._nutrient_range(
            public_profile["nutrientsPer100g"],
            portion,
            float(profile["nutrient_density_uncertainty_pct"]),
        )

        return {
            "itemId": item.itemId or f"meal-item-{index + 1}",
            "dishId": profile["id"],
            "name": profile["display_name"],
            "category": profile.get("category", "Indian dish"),
            "recognitionSource": recognition_source,
            "confidence": confidence,
            "portion": portion,
            "nutrients": nutrients,
            "allergens": list(
                profile.get("common_allergens", profile.get("allergens", []))
            ),
            "provenance": {
                "catalogVersion": self.catalog.version,
                "profileStatus": "prototype_estimate",
                "sourceRefs": list(profile.get("source_refs", [])),
                "references": self.catalog.references_for(profile),
                "caveats": list(profile.get("caveats", [])),
            },
        }

    def needs_confirmation(self, image_bytes: bytes) -> dict:
        attempt = self.recognizer.predict(image_bytes)
        grouped: dict[str, dict] = {}
        for prediction in attempt.predictions:
            dish_id = prediction["dishId"]
            if dish_id not in grouped:
                grouped[dish_id] = {
                    "count": 0,
                    "confidence": float(prediction["confidence"]),
                }
            grouped[dish_id]["count"] += 1
            grouped[dish_id]["confidence"] = max(
                grouped[dish_id]["confidence"], float(prediction["confidence"])
            )
        items = []
        for index, (dish_id, details) in enumerate(grouped.items()):
            item = MealItemInput(dishId=dish_id, servings=details["count"])
            items.append(
                self._item_result(
                    item,
                    index,
                    recognition_source="model",
                    confidence=round(details["confidence"], 6),
                )
            )
        zero = _zero_nutrients()
        totals = self._sum_ranges(items) if items else {
            "estimated": zero,
            "minimum": zero.copy(),
            "maximum": zero.copy(),
        }
        return {
            "analysisId": f"meal-{uuid4().hex}",
            "status": "needs_confirmation",
            "requiresUserConfirmation": True,
            "requiresPortionConfirmation": True,
            "recognition": {
                "status": attempt.status,
                "modelLoaded": attempt.model_loaded,
                "modelName": attempt.model_name,
                "confidence": attempt.confidence,
                "message": attempt.message,
                "nextAction": "select_dishes",
            },
            "items": items,
            "totals": totals,
            "units": UNITS,
            "limitations": [
                *self.catalog.global_caveats,
                (
                    "Model detections are editable suggestions and were not user-confirmed."
                    if items
                    else "No image-recognition result was used for this analysis."
                ),
            ],
        }

    def calculate(self, item_inputs: list[MealItemInput]) -> dict:
        items = [
            self._item_result(item, index)
            for index, item in enumerate(item_inputs)
        ]
        used_standard_portion = any(
            item["portion"]["basis"] == "standard_portion_profile" for item in items
        )
        return {
            "analysisId": f"meal-{uuid4().hex}",
            "status": "complete",
            "requiresUserConfirmation": False,
            "requiresPortionConfirmation": used_standard_portion,
            "recognition": {
                "status": "user_confirmed",
                "modelLoaded": False,
                "modelName": None,
                "confidence": None,
                "message": (
                    "Dish names were confirmed by the user; nutrients come from "
                    "versioned recipe profiles, not direct visual measurement."
                ),
                "nextAction": "review_portions",
            },
            "items": items,
            "totals": self._sum_ranges(items),
            "units": UNITS,
            "limitations": [
                *self.catalog.global_caveats,
                "Displayed ranges combine portion sensitivity with the recipe-profile allowance.",
            ],
        }


# Descriptive alias retained for callers that prefer the domain name.
IndianMealService = MealAnalysisService
