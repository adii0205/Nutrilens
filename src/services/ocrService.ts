import Tesseract from "tesseract.js";

let worker: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await Tesseract.createWorker("eng", undefined, {
      logger: () => {},
    });
  }
  return worker;
}

export async function extractTextFromImage(
  imageDataUrl: string,
  onProgress?: (status: string) => void
): Promise<{ text: string; confidence: number }> {
  onProgress?.("Loading OCR engine...");
  const w = await getWorker();

  onProgress?.("Recognizing text...");
  const result = await w.recognize(imageDataUrl);
  const text = result.data.text;
  const confidence = result.data.confidence;

  return { text: text.trim(), confidence };
}

export interface ParsedNutrition {
  calories?: number;
  totalFat?: number;
  saturatedFat?: number;
  transFat?: number;
  cholesterol?: number;
  sodium?: number;
  totalCarbs?: number;
  dietaryFiber?: number;
  sugars?: number;
  protein?: number;
  servingSize?: string;
}

export function parseNutritionLabel(ocrText: string): ParsedNutrition {
  const result: ParsedNutrition = {};
  const text = ocrText.toLowerCase();

  const extractNumber = (patterns: RegExp[]): number | undefined => {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const num = parseFloat(match[1]);
        if (!isNaN(num)) return num;
      }
    }
    return undefined;
  };

  result.servingSize = (() => {
    const match = ocrText.match(/serving\s*size[:\s]*([^\n]+)/i);
    return match?.[1]?.trim();
  })();

  result.calories = extractNumber([
    /calories[:\s]*(\d+)/,
    /energy[:\s]*(\d+)\s*kcal/,
    /(\d+)\s*kcal/,
  ]);

  result.totalFat = extractNumber([
    /total\s*fat[:\s]*([\d.]+)\s*g/,
    /fat[:\s]*([\d.]+)\s*g/,
  ]);

  result.saturatedFat = extractNumber([
    /saturated\s*fat[:\s]*([\d.]+)\s*g/,
    /sat\.?\s*fat[:\s]*([\d.]+)\s*g/,
  ]);

  result.transFat = extractNumber([
    /trans\s*fat[:\s]*([\d.]+)\s*g/,
  ]);

  result.cholesterol = extractNumber([
    /cholesterol[:\s]*([\d.]+)\s*mg/,
  ]);

  result.sodium = extractNumber([
    /sodium[:\s]*([\d.]+)\s*mg/,
    /salt[:\s]*([\d.]+)\s*g/,
  ]);

  result.totalCarbs = extractNumber([
    /total\s*carb(?:ohydrate)?s?[:\s]*([\d.]+)\s*g/,
    /carb(?:ohydrate)?s?[:\s]*([\d.]+)\s*g/,
  ]);

  result.dietaryFiber = extractNumber([
    /dietary\s*fib(?:er|re)[:\s]*([\d.]+)\s*g/,
    /fib(?:er|re)[:\s]*([\d.]+)\s*g/,
  ]);

  result.sugars = extractNumber([
    /sugars?[:\s]*([\d.]+)\s*g/,
    /of\s*which\s*sugars?[:\s]*([\d.]+)\s*g/,
  ]);

  result.protein = extractNumber([
    /protein[:\s]*([\d.]+)\s*g/,
  ]);

  // If sodium was parsed from "salt" in grams, convert to mg
  if (result.sodium && result.sodium < 10) {
    result.sodium = Math.round(result.sodium * 400);
  }

  return result;
}

export async function terminateOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
