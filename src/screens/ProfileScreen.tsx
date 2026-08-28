import { useState, useEffect } from "react";
import type { Screen } from "../App";
import {
  getUserProfile,
  saveUserProfile,
  getApiKey,
  setApiKey,
  clearApiKey,
  getHistoryStats,
} from "../services/storageService";
import { validateApiKey } from "../services/geminiService";

const allergenList = ["Peanuts", "Tree nuts", "Milk", "Eggs", "Wheat / Gluten", "Soya", "Fish", "Shellfish", "Sesame"];
const dietLabels = ["Vegetarian", "Vegan", "Gluten-free", "Dairy-free", "High protein", "Low sodium", "Keto"];

const card = { background: "white", borderRadius: 18, border: "1px solid #E8ECEF", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" };

export default function ProfileScreen({
  navigate: _navigate,
  onApiKeyChange,
}: {
  navigate: (s: Screen) => void;
  onApiKeyChange?: () => void;
}) {
  const [name, setName] = useState("Sarah Chen");
  const [email, setEmail] = useState("sarah.chen@email.com");
  const [myAllergens, setMyAllergens] = useState<string[]>(["Peanuts", "Tree nuts"]);
  const [myDiet, setMyDiet] = useState<string[]>(["Vegetarian"]);
  const [dailyKcal, setDailyKcal] = useState(2000);
  const [proteinGoal, setProteinGoal] = useState(55);
  const [sodiumLimit, setSodiumLimit] = useState(2300);

  // Gemini API key state
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<"idle" | "validating" | "valid" | "invalid">("idle");
  const [showKeyInput, setShowKeyInput] = useState(false);

  // Stats
  const [stats, setStats] = useState({ totalScans: 47, avgScore: 71, alertCount: 8 });

  useEffect(() => {
    const profile = getUserProfile();
    setName(profile.name || "Sarah Chen");
    setEmail(profile.email || "sarah.chen@email.com");
    setMyAllergens(profile.allergens);
    setMyDiet(profile.dietPreferences);
    setDailyKcal(profile.dailyCalories);
    setProteinGoal(profile.proteinGoal);
    setSodiumLimit(profile.sodiumLimit);

    const k = getApiKey();
    setSavedKey(k);
    if (k) setApiKeyInput(k);

    const s = getHistoryStats();
    if (s.totalScans > 0) {
      setStats({
        totalScans: s.totalScans,
        avgScore: s.avgScore,
        alertCount: s.alertCount,
      });
    }
  }, []);

  const saveProfileChanges = (overrides: Partial<ReturnType<typeof getUserProfile>> = {}) => {
    const updated = {
      name,
      email,
      allergens: myAllergens,
      dietPreferences: myDiet,
      dailyCalories: dailyKcal,
      proteinGoal,
      sodiumLimit,
      ...overrides,
    };
    saveUserProfile(updated);
  };

  const toggle = <T,>(list: T[], val: T, set: (l: T[]) => void, key: "allergens" | "dietPreferences") => {
    const updated = list.includes(val) ? list.filter((x) => x !== val) : [...list, val];
    set(updated);
    saveProfileChanges({ [key]: updated });
  };

  const handleSaveApiKey = async () => {
    const cleanKey = apiKeyInput.trim();
    if (!cleanKey) {
      clearApiKey();
      setSavedKey(null);
      setKeyStatus("idle");
      onApiKeyChange?.();
      return;
    }

    setKeyStatus("validating");
    const isValid = await validateApiKey(cleanKey);
    if (isValid) {
      setApiKey(cleanKey);
      setSavedKey(cleanKey);
      setKeyStatus("valid");
      onApiKeyChange?.();
      setTimeout(() => setShowKeyInput(false), 1200);
    } else {
      setKeyStatus("invalid");
    }
  };

  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "NL";

  return (
    <div style={{ padding: "8px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, paddingTop: 4 }}>
        <div style={{ width: 60, height: 60, borderRadius: 18, background: "#1B7A43", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <span style={{ color: "white", fontWeight: 800, fontSize: 18 }}>{initials}</span>
        </div>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#0F1720", margin: 0 }}>{name}</h1>
          <p style={{ fontSize: 12, color: "#5A6472", margin: "3px 0 4px" }}>{email}</p>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: savedKey ? "#1B7A43" : "#F5A623" }}/>
            <span style={{ fontSize: 11, fontWeight: 700, color: savedKey ? "#1B7A43" : "#F5A623" }}>
              {savedKey ? "AI Vision Active" : "Setup Gemini Key"}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        {[
          { label: "Scans", value: `${stats.totalScans}`, icon: "📷" },
          { label: "Avg score", value: `${stats.avgScore}`, icon: "⭐" },
          { label: "Alerts caught", value: `${stats.alertCount}`, icon: "🚨" },
        ].map((s) => (
          <div key={s.label} style={{ ...card, padding: 12, textAlign: "center" }}>
            <p style={{ fontSize: 18, margin: "0 0 4px" }}>{s.icon}</p>
            <p style={{ fontSize: 22, fontWeight: 800, color: "#0F1720", margin: 0 }}>{s.value}</p>
            <p style={{ fontSize: 10, color: "#5A6472", margin: "2px 0 0", fontWeight: 500 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Gemini AI API Key Config */}
      <div style={{ ...card, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🤖</span>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: "#0F1720", margin: 0 }}>Gemini AI Integration</p>
              <p style={{ fontSize: 11, color: "#5A6472", margin: 0 }}>
                {savedKey ? "API Key is configured & active" : "Required for OCR & AI analysis"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowKeyInput(!showKeyInput)}
            style={{
              padding: "4px 10px",
              borderRadius: 10,
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
              background: savedKey ? "#E9F7EF" : "#FFF4E0",
              color: savedKey ? "#1B7A43" : "#F5A623",
              border: "none",
            }}
          >
            {showKeyInput ? "Close" : savedKey ? "Change" : "Enter Key"}
          </button>
        </div>

        {showKeyInput && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              type="password"
              placeholder="Paste Google Gemini API Key"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 12,
                border: `1px solid ${keyStatus === "invalid" ? "#E4483C" : "#E8ECEF"}`,
                fontSize: 12, color: "#0F1720", background: "#F7F9FA", outline: "none",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleSaveApiKey}
                disabled={keyStatus === "validating"}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 10, fontSize: 12, fontWeight: 700,
                  background: "#1B7A43", color: "white", border: "none", cursor: "pointer",
                }}
              >
                {keyStatus === "validating" ? "Validating key..." : keyStatus === "valid" ? "✓ Saved!" : "Save & Verify Key"}
              </button>
              {savedKey && (
                <button
                  onClick={() => {
                    clearApiKey();
                    setSavedKey(null);
                    setApiKeyInput("");
                    onApiKeyChange?.();
                  }}
                  style={{
                    padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                    background: "#FDEAE9", color: "#E4483C", border: "none", cursor: "pointer",
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            {keyStatus === "invalid" && (
              <p style={{ fontSize: 11, color: "#E4483C", margin: 0 }}>
                Invalid API key. Get one for free at <a href="https://ai.google.dev" target="_blank" rel="noreferrer" style={{ color: "#E4483C", textDecoration: "underline" }}>ai.google.dev</a>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Allergens */}
      <div style={{ ...card, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#0F1720", margin: 0 }}>My allergens</p>
          <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#FDEAE9", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="10" height="9" viewBox="0 0 24 22" fill="none" stroke="#E4483C" strokeWidth="3" strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {allergenList.map((a) => {
            const active = myAllergens.includes(a);
            return (
              <button
                key={a}
                onClick={() => toggle(myAllergens, a, setMyAllergens, "allergens")}
                style={{
                  padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: active ? "#FDEAE9" : "#F7F9FA",
                  color: active ? "#E4483C" : "#5A6472",
                  border: active ? "1px solid rgba(228,72,60,0.3)" : "1px solid #E8ECEF",
                }}
              >
                {a}
              </button>
            );
          })}
        </div>
      </div>

      {/* Diet */}
      <div style={{ ...card, padding: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "#0F1720", margin: "0 0 12px" }}>Dietary preferences</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {dietLabels.map((d) => {
            const active = myDiet.includes(d);
            return (
              <button
                key={d}
                onClick={() => toggle(myDiet, d, setMyDiet, "dietPreferences")}
                style={{
                  padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: active ? "#E9F7EF" : "#F7F9FA",
                  color: active ? "#1B7A43" : "#5A6472",
                  border: active ? "1px solid rgba(27,122,67,0.3)" : "1px solid #E8ECEF",
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>

      {/* Goals */}
      <div style={{ ...card, padding: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "#0F1720", margin: "0 0 16px" }}>Daily goals</p>
        {[
          { label: "Calories (kcal)", value: dailyKcal, min: 1200, max: 3500, step: 50, set: (v: number) => { setDailyKcal(v); saveProfileChanges({ dailyCalories: v }); }, color: "#1B7A43" },
          { label: "Protein (g)", value: proteinGoal, min: 30, max: 200, step: 5, set: (v: number) => { setProteinGoal(v); saveProfileChanges({ proteinGoal: v }); }, color: "#F5A623" },
          { label: "Sodium limit (mg)", value: sodiumLimit, min: 1000, max: 4000, step: 100, set: (v: number) => { setSodiumLimit(v); saveProfileChanges({ sodiumLimit: v }); }, color: "#E4483C" },
        ].map((g, idx) => {
          const pct = ((g.value - g.min) / (g.max - g.min)) * 100;
          return (
            <div key={g.label} style={{ marginBottom: idx < 2 ? 18 : 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#5A6472" }}>{g.label}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: g.color }}>{g.value.toLocaleString()}</span>
              </div>
              <input
                type="range" min={g.min} max={g.max} step={g.step} value={g.value}
                onChange={(e) => g.set(Number(e.target.value))}
                style={{
                  width: "100%", height: 6, borderRadius: 4, appearance: "none", cursor: "pointer",
                  background: `linear-gradient(to right, ${g.color} ${pct}%, #E8ECEF ${pct}%)`,
                  outline: "none",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Settings */}
      <div style={{ ...card, overflow: "hidden" }}>
        {[
          { icon: "🔔", label: "Notifications", detail: "Alerts, scan reminders" },
          { icon: "🔒", label: "Privacy", detail: "Data stored locally on device" },
          { icon: "📊", label: "Export data", detail: "JSON / Scan log history" },
          { icon: "💬", label: "Feedback", detail: "NutriLens AI v2.0" },
        ].map((item, i) => (
          <button key={item.label} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 12,
            padding: "14px 16px", cursor: "pointer", background: "none", border: "none", textAlign: "left",
            borderBottom: i < 3 ? "1px solid #E8ECEF" : "none",
          }}>
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#0F1720", margin: 0 }}>{item.label}</p>
              <p style={{ fontSize: 11, color: "#5A6472", margin: 0 }}>{item.detail}</p>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6472" strokeWidth="2" strokeLinecap="round">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}
