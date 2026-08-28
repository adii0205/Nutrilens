import type { Nutrient, NutrientRating } from "../types";

interface NutrientThresholds {
  good: number;
  moderate: number;
  // above moderate = bad
}

// Thresholds per 100g (based on simplified Nutri-Score criteria)
const THRESHOLDS: Record<string, NutrientThresholds> = {
  calories: { good: 80, moderate: 250 },
  saturatedFat: { good: 1.5, moderate: 5 },
  sugars: { good: 5, moderate: 12.5 },
  sodium: { good: 120, moderate: 600 },
  fiber: { good: 3, moderate: 1.5 }, // inverted: high fiber is good
  protein: { good: 8, moderate: 4 }, // inverted: high protein is good
};

export function rateNutrient(name: string, valuePer100g: number): NutrientRating {
  const key = name.toLowerCase().replace(/\s+/g, "");

  // Fiber and protein: higher is better
  if (key.includes("fib") || key.includes("protein")) {
    const t = key.includes("fib") ? THRESHOLDS.fiber : THRESHOLDS.protein;
    if (valuePer100g >= t.good) return "good";
    if (valuePer100g >= t.moderate) return "moderate";
    return "bad";
  }

  // Everything else: lower is better
  let t: NutrientThresholds;
  if (key.includes("calori") || key.includes("energy")) t = THRESHOLDS.calories;
  else if (key.includes("saturated")) t = THRESHOLDS.saturatedFat;
  else if (key.includes("sugar")) t = THRESHOLDS.sugars;
  else if (key.includes("sodium") || key.includes("salt")) t = THRESHOLDS.sodium;
  else t = THRESHOLDS.calories; // fallback

  if (valuePer100g <= t.good) return "good";
  if (valuePer100g <= t.moderate) return "moderate";
  return "bad";
}

export function generateNutrientDetail(name: string, rating: NutrientRating, value: number): string {
  const key = name.toLowerCase();

  if (key.includes("calori")) {
    if (rating === "good") return "Low calorie";
    if (rating === "moderate") return "Moderate energy";
    return "Very high energy density";
  }
  if (key.includes("saturated")) {
    if (rating === "good") return "Very low — heart healthy";
    if (rating === "moderate") return "Moderate — watch intake";
    return "High — raises LDL cholesterol";
  }
  if (key.includes("sugar")) {
    if (rating === "good") return "Low sugar";
    if (rating === "moderate") return "Moderate sugar content";
    return "High sugar — limit intake";
  }
  if (key.includes("sodium") || key.includes("salt")) {
    if (rating === "good") return "Low sodium";
    if (rating === "moderate") return "Moderate sodium";
    return `Very high sodium — ${Math.round(value)}mg`;
  }
  if (key.includes("fib")) {
    if (rating === "good") return "Excellent fibre source";
    if (rating === "moderate") return "Some fibre";
    return "Low fibre";
  }
  if (key.includes("protein")) {
    if (rating === "good") return "Excellent protein";
    if (rating === "moderate") return "Moderate protein";
    return "Low protein";
  }
  return rating === "good" ? "Good level" : rating === "moderate" ? "Moderate" : "Concerning level";
}

export interface NutritionInput {
  calories?: number;
  saturatedFat?: number;
  sugars?: number;
  sodium?: number; // in mg
  fiber?: number;
  protein?: number;
  servingSize?: string;
}

export function buildNutrients(input: NutritionInput): Nutrient[] {
  const nutrients: Nutrient[] = [];

  if (input.calories !== undefined) {
    const rating = rateNutrient("Calories", input.calories);
    nutrients.push({
      name: "Calories",
      value: `${Math.round(input.calories)} kcal`,
      per100g: input.calories,
      rating,
      detail: generateNutrientDetail("Calories", rating, input.calories),
    });
  }

  if (input.saturatedFat !== undefined) {
    const rating = rateNutrient("Saturated Fat", input.saturatedFat);
    nutrients.push({
      name: "Saturated Fat",
      value: `${input.saturatedFat.toFixed(1)}g`,
      per100g: input.saturatedFat,
      rating,
      detail: generateNutrientDetail("Saturated Fat", rating, input.saturatedFat),
    });
  }

  if (input.sugars !== undefined) {
    const rating = rateNutrient("Sugars", input.sugars);
    nutrients.push({
      name: "Sugars",
      value: `${input.sugars.toFixed(1)}g`,
      per100g: input.sugars,
      rating,
      detail: generateNutrientDetail("Sugars", rating, input.sugars),
    });
  }

  if (input.sodium !== undefined) {
    const rating = rateNutrient("Sodium", input.sodium);
    nutrients.push({
      name: "Sodium",
      value: `${Math.round(input.sodium)}mg`,
      per100g: input.sodium,
      rating,
      detail: generateNutrientDetail("Sodium", rating, input.sodium),
    });
  }

  if (input.fiber !== undefined) {
    const rating = rateNutrient("Fibre", input.fiber);
    nutrients.push({
      name: "Fibre",
      value: `${input.fiber.toFixed(1)}g`,
      per100g: input.fiber,
      rating,
      detail: generateNutrientDetail("Fibre", rating, input.fiber),
    });
  }

  if (input.protein !== undefined) {
    const rating = rateNutrient("Protein", input.protein);
    nutrients.push({
      name: "Protein",
      value: `${input.protein.toFixed(1)}g`,
      per100g: input.protein,
      rating,
      detail: generateNutrientDetail("Protein", rating, input.protein),
    });
  }

  return nutrients;
}

export function calculateNutriScore(nutrients: Nutrient[]): { score: number; grade: "A" | "B" | "C" | "D" | "F" } {
  let negativePoints = 0;
  let positivePoints = 0;

  for (const n of nutrients) {
    if (n.name === "Calories" || n.name === "Saturated Fat" || n.name === "Sugars" || n.name === "Sodium") {
      if (n.rating === "bad") negativePoints += 3;
      else if (n.rating === "moderate") negativePoints += 1.5;
    }
    if (n.name === "Fibre" || n.name === "Protein") {
      if (n.rating === "good") positivePoints += 3;
      else if (n.rating === "moderate") positivePoints += 1.5;
    }
  }

  // Score out of 100: fewer negative + more positive = higher score
  const maxNeg = 12; // 4 nutrients × 3
  const maxPos = 6;  // 2 nutrients × 3
  const rawScore = ((maxNeg - negativePoints) / maxNeg) * 70 + (positivePoints / maxPos) * 30;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let grade: "A" | "B" | "C" | "D" | "F";
  if (score >= 80) grade = "A";
  else if (score >= 60) grade = "B";
  else if (score >= 40) grade = "C";
  else if (score >= 20) grade = "D";
  else grade = "F";

  return { score, grade };
}

export function getGradeColors(grade: "A" | "B" | "C" | "D" | "F"): { gradeColor: string; gradeBg: string } {
  switch (grade) {
    case "A": return { gradeColor: "#1B7A43", gradeBg: "#E9F7EF" };
    case "B": return { gradeColor: "#6BAF45", gradeBg: "#EFF7E9" };
    case "C": return { gradeColor: "#F5A623", gradeBg: "#FFF4E0" };
    case "D": return { gradeColor: "#E4483C", gradeBg: "#FDEAE9" };
    case "F": return { gradeColor: "#B91C1C", gradeBg: "#FDE2E2" };
  }
}
