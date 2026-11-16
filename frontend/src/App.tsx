import { useState } from "react";
import { AgentPlanner } from "./components/AgentPlanner";
import { BookingDesk } from "./components/BookingDesk";
import { GalleryView } from "./components/GalleryView";
import { GuideRag } from "./components/GuideRag";
import { MapStudio } from "./components/MapStudio";
import { ScenicExplorer } from "./components/ScenicExplorer";
import type { BookingDraft } from "./types";

type Tab = "agent" | "map" | "scenic" | "guide" | "gallery" | "booking";

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
          <div className="brand">
            <span>🧭</span>
            <div>
              漫游城市 AI
              <small>ROAM CITY · AI TRAVEL WORKSPACE</small>
            </div>
          </div>
          <nav className="nav-tabs" aria-label="主导航">
            <button
              type="button"
              className={`nav-tab ${tab === "agent" ? "active" : ""}`}
              onClick={() => setTab("agent")}
            >
              AI 行程规划
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "map" ? "active" : ""}`}
              onClick={() => setTab("map")}
            >
              中国地图排线
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "scenic" ? "active" : ""}`}
              onClick={() => setTab("scenic")}
            >
              精选景点
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "guide" ? "active" : ""}`}
              onClick={() => setTab("guide")}
            >
              RAG 攻略库
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "gallery" ? "active" : ""}`}
              onClick={() => setTab("gallery")}
            >
              视觉图集
            </button>
            <button
              type="button"
              className={`nav-tab ${tab === "booking" ? "active" : ""}`}
              onClick={() => setTab("booking")}
            >
              门票预约
            </button>
          </nav>
        </div>
      </header>

      <main className="container">
        {tab === "agent" && (
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
        )}
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
