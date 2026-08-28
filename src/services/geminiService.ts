import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  AnalyzedProduct,
  AnalysisMode,
  Nutrient,
  IngredientExplanation,
  AlternativeProduct,
  ChatMessage,
  UserProfile,
} from "../types";
import { buildNutrients, calculateNutriScore, getGradeColors } from "./nutritionScoringService";
import { getApiKey } from "./storageService";

function getClient(): GoogleGenerativeAI {
  const key = getApiKey();
  if (!key) throw new Error("Gemini API key not configured. Please add it in Profile → Settings.");
  return new GoogleGenerativeAI(key);
}

function imageDataUrlToGenerativePart(dataUrl: string) {
  const [meta, base64Data] = dataUrl.split(",");
  const mimeType = meta?.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  return {
    inlineData: { data: base64Data ?? "", mimeType },
  };
}

// ─── Packaged Food Label Analysis ─────────────────────────────────────────────

export async function analyzePackagedFoodImage(
  imageDataUrl: string,
  ocrText: string,
  onProgress?: (status: string) => void
): Promise<AnalyzedProduct> {
  onProgress?.("Analyzing food label with AI...");
  const client = getClient();
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a food nutrition analyst. Analyze this packaged food product label image.
${ocrText ? `\nOCR text extracted from the label:\n"""${ocrText}"""\n` : ""}
Return a JSON object (no markdown, no code fences) with these exact fields:
{
  "name": "product name",
  "brand": "brand/manufacturer",
  "servingSize": "e.g. 200ml or 30g",
  "ingredients": "full ingredients list as a single string",
  "allergens": ["list", "of", "allergens"],
  "calories": number (per 100g or per serving, specify),
  "saturatedFat": number in grams,
  "sugars": number in grams,
  "sodium": number in mg,
  "fiber": number in grams,
  "protein": number in grams,
  "per100g": true/false (whether values are per 100g or per serving)
}

Be as accurate as possible. If you can read values from the image, use those. If some values are unclear, make your best estimate based on the product type. Always provide all fields.`;

  const imagePart = imageDataUrlToGenerativePart(imageDataUrl);
  const result = await model.generateContent([prompt, imagePart]);
  const responseText = result.response.text();

  onProgress?.("Processing nutrition data...");

  let parsed: Record<string, unknown>;
  try {
    const jsonStr = responseText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse AI response. Please try scanning again.");
  }

  const nutrients = buildNutrients({
    calories: Number(parsed.calories) || 0,
    saturatedFat: Number(parsed.saturatedFat) || 0,
    sugars: Number(parsed.sugars) || 0,
    sodium: Number(parsed.sodium) || 0,
    fiber: Number(parsed.fiber) || 0,
    protein: Number(parsed.protein) || 0,
  });

  const { score, grade } = calculateNutriScore(nutrients);
  const { gradeColor, gradeBg } = getGradeColors(grade);

  return {
    id: `product_${Date.now()}`,
    name: String(parsed.name || "Unknown Product"),
    brand: String(parsed.brand || "Unknown Brand"),
    score,
    grade,
    gradeColor,
    gradeBg,
    kcal: Number(parsed.calories) || 0,
    servingSize: String(parsed.servingSize || "1 serving"),
    allergens: Array.isArray(parsed.allergens) ? parsed.allergens.map(String) : [],
    nutrients,
    aiSummary: "", // Will be filled by generateAISummary
    image: imageDataUrl,
    ingredients: String(parsed.ingredients || "Not available"),
    analysisMode: "label",
    rawOcrText: ocrText,
  };
}

// ─── Prepared Food Analysis ───────────────────────────────────────────────────

export async function analyzePreparedFoodImage(
  imageDataUrl: string,
  onProgress?: (status: string) => void
): Promise<AnalyzedProduct> {
  onProgress?.("Identifying food items...");
  const client = getClient();
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a nutritionist and food recognition expert. Analyze this image of prepared/cooked food.

Identify all visible food items and estimate their nutritional values combined.

Return a JSON object (no markdown, no code fences) with these exact fields:
{
  "name": "descriptive name of the dish/meal",
  "brand": "Homemade" or restaurant name if visible,
  "servingSize": "estimated portion size e.g. '1 plate (350g)'",
  "foodItems": ["list of identified food items"],
  "ingredients": "likely ingredients based on what you see",
  "allergens": ["potential allergens"],
  "calories": estimated total calories (number),
  "saturatedFat": estimated grams,
  "sugars": estimated grams,
  "sodium": estimated mg,
  "fiber": estimated grams,
  "protein": estimated grams,
  "carbs": estimated grams,
  "totalFat": estimated grams
}

Be realistic with estimates. Base them on typical portion sizes visible in the image.`;

  const imagePart = imageDataUrlToGenerativePart(imageDataUrl);
  const result = await model.generateContent([prompt, imagePart]);
  const responseText = result.response.text();

  onProgress?.("Estimating nutritional values...");

  let parsed: Record<string, unknown>;
  try {
    const jsonStr = responseText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("Failed to parse AI response. Please try again with a clearer image.");
  }

  const nutrients = buildNutrients({
    calories: Number(parsed.calories) || 0,
    saturatedFat: Number(parsed.saturatedFat) || 0,
    sugars: Number(parsed.sugars) || 0,
    sodium: Number(parsed.sodium) || 0,
    fiber: Number(parsed.fiber) || 0,
    protein: Number(parsed.protein) || 0,
  });

  const { score, grade } = calculateNutriScore(nutrients);
  const { gradeColor, gradeBg } = getGradeColors(grade);

  const foodItems = Array.isArray(parsed.foodItems) ? parsed.foodItems.map(String) : [];

  return {
    id: `food_${Date.now()}`,
    name: String(parsed.name || "Prepared Meal"),
    brand: String(parsed.brand || "Homemade"),
    score,
    grade,
    gradeColor,
    gradeBg,
    kcal: Number(parsed.calories) || 0,
    servingSize: String(parsed.servingSize || "1 serving"),
    allergens: Array.isArray(parsed.allergens) ? parsed.allergens.map(String) : [],
    nutrients,
    aiSummary: "",
    image: imageDataUrl,
    ingredients: foodItems.length > 0
      ? `Identified items: ${foodItems.join(", ")}. ${String(parsed.ingredients || "")}`
      : String(parsed.ingredients || "Not available"),
    analysisMode: "food",
  };
}

