import { useEffect, useState } from "react";
import type {
  AnalyzedProduct,
  IndianDishOption,
  IndianMealAnalysis,
  MealItemInput,
  MealNutrients,
  MealProvenance,
} from "../types";
import {
  getIndianDishCatalogue,
  mealAnalysisToProduct,
  recalculateIndianMeal,
} from "../services/mealService";
import { updateScannedProduct } from "../services/storageService";
import MealConfirmationPanel from "./MealConfirmationPanel";

const cardStyle = {
  background: "white",
  borderRadius: 18,
  border: "1px solid #E8ECEF",
  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
};

function rounded(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString();
}

function nutrientUnit(key: keyof MealNutrients): string {
  if (key === "calories") return "kcal";
  if (key === "sodium") return "mg";
  return "g";
}

function sourceText(source: MealProvenance): string {
  const labels = source.references.map((reference) => reference.name).filter(Boolean);
  return Array.from(new Set(labels)).join(" · ") || `Catalogue ${source.catalogVersion}`;
}

function NutrientRange({
  label,
  nutrientKey,
  analysis,
}: {
  label: string;
  nutrientKey: keyof MealNutrients;
  analysis: IndianMealAnalysis;
}) {
  const unit = nutrientUnit(nutrientKey);
  return (
    <div style={{ ...cardStyle, padding: 12, minWidth: 0 }}>
      <p style={{ margin: 0, color: "#5A6472", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>
        {label}
      </p>
      <p style={{ margin: "3px 0 0", color: "#0F1720", fontSize: 17, fontWeight: 800 }}>
        {rounded(analysis.totals.estimated[nutrientKey])} {unit}
      </p>
      <p style={{ margin: "2px 0 0", color: "#7B8490", fontSize: 9 }}>
        {rounded(analysis.totals.minimum[nutrientKey])}–{rounded(analysis.totals.maximum[nutrientKey])} {unit}
      </p>
    </div>
  );
}

export default function MealAnalysisView({
  product,
  onBack,
  onProductUpdate,
}: {
  product: AnalyzedProduct & { mealAnalysis: IndianMealAnalysis };
  onBack: () => void;
  onProductUpdate?: (product: AnalyzedProduct) => void;
}) {
  const [analysis, setAnalysis] = useState(product.mealAnalysis);
  const [editing, setEditing] = useState(false);
  const [dishes, setDishes] = useState<IndianDishOption[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setAnalysis(product.mealAnalysis);
    setEditing(false);
    setError("");
  }, [product.id, product.mealAnalysis]);

  const openEditor = async () => {
    setError("");
    if (dishes.length > 0) {
      setEditing(true);
      return;
    }
    setCatalogueLoading(true);
    try {
      const catalogue = await getIndianDishCatalogue();
      setDishes(catalogue);
      setEditing(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The dish catalogue could not be loaded.");
    } finally {
      setCatalogueLoading(false);
    }
  };

  const saveCorrections = async (items: MealItemInput[]) => {
    setRecalculating(true);
    setError("");
    try {
      const updated = await recalculateIndianMeal(items);
      const correctedProduct = {
        ...mealAnalysisToProduct(product.image, updated),
        id: product.id,
      };
      setAnalysis(updated);
      updateScannedProduct(correctedProduct);
      onProductUpdate?.(correctedProduct);
      setEditing(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "The meal could not be recalculated.");
    } finally {
      setRecalculating(false);
    }
  };

  const totalGrams = analysis.items.reduce(
    (sum, item) => sum + item.portion.selectedGrams,
    0,
  );
  const itemNames = analysis.items.map((item) => item.name).join(" + ");
  const allergens = Array.from(new Set(analysis.items.flatMap((item) => item.allergens)));

  return (
    <div style={{ paddingBottom: 24 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 20px" }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to home"
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "#E8ECEF",
            border: "none",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F1720" strokeWidth="2.5" strokeLinecap="round">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div style={{ textAlign: "center" }}>
          <p style={{ margin: 0, color: "#0F1720", fontSize: 14, fontWeight: 700 }}>Indian Meal Estimate</p>
          <p style={{ margin: 0, color: "#B46A00", fontSize: 10, fontWeight: 600 }}>Portion-based nutrition</p>
        </div>
        <div style={{ width: 36 }} aria-hidden="true" />
      </header>

      <div style={{ margin: "0 20px 14px", ...cardStyle, overflow: "hidden" }}>
        <div style={{ position: "relative", height: 150, background: "#16212C" }}>
          <img
            src={product.image}
            alt="Scanned Indian meal"
            style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.72 }}
          />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(transparent 25%, rgba(15,23,32,0.9))" }} />
          <div style={{ position: "absolute", left: 14, right: 14, bottom: 12 }}>
            <p style={{ margin: 0, color: "white", fontSize: 16, fontWeight: 800, lineHeight: 1.25 }}>
              {itemNames || "Meal awaiting confirmation"}
            </p>
            <p style={{ margin: "3px 0 0", color: "rgba(255,255,255,0.72)", fontSize: 10 }}>
              {analysis.items.length} {analysis.items.length === 1 ? "dish" : "dishes"} · {rounded(totalGrams)} g confirmed
            </p>
          </div>
        </div>
        <div style={{ padding: 14, display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 10, background: "#FFF4E0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            🍛
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, color: "#0F1720", fontSize: 12, fontWeight: 800 }}>
              {analysis.recognition.modelLoaded ? analysis.recognition.modelName : "User-confirmed dish profile"}
            </p>
            <p style={{ margin: "2px 0 0", color: "#5A6472", fontSize: 10, lineHeight: 1.45 }}>
              {analysis.recognition.message}
            </p>
          </div>
        </div>
      </div>

      <section aria-labelledby="meal-total-heading" style={{ margin: "0 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 id="meal-total-heading" style={{ margin: 0, color: "#0F1720", fontSize: 13, fontWeight: 800 }}>
            Estimated meal total
          </h2>
          <span style={{ color: "#5A6472", fontSize: 9 }}>Range shown below each value</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          <NutrientRange label="Calories" nutrientKey="calories" analysis={analysis} />
          <NutrientRange label="Protein" nutrientKey="protein" analysis={analysis} />
          <NutrientRange label="Total fat" nutrientKey="fat" analysis={analysis} />
          <NutrientRange label="Carbohydrates" nutrientKey="carbohydrates" analysis={analysis} />
          <NutrientRange label="Fibre" nutrientKey="fiber" analysis={analysis} />
          <NutrientRange label="Sugars" nutrientKey="sugars" analysis={analysis} />
          <NutrientRange label="Saturated fat" nutrientKey="saturatedFat" analysis={analysis} />
          <NutrientRange label="Sodium" nutrientKey="sodium" analysis={analysis} />
        </div>
      </section>

      <section aria-labelledby="meal-items-heading" style={{ margin: "0 20px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <h2 id="meal-items-heading" style={{ margin: 0, color: "#0F1720", fontSize: 13, fontWeight: 800 }}>
            Dish breakdown
          </h2>
          <button
            type="button"
            onClick={openEditor}
            disabled={catalogueLoading}
            style={{
              border: "1px solid #C9E7D5",
              borderRadius: 10,
              background: "#E9F7EF",
              color: "#1B7A43",
              padding: "6px 9px",
              fontSize: 10,
              fontWeight: 800,
              cursor: "pointer",
              opacity: catalogueLoading ? 0.6 : 1,
            }}
          >
            {catalogueLoading ? "Loading…" : "Correct dishes / portions"}
          </button>
        </div>

        {error && !editing ? (
          <p role="alert" style={{ background: "#FDEAE9", color: "#B91C1C", padding: 10, borderRadius: 12, fontSize: 11 }}>
            {error}
          </p>
        ) : null}

        {editing ? (
          <MealConfirmationPanel
            dishes={dishes}
            items={analysis.items}
            title="Correct dishes or portions"
            submitLabel="Update nutrition"
            loading={recalculating}
            error={error}
            onCancel={() => {
              setEditing(false);
              setError("");
            }}
            onSubmit={saveCorrections}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis.items.map((item) => {
              const values = item.nutrients.estimated;
              return (
                <article key={item.itemId} style={{ ...cardStyle, padding: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <p style={{ margin: 0, color: "#0F1720", fontSize: 13, fontWeight: 800 }}>{item.name}</p>
                      <p style={{ margin: "2px 0 0", color: "#5A6472", fontSize: 10 }}>{item.category}</p>
                    </div>
                    <span style={{ background: "#E9F7EF", color: "#1B7A43", borderRadius: 999, padding: "4px 7px", fontSize: 9, fontWeight: 800, whiteSpace: "nowrap" }}>
                      {item.confidence == null ? "User confirmed" : `${rounded(item.confidence)}% confidence`}
                    </span>
                  </div>

                  <div style={{ marginTop: 10, borderRadius: 12, background: "#F7F9FA", padding: "9px 10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ color: "#5A6472", fontSize: 10 }}>Selected portion</span>
                      <strong style={{ color: "#0F1720", fontSize: 11 }}>{rounded(item.portion.selectedGrams)} g</strong>
                    </div>
                    <p style={{ margin: "2px 0 0", color: "#7B8490", fontSize: 9 }}>
                      Likely range {rounded(item.portion.minimumGrams)}–{rounded(item.portion.maximumGrams)} g · {item.portion.basis === "user_measured_weight" ? "measured" : item.portion.basis === "standard_portion_profile" ? "standard portion" : "user estimate"}
                    </p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4, marginTop: 9 }}>
                    {([
                      ["kcal", values.calories],
                      ["protein", values.protein],
                      ["fat", values.fat],
                      ["carbs", values.carbohydrates],
                      ["fibre", values.fiber],
                    ] as const).map(([label, value]) => (
                      <div key={label} style={{ textAlign: "center", minWidth: 0 }}>
                        <p style={{ margin: 0, color: "#0F1720", fontSize: 10, fontWeight: 800 }}>{rounded(value)}</p>
                        <p style={{ margin: "1px 0 0", color: "#7B8490", fontSize: 8 }}>{label}</p>
                      </div>
                    ))}
                  </div>

                  <p style={{ margin: "9px 0 0", color: "#7B8490", fontSize: 9, lineHeight: 1.4 }}>
                    Source: {sourceText(item.provenance)}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {allergens.length > 0 ? (
        <div style={{ margin: "0 20px 14px", borderRadius: 16, border: "1px solid #F4CDC9", background: "#FDEAE9", padding: 13 }}>
          <p style={{ margin: 0, color: "#B91C1C", fontSize: 11, fontWeight: 800 }}>Possible recipe allergens</p>
          <p style={{ margin: "3px 0 0", color: "#5E2420", fontSize: 10, lineHeight: 1.45 }}>
            {allergens.join(", ")}. Confirm the actual recipe before relying on this warning.
          </p>
        </div>
      ) : null}

      {analysis.limitations.length > 0 ? (
        <section aria-labelledby="meal-limitations-heading" style={{ margin: "0 20px", borderRadius: 16, border: "1px solid #F3D49A", background: "#FFF4E0", padding: 13 }}>
          <h2 id="meal-limitations-heading" style={{ margin: 0, color: "#8A5200", fontSize: 11, fontWeight: 800 }}>
            About this estimate
          </h2>
          <ul style={{ margin: "6px 0 0", paddingLeft: 17, color: "#6C4C1C", fontSize: 10, lineHeight: 1.55 }}>
            {analysis.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
