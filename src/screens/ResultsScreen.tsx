import { useState, useEffect } from "react";
import type { Screen } from "../App";
import type { AnalyzedProduct, NutrientRating, ChatMessage, IngredientExplanation, AlternativeProduct } from "../types";
import { PRODUCTS } from "../data/products";
import { chatAboutFood, explainIngredients, suggestAlternatives } from "../services/geminiService";
import { getUserProfile, getApiKey } from "../services/storageService";
import MealAnalysisView from "../components/MealAnalysisView";

const ratingConfig: Record<NutrientRating, { color: string; bg: string; label: string }> = {
  good: { color: "#1B7A43", bg: "#E9F7EF", label: "GOOD" },
  moderate: { color: "#F5A623", bg: "#FFF4E0", label: "MOD" },
  bad: { color: "#E4483C", bg: "#FDEAE9", label: "HIGH" },
};

const gradeColors: Record<AnalyzedProduct["grade"], string> = {
  A: "#1B7A43",
  B: "#6BAF45",
  C: "#F5A623",
  D: "#E4483C",
  F: "#B91C1C",
};

const ScoreRing = ({ score, color }: { score: number; color: string }) => {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke="#E8ECEF" strokeWidth="8"/>
      <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="8"
        strokeLinecap="round" strokeDasharray={`${dash} ${circ}`} transform="rotate(-90 55 55)"/>
      <text x="55" y="51" textAnchor="middle" fontSize="26" fontWeight="800" fill={color} fontFamily="Inter,system-ui,sans-serif">{score}</text>
      <text x="55" y="65" textAnchor="middle" fontSize="11" fill="#5A6472" fontFamily="Inter,system-ui,sans-serif">/100</text>
    </svg>
  );
};

const card = {
  background: "white", borderRadius: 18,
  border: "1px solid #E8ECEF",
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
};

const concernColors: Record<string, { color: string; bg: string }> = {
  none: { color: "#1B7A43", bg: "#E9F7EF" },
  low: { color: "#6BAF45", bg: "#EFF7E9" },
  moderate: { color: "#F5A623", bg: "#FFF4E0" },
  high: { color: "#E4483C", bg: "#FDEAE9" },
};

