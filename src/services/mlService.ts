import type {
  MLEstimatedNutrients,
  MLPredictionResult,
  Nutrient,
} from "../types";

const ML_API_BASE_URL = (
  import.meta.env.VITE_ML_API_BASE_URL || "http://localhost:8000"
).replace(/\/$/, "");

type BackendHealth = {
  status?: string;
};

type BackendAnalysisResponse = {
  success?: boolean;
  data?: {
    vision?: {
      predictedFoodName?: string;
      category?: string;
      confidence?: number | null;
      modelArchitecture?: string;
      inferenceSource?: "trained_model" | "heuristic_baseline";
      topPredictions?: Array<{
        label: string;
        category: string;
        relativeScore: number;
      }>;
      estimatedNutrients?: MLEstimatedNutrients;
      allergens?: string[];
      healthNote?: string;
    };
    health?: Omit<MLPredictionResult, "predictedFoodName" | "category">;
  };
};

export async function checkMLBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${ML_API_BASE_URL}/api/ml/health`, {
      method: "GET",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as BackendHealth;
    return data.status === "healthy";
  } catch {
    return false;
  }
}

function nutrientsToInput(
  nutrients?: Nutrient[],
): MLEstimatedNutrients | undefined {
  if (!nutrients?.length) return undefined;

  const values: Partial<MLEstimatedNutrients> = {};
  for (const nutrient of nutrients) {
    const key = nutrient.name.toLowerCase();
    const value = nutrient.per100g;
    if (!Number.isFinite(value) || value < 0) continue;

    if (key.includes("calori") || key.includes("energy")) values.calories = value;
    else if (key.includes("saturated")) values.saturatedFat = value;
    else if (key.includes("sugar")) values.sugars = value;
    else if (key.includes("sodium")) values.sodium = value;
    else if (key.includes("fib")) values.fiber = value;
    else if (key.includes("protein")) values.protein = value;
  }

  const required: Array<keyof MLEstimatedNutrients> = [
    "calories",
    "saturatedFat",
    "sugars",
    "sodium",
    "fiber",
    "protein",
  ];
  if (!required.every((key) => values[key] !== undefined)) return undefined;
  return values as MLEstimatedNutrients;
}

export async function analyzeWithMLModel(
  imageDataUrl: string,
  nutrients?: Nutrient[],
  onProgress?: (status: string) => void,
): Promise<MLPredictionResult> {
  onProgress?.("Connecting to the Python analysis backend...");
  const nutrientInput = nutrientsToInput(nutrients);

  if (await checkMLBackendHealth()) {
    onProgress?.("Running the image baseline and health scoring pipeline...");
    const response = await fetch(`${ML_API_BASE_URL}/api/ml/analyze-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageDataUrl,
        ...(nutrientInput ? { nutrients: nutrientInput } : {}),
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`ML backend rejected the scan (${response.status}): ${message}`);
    }

    const json = (await response.json()) as BackendAnalysisResponse;
    const vision = json.data?.vision;
    const health = json.data?.health;
    if (!json.success || !vision || !health) {
      throw new Error("ML backend returned an incomplete response.");
    }

    return {
      ...health,
      predictedFoodName: vision.predictedFoodName,
      category: vision.category,
      modelArchitecture: vision.modelArchitecture,
      healthNote: vision.healthNote,
      estimatedNutrients: vision.estimatedNutrients,
      allergens: vision.allergens,
      topPredictions: vision.topPredictions,
      // A heuristic baseline deliberately reports null instead of a
      // fabricated probability.
      confidence: vision.confidence ?? health.confidence ?? null,
      inferenceSource:
        health.inferenceSource === "trained_model"
          ? "trained_model"
          : vision.inferenceSource ?? health.inferenceSource,
    };
  }

  if (nutrientInput) {
    onProgress?.("Backend unavailable; applying the transparent local health score...");
    return runClientSideRuleBasedScoring(nutrientInput);
  }

  throw new Error(
    "The Python analysis backend is unavailable. Start it on port 8000 or configure VITE_ML_API_BASE_URL.",
  );
}

function runClientSideRuleBasedScoring(
  nutrients: MLEstimatedNutrients,
): MLPredictionResult {
  const { calories, saturatedFat, sugars, sodium, fiber, protein } = nutrients;
  const negativeScore =
    (calories / 800) * 25 +
    (saturatedFat / 25) * 25 +
    (sugars / 50) * 25 +
    (sodium / 2000) * 25;
  const positiveScore = (fiber / 15) * 50 + (protein / 40) * 50;
  const healthScore = Math.max(
    5,
    Math.min(98, Math.round(100 - negativeScore + positiveScore * 0.4)),
  );

  let predictedGrade: "A" | "B" | "C" | "D" | "F";
  if (healthScore >= 80) predictedGrade = "A";
  else if (healthScore >= 62) predictedGrade = "B";
  else if (healthScore >= 45) predictedGrade = "C";
  else if (healthScore >= 28) predictedGrade = "D";
  else predictedGrade = "F";

  const riskFactors: NonNullable<MLPredictionResult["riskFactors"]> = [];
  if (saturatedFat > 5) {
    riskFactors.push({
      factor: "High Saturated Fat",
      severity: saturatedFat > 10 ? "high" : "moderate",
      message: `Saturated fat (${saturatedFat.toFixed(1)}g/100g) exceeds the 5.0g project threshold.`,
    });
  }
  if (sugars > 12.5) {
    riskFactors.push({
      factor: "Elevated Sugar",
      severity: sugars > 22 ? "high" : "moderate",
      message: `Sugar content is ${sugars.toFixed(1)}g/100g.`,
    });
  }
  if (sodium > 600) {
    riskFactors.push({
      factor: "Elevated Sodium",
      severity: sodium > 1000 ? "high" : "moderate",
      message: `Sodium content is ${Math.round(sodium)}mg/100g.`,
    });
  }
  if (fiber >= 3) {
    riskFactors.push({
      factor: "Fiber Contribution",
      severity: "good",
      message: `Fiber contributes positively at ${fiber.toFixed(1)}g/100g.`,
    });
  }
  if (protein >= 8) {
    riskFactors.push({
      factor: "Protein Contribution",
      severity: "good",
      message: `Protein contributes positively at ${protein.toFixed(1)}g/100g.`,
    });
  }

  return {
    predictedGrade,
    healthScore,
    confidence: null,
    modelName: "NutriLens rule-based health baseline",
    modelArchitecture: "Transparent weighted nutrient formula",
    inferenceSource: "rule_based",
    explanationMethod: "rule_contribution",
    nutrientSource: "provided_label_values",
    nutrientsUsed: nutrients,
    riskFactors,
    estimatedNutrients: nutrients,
    featureImportance: [
      { name: "Calories", impact: Math.round((calories / 800) * 30), direction: "negative" },
      { name: "Saturated Fat", impact: Math.round((saturatedFat / 25) * 30), direction: "negative" },
      { name: "Sugars", impact: Math.round((sugars / 50) * 25), direction: "negative" },
      { name: "Sodium", impact: Math.round((sodium / 2000) * 25), direction: "negative" },
      { name: "Fiber", impact: Math.round((fiber / 15) * 25), direction: "positive" },
      { name: "Protein", impact: Math.round((protein / 40) * 25), direction: "positive" },
    ],
  };
}
