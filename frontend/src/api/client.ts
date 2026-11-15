import type {
  BookingDraft,
  BookingOrder,
  CitationItem,
  GuideDoc,
  GuideSearchHit,
  ItineraryPlan,
  Spot,
} from "../types";

export async function fetchSpots(cat?: string, keyword?: string): Promise<Spot[]> {
  const qs = new URLSearchParams();
  if (cat && cat !== "全部") qs.set("cat", cat);
  if (keyword) qs.set("keyword", keyword);
  const res = await fetch(`/api/spots?${qs.toString()}`);
  if (!res.ok) throw new Error("获取景点失败");
  const data = await res.json();
  return data.items;
}

export async function fetchGuides(): Promise<GuideDoc[]> {
  const res = await fetch("/api/guides");
  if (!res.ok) throw new Error("获取攻略失败");
  const data = await res.json();
  return data.items;
}

export async function searchGuidesRag(q: string): Promise<GuideSearchHit[]> {
  const qs = new URLSearchParams({ q, top_k: "4" });
  const res = await fetch(`/api/guides/search?${qs.toString()}`);
  if (!res.ok) throw new Error("RAG 检索失败");
  const data = await res.json();
  return data.items;
}

export async function fetchBookings(): Promise<BookingOrder[]> {
  const res = await fetch("/api/bookings");
  if (!res.ok) throw new Error("获取订单失败");
  const data = await res.json();
  return data.items;
}

export async function createBooking(payload: {
  spot_id: string;
  visit_date: string;
  session_slot: string;
  ticket_type: "成人票" | "学生票";
  count: number;
  visitor_name: string;
  phone: string;
  id_card?: string;
  email?: string;
}): Promise<BookingOrder> {
  const res = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "下单失败");
  return data;
}

export async function cancelBooking(orderId: string): Promise<void> {
  const res = await fetch(`/api/bookings/${orderId}/cancel`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "取消失败");
}

export async function optimizeRoute(payload: {
  spot_ids?: string[];
  days: number;
  budget?: number | null;
}): Promise<ItineraryPlan> {
  const res = await fetch("/api/planner/optimize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "路线优化失败");
  return data;
}

export async function fetchFavorites(): Promise<string[]> {
  const res = await fetch("/api/favorites");
  if (!res.ok) throw new Error("获取心愿单失败");
  const data = await res.json();
  return data.spot_ids || [];
}

export async function toggleFavorite(spotId: string): Promise<{ spot_id: string; liked: boolean; spot_ids: string[] }> {
  const res = await fetch(`/api/favorites/${encodeURIComponent(spotId)}`, { method: "POST" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "收藏操作失败");
  return data;
}

export interface AgentStreamCallbacks {
  onStatus: (msg: string, meta?: { session_id?: string; turn?: number }) => void;
  onToolEvent: (label: string) => void;
  onPlan: (plan: ItineraryPlan) => void;
  onCitations: (items: CitationItem[]) => void;
  onBookingDraft: (draft: BookingDraft) => void;
  onToken: (delta: string) => void;
  onDone: (metrics: { session_id?: string; ttft_ms: number; total_ms: number; mode: string }) => void;
}

export async function streamAgentChat(
  query: string,
  cb: AgentStreamCallbacks,
  sessionId?: string | null
): Promise<void> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, session_id: sessionId || undefined }),
  });
  if (!res.ok || !res.body) {
    throw new Error("Agent 流式连接失败");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    for (const block of blocks) {
      const lines = block.split("\n");
      let eventName = "message";
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
      }
      if (!dataLine) continue;
      const payload = JSON.parse(dataLine);

      switch (eventName) {
        case "status":
          cb.onStatus(payload.message || "", {
            session_id: payload.session_id,
            turn: payload.turn,
          });
          break;
        case "tool_call":
          cb.onToolEvent(`调用工具 ${payload.tool}(${JSON.stringify(payload.args || {})})`);
          break;
        case "tool_result":
          cb.onToolEvent(
            `${payload.tool}: ${typeof payload.summary === "string" ? payload.summary : JSON.stringify(payload.summary)}`
          );
          break;
        case "plan":
          cb.onPlan(payload as ItineraryPlan);
          break;
        case "citations":
          cb.onCitations(payload.items || []);
          break;
        case "booking_draft":
          cb.onBookingDraft(payload as BookingDraft);
          break;
        case "token":
          cb.onToken(payload.text || "");
          break;
        case "done":
          cb.onDone(payload);
          break;
      }
    }
  }
}
