import type {
  AnalyzedProduct,
  IndianDishOption,
  IndianMealAnalysis,
  MealItemInput,
  MealNutrients,
  Nutrient,
} from "../types";

const ML_API_BASE_URL = (
  import.meta.env.VITE_ML_API_BASE_URL || "http://localhost:8000"
).replace(/\/$/, "");

type MealApiResponse = {
  success?: boolean;
  data?: IndianMealAnalysis;
  detail?: string | Array<{ msg?: string }>;
};

type DishCatalogueResponse = {
  success?: boolean;
  data?: IndianDishOption[] | { dishes?: IndianDishOption[] };
  dishes?: IndianDishOption[];
  detail?: string | Array<{ msg?: string }>;
};

function errorMessage(payload: MealApiResponse | DishCatalogueResponse | null): string {
  if (!payload?.detail) return "The meal service returned an unexpected response.";
  if (typeof payload.detail === "string") return payload.detail;
  return payload.detail.map((item) => item.msg).filter(Boolean).join(" ") || "The meal request was rejected.";
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function postMealRequest(
  path: "/api/v1/meals/analyze" | "/api/v1/meals/recalculate",
  body: { imageDataUrl?: string; items?: MealItemInput[] },
): Promise<IndianMealAnalysis> {
  let response: Response;
  try {
    response = await fetch(`${ML_API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "The Indian meal service is unavailable. Start the Python backend on port 8000 and try again.",
    );
  }

  const payload = await readJson<MealApiResponse>(response);
  if (!response.ok) throw new Error(errorMessage(payload));
  if (!payload?.success || !payload.data) {
    throw new Error("The meal service returned incomplete analysis data.");
  }
  return payload.data;
}

export function analyzeIndianMeal(
  imageDataUrl: string,
  items?: MealItemInput[],
): Promise<IndianMealAnalysis> {
  return postMealRequest("/api/v1/meals/analyze", {
    imageDataUrl,
    ...(items?.length ? { items } : {}),
  });
}

export function recalculateIndianMeal(items: MealItemInput[]): Promise<IndianMealAnalysis> {
  if (items.length === 0) {
    return Promise.reject(new Error("Select at least one dish before calculating nutrition."));
  }
  return postMealRequest("/api/v1/meals/recalculate", { items });
}

export async function getIndianDishCatalogue(
  query = "",
  limit = 100,
): Promise<IndianDishOption[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set("query", query.trim());

  let response: Response;
  try {
    response = await fetch(`${ML_API_BASE_URL}/api/v1/meals/dishes?${params}`);
  } catch {
    throw new Error(
      "The Indian dish catalogue is unavailable. Start the Python backend on port 8000 and try again.",
    );
  }

  const payload = await readJson<DishCatalogueResponse>(response);
  if (!response.ok) throw new Error(errorMessage(payload));
  const data = payload?.data;
  const dishes = Array.isArray(data)
    ? data
    : data?.dishes ?? payload?.dishes;
  if (!payload?.success || !dishes) {
    throw new Error("The meal service returned an invalid dish catalogue.");
  }
  return dishes;
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function nutrientRows(nutrients: MealNutrients): Nutrient[] {
  const rows: Array<[string, number, string, string]> = [
    ["Calories", nutrients.calories, "kcal", "Estimated energy for the confirmed portions"],
    ["Protein", nutrients.protein, "g", "Estimated protein for the confirmed portions"],
    ["Total Fat", nutrients.fat, "g", "Estimated total fat for the confirmed portions"],
    ["Carbohydrates", nutrients.carbohydrates, "g", "Estimated carbohydrates for the confirmed portions"],
    ["Fibre", nutrients.fiber, "g", "Estimated dietary fibre for the confirmed portions"],
    ["Sugars", nutrients.sugars, "g", "Estimated sugars for the confirmed portions"],
    ["Saturated Fat", nutrients.saturatedFat, "g", "Estimated saturated fat for the confirmed portions"],
    ["Sodium", nutrients.sodium, "mg", "Estimated sodium for the confirmed portions"],
  ];

  return rows.map(([name, value, unit, detail]) => ({
    name,
    value: `${oneDecimal(value)} ${unit}`,
    per100g: oneDecimal(value),
    rating: "moderate",
    detail,
  }));
}

export function mealAnalysisToProduct(
  imageDataUrl: string,
  analysis: IndianMealAnalysis,
): AnalyzedProduct {
  const totalGrams = analysis.items.reduce(
    (sum, item) => sum + item.portion.selectedGrams,
    0,
  );
  const names = analysis.items.map((item) => item.name);
  const allergens = Array.from(new Set(analysis.items.flatMap((item) => item.allergens)));
  const mealName = names.length > 0 ? names.join(" + ") : "Indian meal";

  return {
    id: analysis.analysisId || `meal_${Date.now()}`,
    name: mealName,
    brand: "Meal nutrition estimate",
    // Meal health grading is deliberately not calculated. These compatibility
    // fields are hidden anywhere a meal analysis is rendered.
    score: 0,
    grade: "C",
    gradeColor: "#5A6472",
    gradeBg: "#F1F5F9",
    kcal: oneDecimal(analysis.totals.estimated.calories),
    servingSize: totalGrams > 0 ? `${oneDecimal(totalGrams)} g selected portion` : "Portion not confirmed",
    allergens,
    nutrients: nutrientRows(analysis.totals.estimated),
    aiSummary: analysis.limitations.join(" "),
    image: imageDataUrl,
    ingredients: names.length > 0 ? `Confirmed dishes: ${names.join(", ")}` : "No dishes confirmed",
    analysisMode: "food",
    mealAnalysis: analysis,
  };
}
