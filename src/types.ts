export type NutrientRating = "good" | "moderate" | "bad";

export interface Nutrient {
  name: string;
  value: string;
  per100g: number;
  rating: NutrientRating;
  detail: string;
}

export interface IngredientExplanation {
  name: string;
  purpose: string;
  healthNote: string;
  concern: "none" | "low" | "moderate" | "high";
}

export interface MLRiskFactor {
  factor: string;
  severity: "good" | "moderate" | "high";
  message: string;
}

export interface MLFeatureImportance {
  name: string;
  impact: number;
  direction: "positive" | "negative";
}

export interface MLEstimatedNutrients {
  calories: number;
  saturatedFat: number;
  sugars: number;
  sodium: number;
  fiber: number;
  protein: number;
}

export interface MLTopPrediction {
  label: string;
  category: string;
  relativeScore: number;
}

export interface MLPredictionResult {
  predictedFoodName?: string;
  category?: string;
  predictedGrade: "A" | "B" | "C" | "D" | "F";
  healthScore: number;
  confidence: number | null;
  modelName: string;
  modelArchitecture?: string;
  inferenceSource: "trained_model" | "rule_based" | "heuristic_baseline";
  explanationMethod?: "model_feature_importance" | "rule_contribution";
  nutrientSource?: "provided_label_values" | "class_profile_estimate";
  nutrientsUsed?: MLEstimatedNutrients;
  riskFactors?: MLRiskFactor[];
  featureImportance?: MLFeatureImportance[];
  healthNote?: string;
  estimatedNutrients?: MLEstimatedNutrients;
  allergens?: string[];
  topPredictions?: MLTopPrediction[];
}

export interface MealNutrients {
  calories: number;
  protein: number;
  fat: number;
  carbohydrates: number;
  fiber: number;
  sugars: number;
  saturatedFat: number;
  sodium: number;
}

export interface MealNutrientEstimate {
  estimated: MealNutrients;
  minimum: MealNutrients;
  maximum: MealNutrients;
}

export interface MealPortionEstimate {
  selectedGrams: number;
  minimumGrams: number;
  maximumGrams: number;
  basis:
    | "standard_portion_profile"
    | "user_estimated_weight"
    | "user_measured_weight";
  description: string;
}

export interface MealSourceReference {
  id: string;
  name: string;
  url: string;
}

export interface MealProvenance {
  catalogVersion: string;
  profileStatus: "prototype_estimate";
  sourceRefs: string[];
  references: MealSourceReference[];
  caveats: string[];
}

export interface MealAnalysisItem {
  itemId: string;
  dishId: string;
  name: string;
  category: string;
  recognitionSource: "model" | "user_confirmed" | "user_selected" | string;
  confidence?: number | null;
  portion: MealPortionEstimate;
  nutrients: MealNutrientEstimate;
  allergens: string[];
  provenance: MealProvenance;
}

export interface MealRecognitionStatus {
  status: "recognized" | "low_confidence" | "model_not_available" | string;
  modelLoaded: boolean;
  modelName: string | null;
  confidence: number | null;
  message: string;
  nextAction: "select_dishes" | "review_portions";
}

export interface IndianMealAnalysis {
  analysisId: string;
  status: "complete" | "needs_confirmation" | string;
  requiresUserConfirmation: boolean;
  requiresPortionConfirmation: boolean;
  recognition: MealRecognitionStatus;
  items: MealAnalysisItem[];
  totals: MealNutrientEstimate;
  units: {
    calories: "kcal" | string;
    protein: "g" | string;
    fat: "g" | string;
    carbohydrates: "g" | string;
    fiber: "g" | string;
    sugars: "g" | string;
    saturatedFat: "g" | string;
    sodium: "mg" | string;
  };
  limitations: string[];
}

export interface MealItemInput {
  itemId?: string;
  dishId: string;
  portionGrams?: number;
  servings?: number;
  portionBasis?: "estimated" | "measured";
}

export interface IndianDishOption {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  defaultPortion: {
    grams: number;
    minimumGrams: number;
    maximumGrams: number;
    description: string;
  };
  nutrientsPer100g: MealNutrients;
  allergens: string[];
  nutrientDensityUncertaintyPercent: number;
  caveats: string[];
  profileStatus: "prototype_estimate";
}

export interface AnalyzedProduct {
  id: string;
  name: string;
  brand: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  gradeColor: string;
  gradeBg: string;
  kcal: number;
  servingSize: string;
  allergens: string[];
  nutrients: Nutrient[];
  aiSummary: string;
  image: string;
  ingredients: string;
  ingredientExplanations?: IngredientExplanation[];
  alternatives?: AlternativeProduct[];
  analysisMode: AnalysisMode;
  rawOcrText?: string;
  mlPrediction?: MLPredictionResult;
  mealAnalysis?: IndianMealAnalysis;
}

export interface AlternativeProduct {
  name: string;
  brand: string;
  reason: string;
  estimatedScore: number;
}

export type AnalysisMode = "label" | "food";

export interface UserProfile {
  name: string;
  email: string;
  allergens: string[];
  dietPreferences: string[];
  dailyCalories: number;
  proteinGoal: number;
  sodiumLimit: number;
}

export interface ScanHistoryItem {
  id: string;
  product: AnalyzedProduct;
  scannedAt: string; // ISO timestamp
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: "User",
  email: "",
  allergens: [],
  dietPreferences: [],
  dailyCalories: 2000,
  proteinGoal: 55,
  sodiumLimit: 2300,
};
