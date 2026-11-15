import { useState } from "react";
import { AgentPlanner } from "./components/AgentPlanner";
import { BookingDesk } from "./components/BookingDesk";
import { GuideRag } from "./components/GuideRag";
import { ScenicExplorer } from "./components/ScenicExplorer";
import type { BookingDraft } from "./types";

type Tab = "agent" | "scenic" | "guide" | "booking";

export function App() {
  const [tab, setTab] = useState<Tab>("agent");
  const [bookingPrefill, setBookingPrefill] = useState<{ spotId: string; count: number }>({
    spotId: "gugong",
    count: 1,
  });

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
              className={`nav-tab ${tab === "booking" ? "active" : ""}`}
              onClick={() => setTab("booking")}
            >
              门票预约
            </button>
          </nav>
        </div>
      </header>

      <main className="container">
        {tab === "agent" && <AgentPlanner onApplyBookingDraft={applyDraft} />}
        {tab === "scenic" && (
          <ScenicExplorer
            onBookSpot={(spotId) => {
              setBookingPrefill({ spotId, count: 1 });
              setTab("booking");
            }}
          />
        )}
        {tab === "guide" && <GuideRag />}
        {tab === "booking" && (
          <BookingDesk initialSpotId={bookingPrefill.spotId} initialCount={bookingPrefill.count} />
        )}
      </main>
    </div>
  );
}

export default App;
