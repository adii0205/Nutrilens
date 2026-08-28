import type { Screen } from "../App";

const tabs = [
  {
    id: "home" as Screen,
    label: "Home",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1B7A43" : "#5A6472"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    id: "scan" as Screen,
    label: "Scan",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1B7A43" : "#5A6472"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9V5a2 2 0 012-2h4M3 15v4a2 2 0 002 2h4M21 9V5a2 2 0 00-2-2h-4M21 15v4a2 2 0 01-2 2h-4"/>
        <line x1="8" y1="12" x2="16" y2="12"/>
      </svg>
    ),
  },
  {
    id: "history" as Screen,
    label: "History",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1B7A43" : "#5A6472"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
  {
    id: "profile" as Screen,
    label: "Profile",
    icon: (active: boolean) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={active ? "#1B7A43" : "#5A6472"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
];

export default function NavBar({ current, navigate }: { current: Screen; navigate: (s: Screen) => void }) {
  return (
    <div style={{
      flexShrink: 0,
      background: "white",
      borderTop: "1px solid #E8ECEF",
      padding: "8px 8px 20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around" }}>
        {tabs.map((tab) => {
          const active = current === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => navigate(tab.id)}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "6px 16px",
                borderRadius: 12,
                border: "none",
                background: active ? "#E9F7EF" : "transparent",
                cursor: "pointer",
              }}
            >
              {tab.icon(active)}
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: active ? "#1B7A43" : "#5A6472",
                letterSpacing: "0.03em",
              }}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
