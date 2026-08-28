import { useState, useRef, useEffect, useCallback } from "react";
import type { Screen } from "../App";
import type { AnalyzedProduct, AnalysisMode } from "../types";
import { startCamera, captureFrame, stopCamera, pickFromGallery } from "../services/cameraService";
import { extractTextFromImage } from "../services/ocrService";
import { analyzePackagedFoodImage, analyzePreparedFoodImage, generateAISummary } from "../services/geminiService";
import { saveScannedProduct, getApiKey, getUserProfile } from "../services/storageService";

type ScanPhase = "idle" | "capturing" | "ocr" | "analyzing" | "generating" | "done" | "error";

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
    initCamera();
    return () => {
      stopCamera(streamRef.current);
      streamRef.current = null;
    };
  }, [initCamera]);

  const processImage = async (imageDataUrl: string) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      setPhase("error");
      setErrorMsg("Please add your Gemini API key in Profile → Settings first.");
      return;
    }

    setCapturedImage(imageDataUrl);
    const profile = getUserProfile();

    try {
      let product: AnalyzedProduct;

      if (mode === "label") {
        // Step 1: OCR
        setPhase("ocr");
        setStatusMsg("Extracting text from label...");
        let ocrText = "";
        try {
          const ocr = await extractTextFromImage(imageDataUrl, setStatusMsg);
          ocrText = ocr.text;
        } catch {
          // OCR failure is non-fatal; Gemini Vision can still analyze the image
          ocrText = "";
        }

        // Step 2: Gemini label analysis
        setPhase("analyzing");
        setStatusMsg("AI analyzing nutritional data...");
        product = await analyzePackagedFoodImage(imageDataUrl, ocrText, setStatusMsg);
      } else {
        // Food mode: direct Gemini Vision
        setPhase("analyzing");
        setStatusMsg("Identifying food items...");
        product = await analyzePreparedFoodImage(imageDataUrl, setStatusMsg);
      }

      // Step 3: Generate AI summary
      setPhase("generating");
      setStatusMsg("Generating health assessment...");
      product.aiSummary = await generateAISummary(product, profile);

      // Step 4: Save to history
      saveScannedProduct(product);

      setPhase("done");
      setStatusMsg("Analysis complete!");

      setTimeout(() => {
        navigateWithProduct("results", product);
      }, 600);
    } catch (err: unknown) {
      setPhase("error");
      setErrorMsg(err instanceof Error ? err.message : "Analysis failed. Please try again.");
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

  const handleRetry = () => {
    setCapturedImage(null);
    setPhase("idle");
    setStatusMsg("");
    setErrorMsg("");
    initCamera();
  };

  const phaseColors: Record<ScanPhase, string> = {
    idle: "white",
    capturing: "#F5A623",
    ocr: "#F5A623",
    analyzing: "#F5A623",
    generating: "#1B7A43",
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
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 py-4">
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
                onClick={() => phase === "idle" && setMode(m)}
                className="px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: mode === m ? "rgba(27,122,67,0.9)" : "transparent",
                  color: mode === m ? "white" : "rgba(255,255,255,0.6)",
                }}
              >
                {m === "label" ? "📋 Label" : "🍽️ Food"}
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

        {/* Status bubble */}
        <div className="absolute bottom-6 left-0 right-0 flex justify-center">
          <div className="bg-black/50 backdrop-blur-md rounded-2xl px-5 py-3 mx-5 text-center max-w-[300px]">
            {phase === "idle" && (
              <p className="text-white text-sm font-medium">
                {mode === "label"
                  ? "Point camera at a product label or barcode"
                  : "Point camera at your food or meal"}
              </p>
            )}
            {(phase === "capturing" || phase === "ocr" || phase === "analyzing" || phase === "generating") && (
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
