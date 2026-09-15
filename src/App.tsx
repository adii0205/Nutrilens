import { useState, useEffect } from "react";
import HomeScreen from "./screens/HomeScreen";
import ScanScreen from "./screens/ScanScreen";
import ResultsScreen from "./screens/ResultsScreen";
import HistoryScreen from "./screens/HistoryScreen";
import ProfileScreen from "./screens/ProfileScreen";
import NavBar from "./components/NavBar";
import type { AnalyzedProduct } from "./types";
import { getApiKey } from "./services/storageService";

export type Screen = "home" | "scan" | "results" | "history" | "profile";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [analyzedProduct, setAnalyzedProduct] = useState<AnalyzedProduct | null>(null);
  const [hasApiKey, setHasApiKey] = useState<boolean>(!!getApiKey());

  useEffect(() => {
    setHasApiKey(!!getApiKey());
  }, [screen]);

  const navigate = (s: Screen, product?: AnalyzedProduct | string) => {
    if (product && typeof product === "object") {
      setAnalyzedProduct(product);
    }
    // Legacy string support for history/home clicks
    if (product && typeof product === "string") {
      // Will be handled by ResultsScreen loading from history
      setAnalyzedProduct(null);
    }
    setScreen(s);
  };

  const navigateWithProduct = (s: Screen, product: AnalyzedProduct) => {
    setAnalyzedProduct(product);
    setScreen(s);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#D1D5DB" }}>
      <div style={{
        position: "relative",
        width: 375,
        height: 812,
        background: "#F7F9FA",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderRadius: 44,
        boxShadow: "0 32px 80px rgba(0,0,0,0.35), 0 0 0 10px #1a1a1a, 0 0 0 12px #333",
      }}>
        {/* Status Bar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px 8px", background: "#F7F9FA", flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#0F1720" }}>9:41</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
              <rect x="0" y="4" width="3" height="7" rx="0.5" fill="#0F1720"/>
              <rect x="4.5" y="2.5" width="3" height="8.5" rx="0.5" fill="#0F1720"/>
              <rect x="9" y="0.5" width="3" height="10.5" rx="0.5" fill="#0F1720"/>
              <rect x="13.5" y="0.5" width="3" height="10.5" rx="0.5" fill="#0F1720" fillOpacity="0.3"/>
            </svg>
            <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
              <path d="M7.5 2.5C5.5 2.5 3.7 3.3 2.4 4.6L1 3.2C2.8 1.2 5 0 7.5 0s4.7 1.2 6.5 3.2L12.6 4.6C11.3 3.3 9.5 2.5 7.5 2.5z" fill="#0F1720"/>
              <path d="M7.5 5.5C6.1 5.5 4.9 6.1 4 7.1L2.6 5.7C4 4.1 5.6 3.2 7.5 3.2s3.5.9 4.9 2.5L10.9 7.1C10 6.1 8.9 5.5 7.5 5.5z" fill="#0F1720"/>
              <circle cx="7.5" cy="9.5" r="1.5" fill="#0F1720"/>
            </svg>
            <div style={{ display: "flex", alignItems: "center" }}>
              <div style={{ width: 24, height: 12, border: "1.5px solid #0F1720", borderRadius: 3, padding: 1.5, boxSizing: "border-box", display: "flex", alignItems: "center" }}>
                <div style={{ height: "100%", width: "80%", background: "#0F1720", borderRadius: 1 }}/>
              </div>
            </div>
          </div>
        </div>

        {/* API Key Banner */}
        {!hasApiKey && screen !== "profile" && (
          <button
            onClick={() => setScreen("profile")}
            style={{
              margin: "0 20px 0",
              padding: "10px 14px",
              background: "linear-gradient(135deg, #FFF4E0, #FDEAE9)",
              border: "1px solid rgba(245,166,35,0.3)",
              borderRadius: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 16 }}>🔑</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#0F1720", textAlign: "left" }}>
              Add Gemini for optional image suggestions
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A6472" strokeWidth="2" strokeLinecap="round">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        )}

        {/* Main Content */}
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
          {screen === "home" && <HomeScreen navigate={navigate} navigateWithProduct={navigateWithProduct} />}
          {screen === "scan" && <ScanScreen navigate={navigate} navigateWithProduct={navigateWithProduct} />}
          {screen === "results" && (
            <ResultsScreen
              product={analyzedProduct}
              navigate={navigate}
              onProductUpdate={setAnalyzedProduct}
            />
          )}
          {screen === "history" && <HistoryScreen navigate={navigate} navigateWithProduct={navigateWithProduct} />}
          {screen === "profile" && <ProfileScreen navigate={navigate} onApiKeyChange={() => setHasApiKey(!!getApiKey())} />}
        </div>

        {/* Bottom Nav */}
        {screen !== "scan" && (
          <NavBar current={screen} navigate={navigate} />
        )}
      </div>
    </div>
  );
}
