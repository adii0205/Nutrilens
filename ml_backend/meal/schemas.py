"""API contracts for the Indian meal analysis pipeline."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MealItemInput(StrictRequestModel):
    itemId: str | None = Field(default=None, min_length=1, max_length=80)
    dishId: str = Field(min_length=1, max_length=100)
    portionGrams: float | None = Field(default=None, gt=0, le=2_000)
    servings: float = Field(default=1.0, gt=0, le=20)
    portionBasis: Literal["estimated", "measured"] = "estimated"

    @model_validator(mode="after")
    def validate_portion_fields(self):
        if self.portionBasis == "measured" and self.portionGrams is None:
            raise ValueError("portionGrams is required when portionBasis is 'measured'.")
        if self.portionGrams is not None and self.servings != 1:
            raise ValueError(
                "Send either portionGrams or servings; portionGrams already represents the total portion."
            )
        return self


class MealAnalysisInput(StrictRequestModel):
    imageDataUrl: str = Field(min_length=1)
    items: list[MealItemInput] | None = None


class MealRecalculateInput(StrictRequestModel):
    items: list[MealItemInput] = Field(min_length=1, max_length=30)


class NutrientValues(BaseModel):
    calories: float
    protein: float
    fat: float
    carbohydrates: float
    fiber: float
    sugars: float
    saturatedFat: float
    sodium: float


class NutrientRange(BaseModel):
    estimated: NutrientValues
    minimum: NutrientValues
    maximum: NutrientValues


class PortionResult(BaseModel):
    selectedGrams: float
    minimumGrams: float
    maximumGrams: float
    basis: Literal[
        "standard_portion_profile",
        "user_estimated_weight",
        "user_measured_weight",
    ]
    description: str


class SourceReference(BaseModel):
    id: str
    name: str
    url: str


class ProfileProvenance(BaseModel):
    catalogVersion: str
    profileStatus: Literal["prototype_estimate"]
    sourceRefs: list[str]
    references: list[SourceReference]
    caveats: list[str]


class MealItemResult(BaseModel):
    itemId: str
    dishId: str
    name: str
    category: str
    recognitionSource: Literal["user_confirmed", "model"]
    confidence: float | None = Field(default=None, ge=0, le=1)
    portion: PortionResult
    nutrients: NutrientRange
    allergens: list[str]
    provenance: ProfileProvenance


class RecognitionResult(BaseModel):
    status: Literal[
        "recognized", "low_confidence", "model_not_available", "user_confirmed"
    ]
    modelLoaded: bool
    modelName: str | None
    confidence: float | None = Field(default=None, ge=0, le=1)
    message: str
    nextAction: Literal["select_dishes", "review_portions"]


class MealAnalysisData(BaseModel):
    analysisId: str
    status: Literal["needs_confirmation", "complete"]
    requiresUserConfirmation: bool
    requiresPortionConfirmation: bool
    recognition: RecognitionResult
    items: list[MealItemResult]
    totals: NutrientRange
    units: dict[str, str]
    limitations: list[str]


class MealAnalysisResponse(BaseModel):
    success: Literal[True] = True
    data: MealAnalysisData


class DefaultPortion(BaseModel):
    grams: float
    minimumGrams: float
    maximumGrams: float
    description: str


class DishCatalogueItem(BaseModel):
    id: str
    name: str
    aliases: list[str]
    category: str
    defaultPortion: DefaultPortion
    nutrientsPer100g: NutrientValues
    allergens: list[str]
    nutrientDensityUncertaintyPercent: float
    caveats: list[str]
    profileStatus: Literal["prototype_estimate"]


class CatalogueProvenance(BaseModel):
    sourceType: Literal["reference_tables_plus_project_recipe_estimates"]
    globalCaveats: list[str]
    references: list[SourceReference]


class DishCatalogueData(BaseModel):
    catalogVersion: str
    count: int
    dishes: list[DishCatalogueItem]
    provenance: CatalogueProvenance


class DishCatalogueResponse(BaseModel):
    success: Literal[True] = True
    data: DishCatalogueData
