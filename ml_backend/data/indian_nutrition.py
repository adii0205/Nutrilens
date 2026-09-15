"""Load cautious Indian meal nutrition profiles.

These profiles are engineering reference estimates. They are deliberately kept
separate from image recognition so callers cannot confuse a visual class score
with measured nutrient composition.
"""

from __future__ import annotations

import json
import math
import re
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(__file__).with_name("indian_nutrition_profiles.json")
NUTRIENT_FIELDS = (
    "energy_kcal",
    "protein_g",
    "fat_g",
    "carbohydrate_g",
    "fiber_g",
    "sugars_g",
    "saturated_fat_g",
    "sodium_mg",
)


def _normalise_name(value: str) -> str:
    if not isinstance(value, str):
        raise TypeError("Food name must be a string.")
    return re.sub(r"[^a-z0-9]+", " ", value.casefold()).strip()


def _validate_catalog(catalog: dict[str, Any]) -> None:
    if not isinstance(catalog, dict) or not catalog.get("schema_version"):
        raise ValueError("Nutrition catalog must contain a schema_version.")
    if not isinstance(catalog.get("sources"), list) or not catalog["sources"]:
        raise ValueError("Nutrition catalog must document at least one source.")
    if not isinstance(catalog.get("global_caveats"), list) or not catalog["global_caveats"]:
        raise ValueError("Nutrition catalog must include global caveats.")

    source_ids = {source.get("id") for source in catalog["sources"]}
    if None in source_ids or len(source_ids) != len(catalog["sources"]):
        raise ValueError("Nutrition source IDs must be present and unique.")

    profiles = catalog.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise ValueError("Nutrition catalog must contain profiles.")

    profile_ids: set[str] = set()
    searchable_names: dict[str, str] = {}
    for profile in profiles:
        profile_id = profile.get("id")
        if not isinstance(profile_id, str) or not profile_id:
            raise ValueError("Every profile must have an ID.")
        if profile_id in profile_ids:
            raise ValueError(f"Duplicate nutrition profile ID: {profile_id}")
        profile_ids.add(profile_id)

        names = [profile.get("display_name"), *profile.get("aliases", [])]
        for name in names:
            key = _normalise_name(name)
            if not key:
                raise ValueError(f"Profile {profile_id} has an empty searchable name.")
            owner = searchable_names.get(key)
            if owner and owner != profile_id:
                raise ValueError(f"Nutrition alias '{name}' is shared by {owner} and {profile_id}.")
            searchable_names[key] = profile_id

        nutrients = profile.get("nutrients_per_100g")
        if not isinstance(nutrients, dict) or set(nutrients) != set(NUTRIENT_FIELDS):
            raise ValueError(f"Profile {profile_id} has an invalid nutrient schema.")
        for nutrient, value in nutrients.items():
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError(f"Profile {profile_id} has invalid {nutrient}.")

        portion = profile.get("typical_portion")
        if not isinstance(portion, dict):
            raise ValueError(f"Profile {profile_id} has no portion metadata.")
        minimum = portion.get("min_g")
        default = portion.get("default_g")
        maximum = portion.get("max_g")
        if not all(isinstance(value, (int, float)) for value in (minimum, default, maximum)):
            raise ValueError(f"Profile {profile_id} has invalid portion values.")
        if not 0 < minimum <= default <= maximum:
            raise ValueError(f"Profile {profile_id} portion range does not contain its default.")

        uncertainty = profile.get("nutrient_density_uncertainty_pct")
        if not isinstance(uncertainty, (int, float)) or not 0 <= uncertainty <= 100:
            raise ValueError(f"Profile {profile_id} has invalid uncertainty metadata.")
        if not profile.get("caveats"):
            raise ValueError(f"Profile {profile_id} must include an estimate caveat.")
        refs = profile.get("source_refs")
        if not refs or not set(refs).issubset(source_ids):
            raise ValueError(f"Profile {profile_id} contains unknown source references.")


@lru_cache(maxsize=1)
def _cached_catalog() -> dict[str, Any]:
    with CATALOG_PATH.open("r", encoding="utf-8") as catalog_file:
        catalog = json.load(catalog_file)
    _validate_catalog(catalog)
    return catalog


def load_catalog() -> dict[str, Any]:
    """Return a defensive copy of the validated, versioned catalog."""

    return deepcopy(_cached_catalog())


@lru_cache(maxsize=1)
def _profile_index() -> dict[str, dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for profile in _cached_catalog()["profiles"]:
        for name in [profile["display_name"], *profile["aliases"]]:
            index[_normalise_name(name)] = profile
    return index


def lookup_profile(name: str) -> dict[str, Any] | None:
    """Find a profile by its display name or alias, or return ``None``."""

    profile = _profile_index().get(_normalise_name(name))
    return deepcopy(profile) if profile else None


def list_profiles() -> list[dict[str, Any]]:
    """Return all profiles in stable catalog order."""

    return deepcopy(_cached_catalog()["profiles"])


def estimate_nutrients(name: str, portion_g: float | None = None) -> dict[str, Any] | None:
    """Scale one reference profile to a portion and return an indicative range.

    The range reflects the catalog's recipe-density sensitivity allowance. It is
    not a calibrated statistical confidence interval and does not include image
    model or portion-estimation error.
    """

    profile = lookup_profile(name)
    if profile is None:
        return None

    if portion_g is None:
        portion_g = float(profile["typical_portion"]["default_g"])
    if (
        isinstance(portion_g, bool)
        or not isinstance(portion_g, (int, float))
        or not math.isfinite(portion_g)
        or portion_g <= 0
    ):
        raise ValueError("Portion must be a finite number greater than zero grams.")

    scaled = {
        nutrient: round(value * portion_g / 100.0, 2)
        for nutrient, value in profile["nutrients_per_100g"].items()
    }
    uncertainty = profile["nutrient_density_uncertainty_pct"] / 100.0
    indicative_range = {
        nutrient: {
            "min": round(max(0.0, value * (1.0 - uncertainty)), 2),
            "max": round(value * (1.0 + uncertainty), 2),
        }
        for nutrient, value in scaled.items()
    }

    catalog = _cached_catalog()
    return {
        "profile_id": profile["id"],
        "food_name": profile["display_name"],
        "portion_g": round(float(portion_g), 2),
        "estimated_nutrients": scaled,
        "indicative_nutrient_range": indicative_range,
        "range_basis": (
            "Symmetric recipe-density sensitivity band; not a calibrated confidence interval "
            "and does not include portion-model error."
        ),
        "source_refs": profile["source_refs"],
        "caveats": [*catalog["global_caveats"], *profile["caveats"]],
    }