// ─── AI Summary Generation ────────────────────────────────────────────────────

export async function generateAISummary(
  product: AnalyzedProduct,
  userProfile?: UserProfile
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const profileContext = userProfile
    ? `\nUser profile: ${userProfile.allergens.length > 0 ? `Allergens: ${userProfile.allergens.join(", ")}. ` : ""}${userProfile.dietPreferences.length > 0 ? `Diet: ${userProfile.dietPreferences.join(", ")}. ` : ""}Daily calorie goal: ${userProfile.dailyCalories}kcal. Protein goal: ${userProfile.proteinGoal}g. Sodium limit: ${userProfile.sodiumLimit}mg.`
    : "";

  const prompt = `Write a concise 3-4 sentence health assessment for this food product. Be direct and actionable.
${profileContext}

Product: ${product.name} by ${product.brand}
Score: ${product.score}/100 (Grade ${product.grade})
Mode: ${product.analysisMode === "food" ? "Prepared food analysis (estimates)" : "Packaged food label"}
Serving: ${product.servingSize}
Nutrients: ${product.nutrients.map((n) => `${n.name}: ${n.value} (${n.rating})`).join(", ")}
Allergens: ${product.allergens.join(", ") || "None detected"}
Ingredients: ${product.ingredients}

${product.analysisMode === "food" ? "Note: Values are AI estimates from the food image." : ""}
Include personalized advice if user profile is available. Mention allergen warnings if relevant.`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ─── Ingredient Explanations ──────────────────────────────────────────────────

export async function explainIngredients(
  ingredients: string
): Promise<IngredientExplanation[]> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `Analyze these food ingredients and explain each one.

Ingredients: "${ingredients}"

Return a JSON array (no markdown, no code fences) where each element has:
{
  "name": "ingredient name",
  "purpose": "why it is used (1 sentence)",
  "healthNote": "health consideration (1 sentence)",
  "concern": "none" | "low" | "moderate" | "high"
}

Rate concern levels:
- "none": Natural/whole food ingredients
- "low": Generally safe additives, vitamins, minerals
- "moderate": Processed ingredients, may cause issues for sensitive individuals
- "high": Artificial additives, excess sodium/sugar sources, controversial preservatives

Be factual and balanced. Max 10 ingredients.`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const jsonStr = responseText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as IngredientExplanation[];
  } catch {
    return [];
  }
}

