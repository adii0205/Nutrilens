import { useState, useEffect } from "react";
import type { Screen } from "../App";
import type { AnalyzedProduct, ScanHistoryItem } from "../types";
import { getHistory, deleteHistoryItem, clearHistory, getUserProfile } from "../services/storageService";
import { PRODUCTS } from "../data/products";

const filters = ["All", "Grade A", "Grade B", "Grade C/D", "Alerts"];

export default function HistoryScreen({
  navigate,
  navigateWithProduct,
}: {
  navigate: (s: Screen, p?: string) => void;
  navigateWithProduct?: (s: Screen, p: AnalyzedProduct) => void;
}) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [historyItems, setHistoryItems] = useState<ScanHistoryItem[]>([]);

  const loadHistory = () => {
    const saved = getHistory();
    if (saved.length > 0) {
      setHistoryItems(saved);
    } else {
      // Create initial seed items from sample products
      const seedProducts = [
        { name: "Oatly Oat Milk", date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString() },
        { name: "Grenade Protein Bar", date: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString() },
        { name: "Pringles Original", date: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString() },
        { name: "Alpro Soya Yogurt", date: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString() },
        { name: "Quaker Oats", date: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString() },
      ];
      const initial: ScanHistoryItem[] = seedProducts.map((sp, idx) => ({
        id: `seed_${idx}`,
        product: {
          ...PRODUCTS[sp.name],
          id: `seed_prod_${idx}`,
          analysisMode: "label" as const,
        },
        scannedAt: sp.date,
      }));
      setHistoryItems(initial);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteHistoryItem(id);
    setHistoryItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearAll = () => {
    if (window.confirm("Are you sure you want to clear all scan history?")) {
      clearHistory();
      setHistoryItems([]);
    }
  };

  const handleItemClick = (prod: AnalyzedProduct) => {
    if (navigateWithProduct) {
      navigateWithProduct("results", prod);
    } else {
      navigate("results", prod.name);
    }
  };

  const profile = getUserProfile();

  const filtered = historyItems.filter((item) => {
    const p = item.product;
    if (!p) return false;
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.brand.toLowerCase().includes(search.toLowerCase());

    if (!matchesSearch) return false;

    if (filter === "Grade A") return !p.mealAnalysis && p.grade === "A";
    if (filter === "Grade B") return !p.mealAnalysis && p.grade === "B";
    if (filter === "Grade C/D") {
      return !p.mealAnalysis && (p.grade === "C" || p.grade === "D" || p.grade === "F");
    }
    if (filter === "Alerts") {
      const hasAllergen = p.allergens.some((a) =>
        profile.allergens.some((pa) => a.toLowerCase().includes(pa.toLowerCase()))
      );
      const highSodium = p.nutrients.some((n) => n.name.toLowerCase().includes("sodium") && n.rating === "bad");
      return hasAllergen || highSodium || p.allergens.length > 0;
    }
    return true;
  });

  const formatScannedTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return "Recently";
    }
  };

  return (
    <div style={{ padding: "8px 20px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0F1720", margin: 0 }}>Scan History</h1>
          <p style={{ fontSize: 13, color: "#5A6472", margin: "4px 0 0" }}>{historyItems.length} scans</p>
        </div>
        {historyItems.length > 0 && (
          <button
            onClick={handleClearAll}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#E4483C",
              background: "#FDEAE9",
              border: "1px solid rgba(228,72,60,0.2)",
              borderRadius: 10,
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 12 }}>
        <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#5A6472" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          placeholder="Search products, meals, or dishes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%", paddingLeft: 36, paddingRight: 14, paddingTop: 10, paddingBottom: 10,
            background: "white", border: "1px solid #E8ECEF", borderRadius: 14,
            fontSize: 13, color: "#0F1720", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto" }}>
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              flexShrink: 0, padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
              background: filter === f ? "#1B7A43" : "white",
              color: filter === f ? "white" : "#5A6472",
              border: filter === f ? "1px solid #1B7A43" : "1px solid #E8ECEF",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((item) => {
          const p = item.product;
          if (!p) return null;
          const isMeal = Boolean(p.mealAnalysis);
          return (
            <button
              key={item.id}
              onClick={() => handleItemClick(p)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                background: "white", borderRadius: 18, padding: "14px 16px",
                border: "1px solid #E8ECEF", cursor: "pointer", textAlign: "left",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)", width: "100%", boxSizing: "border-box",
                position: "relative",
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: isMeal ? "#FFF4E0" : p.gradeBg,
                color: isMeal ? "#B46A00" : p.gradeColor,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, fontWeight: 900, flexShrink: 0,
              }}>
                {isMeal ? "🍛" : p.grade}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#0F1720", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.name}
                </p>
                <p style={{ fontSize: 11, color: "#5A6472", margin: 0, marginTop: 2 }}>
                  {p.brand} · {formatScannedTime(item.scannedAt)}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: isMeal ? 11 : 17, fontWeight: 800, color: isMeal ? "#B46A00" : p.gradeColor }}>
                  {isMeal ? `${Math.round(p.kcal)} kcal` : p.score}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {p.allergens.length > 0 && (
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#FDEAE9", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="10" height="9" viewBox="0 0 24 22" fill="none" stroke="#E4483C" strokeWidth="3" strokeLinecap="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                      </svg>
                    </div>
                  )}
                  <div
                    onClick={(e) => handleDelete(item.id, e)}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "#F7F9FA",
                      color: "#5A6472",
                    }}
                    title="Delete"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5A6472" strokeWidth="2" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <p style={{ color: "#5A6472", fontSize: 14 }}>No products found</p>
          </div>
        )}
      </div>
    </div>
  );
}
