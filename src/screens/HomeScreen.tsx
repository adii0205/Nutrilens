import { useState, useEffect } from "react";
import type { Screen } from "../App";
import type { AnalyzedProduct } from "../types";
import { getHistoryStats, getAlerts, getHistory, getUserProfile } from "../services/storageService";
import { PRODUCTS } from "../data/products";

export default function HomeScreen({
  navigate,
  navigateWithProduct,
}: {
  navigate: (s: Screen, p?: string) => void;
  navigateWithProduct?: (s: Screen, p: AnalyzedProduct) => void;
}) {
  const [stats, setStats] = useState({ totalScans: 0, todayScans: 0, avgScore: 0, alertCount: 0 });
  const [alertsList, setAlertsList] = useState<{ icon: string; label: string; product: string; color: string }[]>([]);
  const [recentItems, setRecentItems] = useState<{ product: AnalyzedProduct; time: string }[]>([]);
  const [userName, setUserName] = useState("Sarah Chen");

  useEffect(() => {
    const profile = getUserProfile();
    if (profile.name) setUserName(profile.name);

    const s = getHistoryStats();
    setStats(s);

    const a = getAlerts();
    setAlertsList(a);

    const history = getHistory();
    if (history.length > 0) {
      const recents = history.slice(0, 3).map((item) => {
        const diffMs = Date.now() - new Date(item.scannedAt).getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        let timeStr = "Just now";
        if (diffHours >= 1 && diffHours < 24) timeStr = `${diffHours}h ago`;
        else if (diffDays === 1) timeStr = "Yesterday";
        else if (diffDays > 1) timeStr = `${diffDays}d ago`;

        return {
          product: item.product,
          time: timeStr,
        };
      });
      setRecentItems(recents);
    } else {
      // Fallback sample items
      const sampleNames = ["Oatly Oat Milk", "Grenade Protein Bar", "Pringles Original"];
      const fallback = sampleNames.map((name, idx) => ({
        product: {
          ...PRODUCTS[name],
          id: `sample_${idx}`,
          analysisMode: "label" as const,
        },
        time: idx === 0 ? "2h ago" : idx === 1 ? "Yesterday" : "2d ago",
      }));
      setRecentItems(fallback);
    }
  }, []);

  const handleProductClick = (prod: AnalyzedProduct) => {
    if (navigateWithProduct) {
      navigateWithProduct("results", prod);
    } else {
      navigate("results", prod.name);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const initials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "NL";

  return (
    <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#5A6472", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {getGreeting()}
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#0F1720", lineHeight: 1.2, marginTop: 2 }}>
            {userName} 👋
          </h1>
        </div>
        <div
          onClick={() => navigate("profile")}
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "#1B7A43",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <span style={{ color: "white", fontWeight: 700, fontSize: 13 }}>{initials}</span>
        </div>
      </div>

      {/* Scan CTA */}
      <button
        onClick={() => navigate("scan")}
        style={{
          width: "100%",
          borderRadius: 20,
          background: "linear-gradient(135deg, #1B7A43 0%, #145c32 100%)",
          border: "none",
          cursor: "pointer",
          padding: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
          <p style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "0.1em", textTransform: "uppercase", margin: 0 }}>
            NutriLens AI
          </p>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "white", lineHeight: 1.25, margin: 0 }}>
            Scan a product<br />or meal now
          </h2>
          <div style={{ marginTop: 8, background: "rgba(255,255,255,0.18)", borderRadius: 20, padding: "5px 12px", display: "inline-block" }}>
            <span style={{ color: "white", fontSize: 12, fontWeight: 600 }}>Tap to scan →</span>
          </div>
        </div>
        <div style={{
          width: 72, height: 72, borderRadius: 16,
          background: "rgba(255,255,255,0.12)",
          border: "1.5px solid rgba(255,255,255,0.25)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, marginLeft: 12,
        }}>
          <svg width="36" height="36" viewBox="0 0 40 40" fill="none">
            <rect x="4" y="4" width="10" height="2" rx="1" fill="white"/>
            <rect x="4" y="4" width="2" height="10" rx="1" fill="white"/>
            <rect x="26" y="4" width="10" height="2" rx="1" fill="white"/>
            <rect x="34" y="4" width="2" height="10" rx="1" fill="white"/>
            <rect x="4" y="34" width="10" height="2" rx="1" fill="white"/>
            <rect x="4" y="26" width="2" height="10" rx="1" fill="white"/>
            <rect x="26" y="34" width="10" height="2" rx="1" fill="white"/>
            <rect x="34" y="26" width="2" height="10" rx="1" fill="white"/>
            <line x1="12" y1="20" x2="28" y2="20" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </div>
      </button>

      {/* Alerts */}
      <div>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#5A6472", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
          Alerts
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(alertsList.length > 0
            ? alertsList
            : [
                { icon: "⚠️", label: "Peanut allergen detected", product: "Grenade Protein Bar", color: "#E4483C" },
                { icon: "🔔", label: "High sodium — 680mg/serving", product: "Pringles Original", color: "#F5A623" },
              ]
          ).map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12,
              background: "white", borderRadius: 14, padding: "12px 14px",
              border: "1px solid #E8ECEF",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            }}>
              <span style={{ fontSize: 16 }}>{a.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#0F1720", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {a.label}
                </p>
                <p style={{ fontSize: 11, color: "#5A6472", margin: 0, marginTop: 1 }}>{a.product}</p>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: a.color, flexShrink: 0 }} />
            </div>
          ))}
        </div>
      </div>

      {/* Daily Summary */}
      <div style={{ background: "white", borderRadius: 18, border: "1px solid #E8ECEF", padding: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "#5A6472", letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 12px 0" }}>
          Today's overview
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            { label: "Scans", value: stats.todayScans > 0 ? `${stats.todayScans}` : "3", color: "#1B7A43" },
            { label: "Avg Score", value: stats.avgScore > 0 ? `${stats.avgScore}` : "58", sub: "/100", color: "#F5A623" },
            { label: "Alerts", value: stats.alertCount > 0 ? `${stats.alertCount}` : "2", color: "#E4483C" },
          ].map((stat) => (
            <div key={stat.label} style={{ textAlign: "center" }}>
              <p style={{ fontSize: 26, fontWeight: 800, color: stat.color, margin: 0, lineHeight: 1.1 }}>
                {stat.value}
                {stat.sub && <span style={{ fontSize: 11, fontWeight: 400, color: "#5A6472" }}>{stat.sub}</span>}
              </p>
              <p style={{ fontSize: 11, color: "#5A6472", margin: 0, marginTop: 3 }}>{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Scans */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: "#5A6472", letterSpacing: "0.08em", textTransform: "uppercase", margin: 0 }}>
            Recent scans
          </p>
          <button onClick={() => navigate("history")} style={{ fontSize: 12, fontWeight: 700, color: "#1B7A43", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            See all
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {recentItems.map((item, idx) => {
            const p = item.product;
            return (
              <button
                key={`${p.name}_${idx}`}
                onClick={() => handleProductClick(p)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "white", borderRadius: 18, padding: "14px 16px",
                  border: "1px solid #E8ECEF", cursor: "pointer", textAlign: "left",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
                  width: "100%", boxSizing: "border-box",
                }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: p.gradeBg, color: p.gradeColor,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, fontWeight: 900, flexShrink: 0,
                }}>
                  {p.grade}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "#0F1720", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.name}
                  </p>
                  <p style={{ fontSize: 11, color: "#5A6472", margin: 0, marginTop: 2 }}>
                    {p.brand} · {p.kcal} kcal
                  </p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: p.gradeColor }}>{p.score}</span>
                  <span style={{ fontSize: 10, color: "#5A6472" }}>{item.time}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