// ─── Alternative Product Suggestions ──────────────────────────────────────────

export async function suggestAlternatives(
  product: AnalyzedProduct,
  userProfile?: UserProfile
): Promise<AlternativeProduct[]> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a nutrition expert with extensive knowledge of food products available worldwide.

The user scanned: "${product.name}" by ${product.brand}
Score: ${product.score}/100 (Grade ${product.grade})
Key issues: ${product.nutrients.filter((n) => n.rating === "bad").map((n) => `${n.name}: ${n.value}`).join(", ") || "None"}
${userProfile?.allergens.length ? `User allergens to avoid: ${userProfile.allergens.join(", ")}` : ""}
${userProfile?.dietPreferences.length ? `User diet: ${userProfile.dietPreferences.join(", ")}` : ""}

Search your knowledge of real products available in stores and online. Suggest 3 healthier alternative products in the same category. These must be REAL products that actually exist and are commonly available.

Return a JSON array (no markdown, no code fences):
[
  {
    "name": "Real Product Name",
    "brand": "Actual Brand",
    "reason": "Why this is better (1 sentence, mention specific nutritional advantages)",
    "estimatedScore": number (0-100, your best estimate)
  }
]

Only suggest products that would be genuinely better. If the scanned product is already excellent (score 85+), say so and suggest equally good options.`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  try {
    const jsonStr = responseText.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr) as AlternativeProduct[];
  } catch {
    return [];
  }
}

// ─── Interactive Chat ─────────────────────────────────────────────────────────

export async function chatAboutFood(
  product: AnalyzedProduct,
  messages: ChatMessage[],
  userQuery: string,
  userProfile?: UserProfile
): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });

  const context = `You are NutriLens AI, a friendly nutrition assistant. You're discussing a food product with the user.

Product: ${product.name} by ${product.brand}
Score: ${product.score}/100 (Grade ${product.grade})
Serving: ${product.servingSize} (${product.kcal} kcal)
Nutrients: ${product.nutrients.map((n) => `${n.name}: ${n.value} (${n.rating})`).join(", ")}
Allergens: ${product.allergens.join(", ") || "None"}
Ingredients: ${product.ingredients}
Analysis type: ${product.analysisMode === "food" ? "AI-estimated from food photo" : "Extracted from product label"}
${userProfile ? `\nUser: ${userProfile.name}. Allergens: ${userProfile.allergens.join(", ") || "none"}. Diet: ${userProfile.dietPreferences.join(", ") || "no restrictions"}. Daily goals: ${userProfile.dailyCalories}kcal, ${userProfile.proteinGoal}g protein, ${userProfile.sodiumLimit}mg sodium limit.` : ""}

Answer the user's question concisely (2-3 sentences). Be helpful, accurate, and practical. You have access to broad internet knowledge about nutrition, food science, and health.`;

  const chatHistory = messages.map((m) => `${m.role === "user" ? "User" : "NutriLens"}: ${m.content}`).join("\n");

  const prompt = `${context}

${chatHistory ? `Previous conversation:\n${chatHistory}\n` : ""}
User: ${userQuery}

Respond as NutriLens AI:`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ─── API Key Validation ───────────────────────────────────────────────────────

export async function validateApiKey(key: string): Promise<boolean> {
  try {
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({ model: "gemini-2.0-flash" });
    await model.generateContent("Say OK");
    return true;
  } catch {
    return false;
  }
}
