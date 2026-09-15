import type { AnalyzedProduct, ScanHistoryItem, UserProfile } from "../types";
import { DEFAULT_USER_PROFILE } from "../types";

const KEYS = {
  HISTORY: "nutrilens_history",
  PROFILE: "nutrilens_profile",
  API_KEY: "nutrilens_gemini_key",
};

// --- API Key ---

export function getApiKey(): string | null {
  return localStorage.getItem(KEYS.API_KEY);
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEYS.API_KEY, key);
}

export function clearApiKey(): void {
  localStorage.removeItem(KEYS.API_KEY);
}

// --- Scan History ---

export function getHistory(): ScanHistoryItem[] {
  try {
    const raw = localStorage.getItem(KEYS.HISTORY);
    if (!raw) return [];
    return JSON.parse(raw) as ScanHistoryItem[];
  } catch {
    return [];
  }
}

export function saveScannedProduct(product: AnalyzedProduct): ScanHistoryItem {
  const history = getHistory();
  const item: ScanHistoryItem = {
    id: `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    product,
    scannedAt: new Date().toISOString(),
  };
  history.unshift(item);
  // Keep max 100 items
  if (history.length > 100) history.length = 100;
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
  return item;
}

export function updateScannedProduct(product: AnalyzedProduct): boolean {
  const history = getHistory();
  let updated = false;
  const nextHistory = history.map((item) => {
    if (item.product?.id !== product.id) return item;
    updated = true;
    return { ...item, product };
  });

  if (updated) {
    localStorage.setItem(KEYS.HISTORY, JSON.stringify(nextHistory));
  }
  return updated;
}

export function deleteHistoryItem(id: string): void {
  const history = getHistory().filter((h) => h.id !== id);
  localStorage.setItem(KEYS.HISTORY, JSON.stringify(history));
}

export function clearHistory(): void {
  localStorage.removeItem(KEYS.HISTORY);
}

// --- User Profile ---

export function getUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(KEYS.PROFILE);
    if (!raw) return { ...DEFAULT_USER_PROFILE };
    return { ...DEFAULT_USER_PROFILE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_USER_PROFILE };
  }
}

export function saveUserProfile(profile: UserProfile): void {
  localStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
}

// --- Computed Stats ---

export function getHistoryStats() {
  const history = getHistory();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayScans = history.filter((h) => new Date(h.scannedAt) >= today);
  const allScores = history
    .filter((h) => !h.product.mealAnalysis)
    .map((h) => h.product.score);
  const avgScore = allScores.length > 0 ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0;

  const profile = getUserProfile();
  const alertCount = history.filter((h) => {
    const hasAllergenMatch = h.product.allergens.some((a) =>
      profile.allergens.some((pa) => a.toLowerCase().includes(pa.toLowerCase()))
    );
    const highSodium = h.product.nutrients.some(
      (n) => n.name.toLowerCase().includes("sodium") && n.rating === "bad"
    );
    return hasAllergenMatch || highSodium;
  }).length;

  return {
    totalScans: history.length,
    todayScans: todayScans.length,
    avgScore,
    gradedScans: allScores.length,
    alertCount,
  };
}

export function getAlerts(): { icon: string; label: string; product: string; color: string }[] {
  const history = getHistory();
  const profile = getUserProfile();
  const alerts: { icon: string; label: string; product: string; color: string }[] = [];

  for (const item of history.slice(0, 10)) {
    // Allergen alerts
    for (const allergen of item.product.allergens) {
      if (profile.allergens.some((pa) => allergen.toLowerCase().includes(pa.toLowerCase()))) {
        alerts.push({
          icon: "⚠️",
          label: `${allergen} allergen detected`,
          product: item.product.name,
          color: "#E4483C",
        });
      }
    }
    // High sodium alert
    const sodiumNutrient = item.product.nutrients.find(
      (n) => n.name.toLowerCase().includes("sodium")
    );
    if (sodiumNutrient && sodiumNutrient.rating === "bad") {
      alerts.push({
        icon: "🔔",
        label: `High sodium — ${sodiumNutrient.value}/serving`,
        product: item.product.name,
        color: "#F5A623",
      });
    }
  }

  return alerts.slice(0, 5);
}
