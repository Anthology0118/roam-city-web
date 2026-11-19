import { useState } from "react";
import { AgentPlanner } from "./components/AgentPlanner";
import { BookingDesk } from "./components/BookingDesk";
import { GalleryView } from "./components/GalleryView";
import { GuideRag } from "./components/GuideRag";
import { MapStudio } from "./components/MapStudio";
import { ScenicExplorer } from "./components/ScenicExplorer";
import type { BookingDraft } from "./types";

type Tab = "agent" | "map" | "scenic" | "guide" | "gallery" | "booking";

const NAV_ITEMS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: "agent", icon: "✨", label: "AI 行程规划" },
  { id: "map", icon: "🗺️", label: "3D 中国沙盘" },
  { id: "scenic", icon: "🏔️", label: "精选景点" },
  { id: "guide", icon: "📚", label: "RAG 攻略库" },
  { id: "gallery", icon: "📸", label: "视觉图集" },
  { id: "booking", icon: "🎫", label: "门票预约" },
];

export function App() {
  const [tab, setTab] = useState<Tab>("agent");
  const [bookingPrefill, setBookingPrefill] = useState<{ spotId: string; count: number }>({
    spotId: "gugong",
    count: 1,
  });
  const [activeGuideId, setActiveGuideId] = useState<string | undefined>(undefined);
  const [mapTransfer, setMapTransfer] = useState<{
    spotIds: string[];
    days: number;
    budget: number | null;
  } | null>(null);

  function applyDraft(draft: BookingDraft) {
    setBookingPrefill({ spotId: draft.spot_id, count: draft.suggested_count });
    setTab("booking");
  }

  return (
    <div>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand" style={{ cursor: "pointer" }} onClick={() => setTab("agent")}>
            <span className="brand-logo">✦</span>
            <div>
              漫游城市 AI
              <small>ROAM CITY · AI TRAVEL STUDIO</small>
            </div>
          </div>
          <nav className="nav-tabs" aria-label="主导航">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-tab ${tab === item.id ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                <span className="nav-tab-icon">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="container">
        <div style={{ display: tab === "agent" ? "block" : "none" }}>
          <AgentPlanner
            onApplyBookingDraft={applyDraft}
            onOpenGuide={(gid) => {
              setActiveGuideId(gid);
              setTab("guide");
            }}
            onTransferToMap={(spotIds, days, budget) => {
              setMapTransfer({ spotIds, days, budget });
              setTab("map");
            }}
          />
        </div>
        {tab === "map" && (
          <MapStudio
            initialSpotIds={mapTransfer?.spotIds}
            initialDays={mapTransfer?.days}
            initialBudget={mapTransfer?.budget}
            onBookSpot={(spotId) => {
              setBookingPrefill({ spotId, count: 1 });
              setTab("booking");
            }}
          />
        )}
        {tab === "scenic" && (
          <ScenicExplorer
            onLocateSpot={(spotId) => {
              setMapTransfer({ spotIds: [spotId], days: 1, budget: null });
              setTab("map");
            }}
            onBookSpot={(spotId) => {
              setBookingPrefill({ spotId, count: 1 });
              setTab("booking");
            }}
          />
        )}
        {tab === "guide" && <GuideRag initialGuideId={activeGuideId} />}
        {tab === "gallery" && <GalleryView />}
        {tab === "booking" && (
          <BookingDesk initialSpotId={bookingPrefill.spotId} initialCount={bookingPrefill.count} />
        )}
      </main>
    </div>
  );
}

export default App;
