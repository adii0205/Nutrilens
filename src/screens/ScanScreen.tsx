import { useState, useRef, useEffect, useCallback } from "react";
import type { Screen } from "../App";
import type {
  AnalyzedProduct,
  AnalysisMode,
  IndianDishOption,
  IndianMealAnalysis,
  MealItemInput,
} from "../types";
import MealConfirmationPanel from "../components/MealConfirmationPanel";
import { startCamera, captureFrame, stopCamera, pickFromGallery } from "../services/cameraService";
import { extractTextFromImage, parseNutritionLabel } from "../services/ocrService";
import {
  analyzePackagedFoodImage,
  generateAISummary,
  suggestIndianMealItems,
} from "../services/geminiService";
import {
  analyzeIndianMeal,
  getIndianDishCatalogue,
  mealAnalysisToProduct,
  recalculateIndianMeal,
} from "../services/mealService";
import { analyzeWithMLModel } from "../services/mlService";

import { buildNutrients, getGradeColors } from "../services/nutritionScoringService";
import { saveScannedProduct, getApiKey, getUserProfile } from "../services/storageService";

type ScanPhase = "idle" | "capturing" | "ocr" | "analyzing" | "ml" | "generating" | "confirming" | "done" | "error";

export default function ScanScreen({
  navigate,
  navigateWithProduct,
}: {
  navigate: (s: Screen, p?: string) => void;
  navigateWithProduct: (s: Screen, p: AnalyzedProduct) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<AnalysisMode>("label");
  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [pendingMeal, setPendingMeal] = useState<IndianMealAnalysis | null>(null);
  const [dishCatalogue, setDishCatalogue] = useState<IndianDishOption[]>([]);
  const [mealSuggestedItems, setMealSuggestedItems] = useState<MealItemInput[]>([]);
  const [mealConfirmationError, setMealConfirmationError] = useState("");
  const [mealConfirmationLoading, setMealConfirmationLoading] = useState(false);

  const initCamera = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      streamRef.current = await startCamera(videoRef.current);
      setCameraActive(true);
    } catch {
      setCameraActive(false);
    }
  }, []);

  useEffect(() => {
    if (phase === "idle" && !capturedImage && !streamRef.current) {
      void initCamera();
    }
  }, [phase, capturedImage, initCamera]);

  useEffect(() => {
    return () => {
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  const finishAnalysis = (product: AnalyzedProduct) => {
    saveScannedProduct(product);
    setPhase("done");
    setStatusMsg("Analysis complete!");

    window.setTimeout(() => {
      navigateWithProduct("results", product);
    }, 600);
  };

  const requestMealConfirmation = async (
    analysis: IndianMealAnalysis,
    imageDataUrl: string,
  ) => {
    setPendingMeal(analysis);
    setStatusMsg("Loading supported Indian dishes...");
    const dishes = await getIndianDishCatalogue();
    if (dishes.length === 0) {
      throw new Error("The backend dish catalogue is empty. Add supported dishes before scanning a meal.");
    }
    setDishCatalogue(dishes);

    let suggestions: MealItemInput[] = [];
    if (getApiKey()) {
      setStatusMsg("Identifying likely dishes for you to confirm...");
      try {
        suggestions = await suggestIndianMealItems(imageDataUrl, dishes);
      } catch {
        suggestions = [];
      }
    }
    setMealSuggestedItems(suggestions);
    setPhase("confirming");
    setStatusMsg("Confirm the dishes and portions visible in the photo.");
  };

  const processImage = async (imageDataUrl: string) => {
    setCapturedImage(imageDataUrl);
    const apiKey = getApiKey();
    const profile = getUserProfile();

    try {
      if (mode === "food") {
        setPhase("analyzing");
        setStatusMsg("Checking the meal with the Indian dish pipeline...");
        const mealAnalysis = await analyzeIndianMeal(imageDataUrl);

        if (
          mealAnalysis.requiresUserConfirmation ||
          mealAnalysis.requiresPortionConfirmation ||
          mealAnalysis.items.length === 0
        ) {
          await requestMealConfirmation(mealAnalysis, imageDataUrl);
          return;
        }

        finishAnalysis(mealAnalysisToProduct(imageDataUrl, mealAnalysis));
        return;
      }

      let product: AnalyzedProduct;

      if (apiKey) {
        setPhase("ocr");
        setStatusMsg("Extracting text from label...");
        let ocrText = "";
        try {
          const ocr = await extractTextFromImage(imageDataUrl, setStatusMsg);
          ocrText = ocr.text;
        } catch {
          ocrText = "";
        }

        setPhase("analyzing");
        setStatusMsg("AI analyzing nutritional data...");
        product = await analyzePackagedFoodImage(imageDataUrl, ocrText, setStatusMsg);

        setPhase("ml");
        setStatusMsg("Running the Python image baseline and health scoring pipeline...");
        try {
          const mlResult = await analyzeWithMLModel(imageDataUrl, product.nutrients, setStatusMsg);
          product.mlPrediction = mlResult;
        } catch (mlErr) {
          console.warn("ML model inference non-fatal issue:", mlErr);
        }

        setPhase("generating");
        setStatusMsg("Generating health assessment...");
        product.aiSummary = await generateAISummary(product, profile);
      } else {
        // Direct Python baseline & OCR pipeline (no Gemini key required).
        setPhase("ml");
        setStatusMsg("Extracting label data and running the Python analysis backend...");

        let ocrText = "";
        try {
          const ocr = await extractTextFromImage(imageDataUrl, setStatusMsg);
          ocrText = ocr.text;
        } catch {
          ocrText = "";
        }

        if (
          mode === "label" &&
          !/(nutrition|calories|energy|sodium|protein|sugar|fat)/i.test(ocrText)
        ) {
          throw new Error(
            "No nutrition table was detected. For a photo of a prepared meal, select Indian meal instead of Package.",
          );
        }

        const parsedLabel = mode === "label" && ocrText
          ? parseNutritionLabel(ocrText)
          : undefined;
        if (mode === "label" && parsedLabel) {
          const requiredValues = [
            ["calories", parsedLabel.calories],
            ["saturated fat", parsedLabel.saturatedFat],
            ["sugars", parsedLabel.sugars],
            ["sodium", parsedLabel.sodium],
            ["fibre", parsedLabel.dietaryFiber],
            ["protein", parsedLabel.protein],
          ] as const;
          const missingValues = requiredValues
            .filter(([, value]) => value === undefined)
            .map(([name]) => name);
          if (missingValues.length > 0) {
            throw new Error(
              `OCR could not read: ${missingValues.join(", ")}. Move closer, keep the table straight, and avoid glare.`,
            );
          }
        }
        const parsedNutrients = parsedLabel
          ? buildNutrients({
              calories: parsedLabel.calories,
              saturatedFat: parsedLabel.saturatedFat,
              sugars: parsedLabel.sugars,
              sodium: parsedLabel.sodium,
              fiber: parsedLabel.dietaryFiber,
              protein: parsedLabel.protein,
            })
          : undefined;

        const mlResult = await analyzeWithMLModel(imageDataUrl, parsedNutrients, setStatusMsg);
        if (mode === "label" && mlResult.nutrientSource !== "provided_label_values") {
          throw new Error(
            "The backend did not receive the parsed label values. Please try the scan again.",
          );
        }

        const nutrientsUsed = mlResult.nutrientsUsed ?? mlResult.estimatedNutrients;
        if (!nutrientsUsed) {
          throw new Error("The analysis backend did not return the nutrients used for scoring.");
        }

        const nutrients = buildNutrients(nutrientsUsed);
        const score = mlResult.healthScore;
        const grade = mlResult.predictedGrade;
        const { gradeColor, gradeBg } = getGradeColors(grade);

        product = {
          id: `product_${Date.now()}`,
          name: mlResult.predictedFoodName || "Scanned Food Item",
          brand: mlResult.category || "Prototype image baseline",
          score,
          grade,
          gradeColor,
          gradeBg,
          kcal: nutrientsUsed.calories,
          servingSize: mode === "label" ? "Per 100g (from label OCR)" : "Estimated profile per 100g",
          allergens: mlResult.allergens ?? [],
          nutrients,
          aiSummary: mlResult.healthNote || "Prototype result from an image heuristic and transparent nutrient scoring baseline.",
          image: imageDataUrl,
          ingredients: ocrText || "No ingredient text was extracted.",
          analysisMode: mode,
          mlPrediction: mlResult,
        };
      }

      finishAnalysis(product);
    } catch (err: unknown) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Analysis failed. Please try again.");
    }
  };

  const handleMealConfirmation = async (items: MealItemInput[]) => {
    if (!capturedImage) return;
    setMealConfirmationLoading(true);
    setMealConfirmationError("");
    try {
      const analysis = await recalculateIndianMeal(items);
      setPendingMeal(analysis);
      finishAnalysis(mealAnalysisToProduct(capturedImage, analysis));
    } catch (err: unknown) {
      setMealConfirmationError(
        err instanceof Error ? err.message : "The meal could not be recalculated.",
      );
    } finally {
      setMealConfirmationLoading(false);
    }
  };

  const handleCapture = async () => {
    if (!videoRef.current || phase !== "idle") return;
    setPhase("capturing");
    setStatusMsg("Capturing image...");

    const imageDataUrl = captureFrame(videoRef.current);
    stopCamera(streamRef.current);
    streamRef.current = null;
    setCameraActive(false);

    await processImage(imageDataUrl);
  };

  const handleGallery = async () => {
    if (phase !== "idle") return;
    try {
      const imageDataUrl = await pickFromGallery();
      stopCamera(streamRef.current);
      streamRef.current = null;
      setCameraActive(false);
      await processImage(imageDataUrl);
    } catch {
      // User cancelled gallery picker
    }
  };

  const resetScanner = (nextMode: AnalysisMode = mode) => {
    stopCamera(streamRef.current);
    streamRef.current = null;
    setCameraActive(false);
    setMode(nextMode);
    setCapturedImage(null);
    setPendingMeal(null);
    setDishCatalogue([]);
    setMealSuggestedItems([]);
    setMealConfirmationError("");
    setMealConfirmationLoading(false);
    setPhase("idle");
    setStatusMsg("");
    setErrorMsg("");
  };

  const handleRetry = () => {
    resetScanner();
  };

  const handleModeChange = (nextMode: AnalysisMode) => {
    if (nextMode === mode || (phase !== "idle" && phase !== "error")) return;
    resetScanner(nextMode);
  };

  const phaseColors: Record<ScanPhase, string> = {
    idle: "white",
    capturing: "#F5A623",
    ocr: "#F5A623",
    analyzing: "#F5A623",
    ml: "#0052CC",
    generating: "#1B7A43",
    confirming: "#F5A623",
    done: "#1B7A43",
    error: "#E4483C",
  };

  const borderColor = phaseColors[phase];

  return (
    <div className="relative h-full bg-[#0F1720] flex flex-col">
      {/* Camera Viewfinder / Captured Image */}
      <div className="relative flex-1 overflow-hidden">
        {capturedImage ? (
          <img
            src={capturedImage}
            alt="Captured food"
            className="w-full h-full object-cover"
            style={{ opacity: phase === "done" ? 0.8 : 0.6 }}
          />
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ opacity: cameraActive ? 0.7 : 0, transform: "scaleX(-1)" }}
            />
            {!cameraActive && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center px-8">
                  <p className="text-white/60 text-sm mb-3">Camera initializing...</p>
                  <p className="text-white/40 text-xs">Or use the gallery button below</p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Top overlay */}
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 py-4">
          <button
            onClick={() => {
              stopCamera(streamRef.current);
              navigate("home");
            }}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M19 12H5M12 5l-7 7 7 7"/>
            </svg>
          </button>

          {/* Mode Toggle */}
          <div className="bg-black/40 backdrop-blur-sm rounded-full p-1 flex gap-1">
            {(["label", "food"] as AnalysisMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => handleModeChange(m)}
                disabled={phase !== "idle" && phase !== "error"}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: mode === m ? "rgba(27,122,67,0.9)" : "transparent",
                  color: mode === m ? "white" : "rgba(255,255,255,0.6)",
                  cursor: phase === "idle" || phase === "error" ? "pointer" : "not-allowed",
                  opacity: phase === "idle" || phase === "error" ? 1 : 0.55,
                }}
              >
                {m === "label" ? "📦 Package" : "🍛 Indian meal"}
              </button>
            ))}
          </div>

          <button className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.071 4.929A10 10 0 104.93 19.07"/>
              <path d="M20.488 9A9.95 9.95 0 0121 12"/>
            </svg>
          </button>
        </div>

        {/* Scan Frame */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-64 h-44">
            {/* Corner brackets */}
            {[
              "top-0 left-0 border-t-2 border-l-2",
              "top-0 right-0 border-t-2 border-r-2",
              "bottom-0 left-0 border-b-2 border-l-2",
              "bottom-0 right-0 border-b-2 border-r-2",
            ].map((cls, i) => (
              <div
                key={i}
                className={`absolute w-6 h-6 ${cls} transition-colors duration-300`}
                style={{ borderColor }}
              />
            ))}

            {/* Scan line animation */}
            {(phase === "ocr" || phase === "analyzing") && (
              <div
                className="absolute left-2 right-2 h-0.5 bg-[#F5A623]/80"
                style={{ animation: "scanLine 1.2s ease-in-out infinite", top: "50%" }}
              />
            )}

            {/* Done checkmark */}
            {phase === "done" && (
              <div className="absolute inset-0 bg-[#1B7A43]/20 rounded-lg flex items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-[#1B7A43] flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
              </div>
            )}
          </div>
        </div>

        {phase === "confirming" && pendingMeal ? (
          <div className="absolute inset-x-3 bottom-3 top-20 flex min-h-0 flex-col gap-2">
            {capturedImage ? (
              <figure className="relative m-0 h-36 shrink-0 overflow-hidden rounded-[18px] border border-white/20 bg-black/70 shadow-2xl">
                <img
                  src={capturedImage}
                  alt="Full scanned thali for dish selection"
                  className="h-full w-full object-contain"
                />
                <figcaption className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-2 pt-8 text-white">
                  <span className="text-xs font-extrabold">Your scanned thali</span>
                  <span className="rounded-full bg-black/45 px-2 py-1 text-[9px] font-semibold text-white/80 backdrop-blur-sm">
                    Use this photo as your guide
                  </span>
                </figcaption>
              </figure>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto">
              <MealConfirmationPanel
                dishes={dishCatalogue}
                items={pendingMeal.items}
                suggestedItems={mealSuggestedItems}
                loading={mealConfirmationLoading}
                error={mealConfirmationError}
                onCancel={handleRetry}
                onSubmit={handleMealConfirmation}
              />
            </div>
          </div>
        ) : null}

        {/* Status bubble */}
        {phase !== "confirming" ? (
        <div className="absolute bottom-6 left-0 right-0 flex justify-center">
          <div className="bg-black/50 backdrop-blur-md rounded-2xl px-5 py-3 mx-5 text-center max-w-[300px]">
            {phase === "idle" && (
              <p className="text-white text-sm font-medium">
                {mode === "label"
                  ? "Point camera at a packaged-food label"
                  : "Fit the full Indian meal inside the frame"}
              </p>
            )}
            {(phase === "capturing" || phase === "ocr" || phase === "analyzing" || phase === "ml" || phase === "generating") && (
              <div className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-[#F5A623] border-t-transparent rounded-full animate-spin" />
                <p className="text-[#F5A623] text-sm font-semibold">{statusMsg}</p>
              </div>
            )}
            {phase === "done" && (
              <p className="text-[#1B7A43] text-sm font-semibold">✓ {statusMsg}</p>
            )}
            {phase === "error" && (
              <div>
                <p className="text-[#E4483C] text-sm font-semibold mb-2">{errorMsg}</p>
                <button
                  onClick={handleRetry}
                  className="text-white text-xs font-semibold bg-white/20 rounded-full px-4 py-1.5"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        </div>
        ) : null}
      </div>

      {/* Bottom Controls */}
      <div className="bg-[#0F1720] px-6 pt-5 pb-8">
        <div className="flex items-center justify-between mb-5">
          {/* Gallery button */}
          <button
            onClick={handleGallery}
            disabled={phase !== "idle"}
            className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center disabled:opacity-40"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18M9 21V9"/>
            </svg>
          </button>

          {/* Capture button */}
          <button
            onClick={handleCapture}
            disabled={phase !== "idle" || !cameraActive}
            className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40"
          >
            <div
              className={`w-14 h-14 rounded-full transition-all duration-300 ${
                phase === "done"
                  ? "bg-[#1B7A43] scale-90"
                  : phase !== "idle"
                    ? "bg-[#F5A623] animate-pulse"
                    : "bg-white"
              }`}
            />
          </button>

          {/* Flash toggle (decorative) */}
          <button className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
              <circle cx="12" cy="12" r="5"/>
            </svg>
          </button>
        </div>

        <button
          onClick={handleGallery}
          disabled={phase !== "idle"}
          className="w-full disabled:opacity-40"
          style={{ background: "none", border: "none", cursor: phase === "idle" ? "pointer" : "default", padding: 0 }}
        >
          <div className="flex items-center justify-center gap-2">
            <div className="h-px flex-1 bg-white/10"/>
            <p className="text-white/40 text-xs">or choose from gallery</p>
            <div className="h-px flex-1 bg-white/10"/>
          </div>
        </button>
      </div>

      <style>{`
        @keyframes scanLine {
          0%, 100% { transform: translateY(-60px); opacity: 0.6; }
          50% { transform: translateY(60px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
