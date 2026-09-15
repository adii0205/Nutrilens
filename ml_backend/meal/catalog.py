"""Search and presentation layer for versioned Indian nutrition profiles."""

from __future__ import annotations

import re
from typing import Any

from ml_backend.data.indian_nutrition import load_catalog


NUTRIENT_FIELD_MAP = {
    "energy_kcal": "calories",
    "protein_g": "protein",
    "fat_g": "fat",
    "carbohydrate_g": "carbohydrates",
    "fiber_g": "fiber",
    "sugars_g": "sugars",
    "saturated_fat_g": "saturatedFat",
    "sodium_mg": "sodium",
}


def normalise_identifier(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


class DishNotFoundError(ValueError):
    """Raised when a requested dish is not in the supported profile catalogue."""


class DishCatalog:
    def __init__(self, catalog: dict[str, Any] | None = None):
        self._catalog = catalog or load_catalog()
        self._profiles = list(self._catalog["profiles"])
        self._sources = {
            source["id"]: source for source in self._catalog.get("sources", [])
        }
        self._index: dict[str, dict[str, Any]] = {}
        for profile in self._profiles:
            searchable = [
                profile["id"],
                profile["display_name"],
                *profile.get("aliases", []),
            ]
            for name in searchable:
                self._index[normalise_identifier(name)] = profile

    @property
    def version(self) -> str:
        return str(self._catalog["schema_version"])

    @property
    def global_caveats(self) -> list[str]:
        return list(self._catalog.get("global_caveats", []))

    @property
    def count(self) -> int:
        return len(self._profiles)

    def get(self, dish_id_or_alias: str) -> dict[str, Any]:
        profile = self._index.get(normalise_identifier(dish_id_or_alias))
        if profile is None:
            raise DishNotFoundError(
                f"Unsupported dish '{dish_id_or_alias}'. Use GET /api/v1/meals/dishes "
                "to retrieve supported dish IDs."
            )
        return profile

    def search(self, query: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
        if not query or not query.strip():
            return self._profiles[:limit]

        needle = normalise_identifier(query)

        def score(profile: dict[str, Any]) -> tuple[int, str]:
            names = [
                profile["id"],
                profile["display_name"],
                *profile.get("aliases", []),
            ]
            normalised_names = [normalise_identifier(name) for name in names]
            if needle in normalised_names:
                rank = 0
            elif any(name.startswith(needle) for name in normalised_names):
                rank = 1
            elif any(needle in name for name in normalised_names):
                rank = 2
            elif all(
                any(token in name for name in normalised_names)
                for token in needle.split()
            ):
                rank = 3
            else:
                rank = 99
            return rank, profile["display_name"].casefold()

        ranked = sorted(self._profiles, key=score)
        return [profile for profile in ranked if score(profile)[0] < 99][:limit]

    @staticmethod
    def public_nutrients(nutrients: dict[str, float]) -> dict[str, float]:
        return {
            public_name: float(nutrients[source_name])
            for source_name, public_name in NUTRIENT_FIELD_MAP.items()
        }

    def references_for(self, profile: dict[str, Any]) -> list[dict[str, str]]:
        references = []
        for source_id in profile.get("source_refs", []):
            source = self._sources[source_id]
            references.append(
                {
                    "id": source_id,
                    "name": str(
                        source.get("name")
                        or source.get("title")
                        or source_id
                    ),
                    "url": str(source.get("url", "")),
                }
            )
        return references

    def all_references(self) -> list[dict[str, str]]:
        return [
            {
                "id": source_id,
                "name": str(
                    source.get("name")
                    or source.get("title")
                    or source_id
                ),
                "url": str(source.get("url", "")),
            }
            for source_id, source in self._sources.items()
        ]

    def public_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        portion = profile["typical_portion"]
        return {
            "id": profile["id"],
            "name": profile["display_name"],
            "aliases": list(profile.get("aliases", [])),
            "category": profile.get("category", "Indian dish"),
            "defaultPortion": {
                "grams": float(portion["default_g"]),
                "minimumGrams": float(portion["min_g"]),
                "maximumGrams": float(portion["max_g"]),
                "description": portion.get("description", "Typical serving"),
            },
            "nutrientsPer100g": self.public_nutrients(profile["nutrients_per_100g"]),
            "allergens": list(
                profile.get("common_allergens", profile.get("allergens", []))
            ),
            "nutrientDensityUncertaintyPercent": float(
                profile["nutrient_density_uncertainty_pct"]
            ),
            "caveats": list(profile.get("caveats", [])),
            "profileStatus": "prototype_estimate",
        }

    def public_catalog(self, query: str | None, limit: int) -> dict[str, Any]:
        dishes = [self.public_profile(profile) for profile in self.search(query, limit)]
        return {
            "catalogVersion": self.version,
            "count": len(dishes),
            "dishes": dishes,
            "provenance": {
                "sourceType": "reference_tables_plus_project_recipe_estimates",
                "globalCaveats": self.global_caveats,
                "references": self.all_references(),
            },
        }
