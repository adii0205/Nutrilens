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