export default function ResultsScreen({
  product: analyzedProduct,
  navigate,
  onProductUpdate,
}: {
  product: AnalyzedProduct | null;
  navigate: (s: Screen, p?: string) => void;
  onProductUpdate?: (product: AnalyzedProduct) => void;
}) {
  const [tab, setTab] = useState<"overview" | "nutrients" | "ingredients" | "ai">("overview");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [ingredientExplanations, setIngredientExplanations] = useState<IngredientExplanation[]>([]);
  const [ingredientsLoading, setIngredientsLoading] = useState(false);
  const [alternatives, setAlternatives] = useState<AlternativeProduct[]>([]);
  const [alternativesLoading, setAlternativesLoading] = useState(false);

  // Fallback to sample product if no analyzed product
  const product: AnalyzedProduct = analyzedProduct ?? {
    ...PRODUCTS["Oatly Oat Milk"],
    id: "sample",
    analysisMode: "label" as const,
  };

  // Load ingredient explanations when switching to ingredients tab
  useEffect(() => {
    if (product.analysisMode === "label" && tab === "ingredients" && ingredientExplanations.length === 0 && !ingredientsLoading && product.ingredients && getApiKey()) {
      setIngredientsLoading(true);
      explainIngredients(product.ingredients)
        .then(setIngredientExplanations)
        .catch(() => {})
        .finally(() => setIngredientsLoading(false));
    }
  }, [tab, ingredientExplanations.length, ingredientsLoading, product.ingredients]);

  // Load alternatives when switching to AI tab
  useEffect(() => {
    if (product.analysisMode === "label" && tab === "ai" && alternatives.length === 0 && !alternativesLoading && getApiKey()) {
      setAlternativesLoading(true);
      const profile = getUserProfile();
      suggestAlternatives(product, profile)
        .then(setAlternatives)
        .catch(() => {})
        .finally(() => setAlternativesLoading(false));
    }
  }, [tab, alternatives.length, alternativesLoading, product]);

  const handleChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const query = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: query }]);
    setChatLoading(true);

    try {
      const profile = getUserProfile();
      const response = await chatAboutFood(product, chatMessages, query, profile);
      setChatMessages((prev) => [...prev, { role: "assistant", content: response }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I could not process your question. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (product.mealAnalysis) {
    return (
      <MealAnalysisView
        product={{ ...product, mealAnalysis: product.mealAnalysis }}
        onBack={() => navigate("home")}
        onProductUpdate={onProductUpdate}
      />
    );
  }

  return (
    <div style={{ paddingBottom: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px" }}>
        <button onClick={() => navigate("home")} style={{
          width: 36, height: 36, borderRadius: "50%", background: "#E8ECEF",
          border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F1720" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7"/>
          </svg>
        </button>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#0F1720", margin: 0 }}>Product Analysis</p>
          {product.analysisMode === "food" && (
            <p style={{ fontSize: 10, color: "#F5A623", margin: 0, fontWeight: 600 }}>AI Estimated Values</p>
          )}
        </div>
        <button style={{ width: 36, height: 36, borderRadius: "50%", background: "#E8ECEF", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F1720" strokeWidth="2" strokeLinecap="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
      </div>

      {/* Product Hero */}
      <div style={{ margin: "0 20px 14px", ...card, overflow: "hidden" }}>
        <div style={{ position: "relative", height: 120, background: `linear-gradient(135deg, ${product.gradeBg}, white)`, padding: "16px" }}>
          <img
            src={product.image}
            alt={product.name}
            style={{
              position: "absolute", right: 12, top: 10, width: 100, height: 100,
              objectFit: product.analysisMode === "food" ? "cover" : "contain",
              borderRadius: 12,
            }}
          />
          <div>
            <p style={{ fontSize: 11, color: "#5A6472", margin: 0 }}>{product.brand}</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#0F1720", margin: "3px 0 3px", lineHeight: 1.25, maxWidth: 200 }}>{product.name}</h2>
            <p style={{ fontSize: 11, color: "#5A6472", margin: 0 }}>{product.servingSize} · {product.kcal} kcal</p>
          </div>
        </div>
        {/* Score Row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid #E8ECEF" }}>
          <ScoreRing score={product.score} color={product.gradeColor} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: product.gradeBg, color: product.gradeColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900 }}>
                {product.grade}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#0F1720", margin: 0 }}>
                  {product.score >= 80 ? "Excellent choice" : product.score >= 60 ? "Acceptable" : product.score >= 40 ? "Use sparingly" : "Poor choice"}
                </p>
                <p style={{ fontSize: 11, color: "#5A6472", margin: 0 }}>Nutri-Score {product.grade}</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["good", "moderate", "bad"] as NutrientRating[]).map((r) => {
                const count = product.nutrients.filter((n) => n.rating === r).length;
                const cfg = ratingConfig[r];
                return (
                  <div key={r} style={{ background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 20 }}>
                    {count} {cfg.label}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Allergen Alert */}
      {product.allergens.length > 0 && (
        <div style={{ margin: "0 20px 14px", background: "#FDEAE9", borderRadius: 14, border: "1px solid rgba(228,72,60,0.2)", padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "#E4483C", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#E4483C", margin: 0 }}>Allergen Warning</p>
            <p style={{ fontSize: 11, color: "#0F1720", margin: 0, marginTop: 2 }}>Contains: {product.allergens.join(", ")}</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ margin: "0 20px 14px", display: "flex", gap: 4, background: "#E8ECEF", borderRadius: 14, padding: 4 }}>
        {(["overview", "nutrients", "ingredients", "ai"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            flex: 1, padding: "8px 0", borderRadius: 10, border: "none", cursor: "pointer",
            fontSize: 11, fontWeight: 600,
            background: tab === t ? "white" : "transparent",
            color: tab === t ? "#0F1720" : "#5A6472",
            boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
          }}>
            {t === "ai" ? "AI Chat" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{ padding: "0 20px" }}>
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Analysis engine result card */}
            {product.mlPrediction && (
              <div style={{ ...card, padding: 14, background: "linear-gradient(135deg, #F0F7FF 0%, #FFFFFF 100%)", border: "1px solid rgba(0, 102, 204, 0.25)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 16 }}>🤖</span>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 800, color: "#0052CC", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" }}>Analysis Engine</p>
                      <p style={{ fontSize: 10, color: "#5A6472", margin: 0 }}>{product.mlPrediction.modelName}</p>
                    </div>
                  </div>
                  <div style={{ background: "#E6F0FF", border: "1px solid #B3D1FF", borderRadius: 8, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#0052CC" }}>
                      {product.mlPrediction.confidence === null
                        ? product.mlPrediction.inferenceSource === "trained_model" ? "Uncalibrated model" : "Prototype baseline"
                        : `${product.mlPrediction.confidence}% confidence`}
                    </span>
                  </div>
                </div>

                {/* Score & Grade Display */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "white", padding: 10, borderRadius: 12, border: "1px solid #E8ECEF", marginBottom: 10 }}>
                  <div>
                    <p style={{ fontSize: 10, color: "#5A6472", fontWeight: 700, margin: 0, textTransform: "uppercase" }}>NutriLens Health Grade</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 20, fontWeight: 900, color: gradeColors[product.mlPrediction.predictedGrade] }}>Grade {product.mlPrediction.predictedGrade}</span>
                      <span style={{ fontSize: 11, color: "#5A6472" }}>(Health Score: {product.mlPrediction.healthScore}/100)</span>
                    </div>
                  </div>
                  {product.mlPrediction.predictedFoodName && (
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 10, color: "#5A6472", fontWeight: 700, margin: 0, textTransform: "uppercase" }}>Image Baseline Class</p>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#0F1720", margin: 0, marginTop: 2 }}>{product.mlPrediction.predictedFoodName}</p>
                    </div>
                  )}
                </div>

                {/* Risk Factors */}
                {product.mlPrediction.riskFactors && product.mlPrediction.riskFactors.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: "#5A6472", textTransform: "uppercase", margin: "2px 0" }}>Scoring factor flags:</p>
                    {product.mlPrediction.riskFactors.map((rf, idx) => (
                      <div key={idx} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8,
                        background: rf.severity === "good" ? "#E9F7EF" : rf.severity === "high" ? "#FDEAE9" : "#FFF4E0",
                        border: `1px solid ${rf.severity === "good" ? "#1B7A4333" : rf.severity === "high" ? "#E4483C33" : "#F5A62333"}`
                      }}>
                        <span style={{ fontSize: 11 }}>{rf.severity === "good" ? "✅" : rf.severity === "high" ? "⚠️" : "⚡"}</span>
                        <p style={{ fontSize: 11, color: "#0F1720", margin: 0, flex: 1 }}>{rf.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {product.nutrients.map((n) => {
              const cfg = ratingConfig[n.rating];
              return (
                <div key={n.name} style={{ display: "flex", alignItems: "center", gap: 12, ...card, padding: "12px 14px" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: cfg.bg, color: cfg.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                    {n.rating === "good" ? "✓" : n.rating === "moderate" ? "!" : "✕"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#0F1720", margin: 0 }}>{n.name}</p>
                    <p style={{ fontSize: 11, color: "#5A6472", margin: 0 }}>{n.detail}</p>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 700, color: cfg.color, margin: 0, flexShrink: 0 }}>{n.value}</p>
                </div>
              );
            })}
          </div>
        )}

        {tab === "nutrients" && (
          <div style={{ ...card, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "10px 16px", borderBottom: "1px solid #E8ECEF", background: "#F7F9FA" }}>
              {["Nutrient", "Per serving", "Rating"].map((h, i) => (
                <p key={h} style={{ fontSize: 10, fontWeight: 700, color: "#5A6472", textTransform: "uppercase", letterSpacing: "0.06em", margin: 0, textAlign: i === 1 ? "center" : i === 2 ? "right" : "left" }}>{h}</p>
              ))}
            </div>
            {product.nutrients.map((n, i) => {
              const cfg = ratingConfig[n.rating];
              return (
                <div key={n.name} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", alignItems: "center", padding: "11px 16px", borderBottom: i < product.nutrients.length - 1 ? "1px solid #E8ECEF" : "none" }}>
                  <p style={{ fontSize: 13, color: "#0F1720", margin: 0 }}>{n.name}</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#0F1720", margin: 0, textAlign: "center" }}>{n.value}</p>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 20, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "ingredients" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ ...card, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#5A6472", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" }}>Ingredients list</p>
              <p style={{ fontSize: 13, color: "#0F1720", lineHeight: 1.6, margin: 0 }}>{product.ingredients}</p>
            </div>

            {/* AI Ingredient Explanations */}
            {ingredientsLoading && (
              <div style={{ ...card, padding: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, border: "2px solid #1B7A43", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <p style={{ fontSize: 12, color: "#5A6472", margin: 0 }}>Analyzing ingredients with AI...</p>
              </div>
            )}
            {ingredientExplanations.length > 0 && (
              <div style={{ ...card, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#1B7A43", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>🧪 AI Ingredient Analysis</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {ingredientExplanations.map((ie, idx) => {
                    const cc = concernColors[ie.concern] || concernColors.none;
                    return (
                      <div key={idx} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: cc.color, marginTop: 6, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "#0F1720", margin: 0 }}>{ie.name}</p>
                          <p style={{ fontSize: 11, color: "#5A6472", margin: "2px 0 0", lineHeight: 1.5 }}>
                            {ie.purpose} {ie.healthNote}
                          </p>
                        </div>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: cc.bg, color: cc.color, flexShrink: 0, textTransform: "uppercase" }}>
                          {ie.concern}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {product.allergens.length > 0 && (
              <div style={{ background: "#FDEAE9", borderRadius: 18, border: "1px solid rgba(228,72,60,0.2)", padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#E4483C", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>Allergens present</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {product.allergens.map((a) => (
                    <span key={a} style={{ background: "white", color: "#E4483C", fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 20, border: "1px solid rgba(228,72,60,0.3)" }}>{a}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "ai" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* AI Summary */}
            <div style={{ background: "#E9F7EF", borderRadius: 18, border: "1px solid rgba(27,122,67,0.2)", padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#1B7A43", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                </div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#1B7A43", textTransform: "uppercase", letterSpacing: "0.08em", margin: 0 }}>NutriLens AI</p>
              </div>
              <p style={{ fontSize: 13, color: "#0F1720", lineHeight: 1.65, margin: 0 }}>
                {product.aiSummary || "AI summary not available. Add your Gemini API key in Profile → Settings to enable AI analysis."}
              </p>
            </div>

            {/* Goals comparison */}
            <div style={{ ...card, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#5A6472", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 14px" }}>Compared to your goals</p>
              {[
                { label: "Daily calories", used: product.kcal, total: 2000, color: "#1B7A43" },
                { label: "Sodium limit", used: product.nutrients.find(n => n.name === "Sodium")?.per100g ?? 0, total: 2300, color: "#F5A623" },
                { label: "Protein goal", used: parseFloat(product.nutrients.find(n => n.name === "Protein")?.value ?? "0"), total: 55, color: "#1B7A43" },
              ].map((g) => {
                const pct = Math.min((g.used / g.total) * 100, 100);
                return (
                  <div key={g.label} style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 12, color: "#5A6472" }}>{g.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: g.color }}>{Math.round(pct)}%</span>
                    </div>
                    <div style={{ height: 6, background: "#E8ECEF", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: g.color, borderRadius: 4 }}/>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Alternatives */}
            {alternativesLoading && (
              <div style={{ ...card, padding: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, border: "2px solid #1B7A43", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                <p style={{ fontSize: 12, color: "#5A6472", margin: 0 }}>Finding healthier alternatives...</p>
              </div>
            )}
            {alternatives.length > 0 && (
              <div style={{ ...card, padding: 16 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#1B7A43", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>🔄 Healthier Alternatives</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {alternatives.map((alt, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#F7F9FA", borderRadius: 14 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: alt.estimatedScore >= 80 ? "#E9F7EF" : alt.estimatedScore >= 60 ? "#FFF4E0" : "#FDEAE9",
                        color: alt.estimatedScore >= 80 ? "#1B7A43" : alt.estimatedScore >= 60 ? "#F5A623" : "#E4483C",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 800, flexShrink: 0,
                      }}>
                        {alt.estimatedScore}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#0F1720", margin: 0 }}>{alt.name}</p>
                        <p style={{ fontSize: 11, color: "#5A6472", margin: "2px 0 0" }}>{alt.brand} · {alt.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Chat */}
            <div style={{ ...card, padding: 16 }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#5A6472", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px" }}>💬 Ask about this food</p>

              {chatMessages.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12, maxHeight: 200, overflowY: "auto" }}>
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} style={{
                      padding: "8px 12px",
                      borderRadius: 14,
                      fontSize: 12,
                      lineHeight: 1.5,
                      background: msg.role === "user" ? "#1B7A43" : "#F7F9FA",
                      color: msg.role === "user" ? "white" : "#0F1720",
                      alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                      maxWidth: "85%",
                    }}>
                      {msg.content}
                    </div>
                  ))}
                  {chatLoading && (
                    <div style={{ padding: "8px 12px", borderRadius: 14, background: "#F7F9FA", alignSelf: "flex-start" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#5A6472", animation: "pulse 1s infinite" }} />
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#5A6472", animation: "pulse 1s infinite 0.2s" }} />
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#5A6472", animation: "pulse 1s infinite 0.4s" }} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleChat()}
                  placeholder="Is this good for weight loss?"
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 14,
                    border: "1px solid #E8ECEF", fontSize: 12, color: "#0F1720",
                    outline: "none", background: "#F7F9FA",
                  }}
                />
                <button
                  onClick={handleChat}
                  disabled={!chatInput.trim() || chatLoading}
                  style={{
                    width: 40, height: 40, borderRadius: 12,
                    background: chatInput.trim() ? "#1B7A43" : "#E8ECEF",
                    border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: chatInput.trim() && !chatLoading ? 1 : 0.5,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>

              {chatMessages.length === 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {[
                    "Is this good for weight loss?",
                    "Any hidden sugars?",
                    "Good for kids?",
                    "Better alternatives?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => { setChatInput(q); }}
                      style={{
                        padding: "5px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600,
                        background: "#F7F9FA", color: "#5A6472", border: "1px solid #E8ECEF", cursor: "pointer",
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
