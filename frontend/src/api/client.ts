import type {
  AgentDoneMetrics,
  AgentSessionSummary,
  AgentTraceItem,
  BookingDraft,
  BookingOrder,
  CitationItem,
  DetectModelsResult,
  GuideDoc,
  GuideSearchHit,
  ItineraryPlan,
  LlmConfig,
  LlmTestResult,
  RagMode,
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

export async function searchGuidesRag(q: string, mode: RagMode = "hybrid"): Promise<GuideSearchHit[]> {
  const qs = new URLSearchParams({ q, top_k: "4", mode });
  const res = await fetch(`/api/guides/search?${qs.toString()}`);
  if (!res.ok) throw new Error("RAG 检索失败");
  const data = await res.json();
  return data.items;
}

export async function ingestGuide(payload: {
  title: string;
  category: string;
  content: string;
  tags?: string[];
}): Promise<{ guide_id: string; title: string; chunks_created: number }> {
  const res = await fetch("/api/guides/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "攻略入库失败");
  return data;
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
  start_spot_id?: string | null;
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

export async function detectLlmModels(payload: {
  apiKey: string;
  baseUrl: string;
  probe?: boolean;
  probeModels?: string[];
  maxProbe?: number;
}): Promise<DetectModelsResult> {
  const res = await fetch("/api/agent/detect-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: payload.apiKey.trim(),
      base_url: payload.baseUrl.trim(),
      probe: payload.probe ?? true,
      probe_models: payload.probeModels,
      max_probe: payload.maxProbe ?? 8,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "模型检测失败");
  return data as DetectModelsResult;
}

export async function testLlmConnection(llm: LlmConfig): Promise<LlmTestResult> {
  const res = await fetch("/api/agent/test-llm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: llm.apiKey.trim(),
      base_url: llm.baseUrl.trim(),
      model: llm.model.trim(),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "连通性测试失败");
  return data as LlmTestResult;
}

export async function fetchAgentSessions(): Promise<AgentSessionSummary[]> {
  const res = await fetch("/api/agent/sessions");
  if (!res.ok) throw new Error("获取会话历史失败");
  const data = await res.json();
  return data.items || [];
}

export async function fetchAgentSessionTurns(
  sessionId: string
): Promise<{ session_id: string; turns: Array<{ role: "user" | "assistant"; content: string; created_at: string }> }> {
  const res = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error("加载会话记录失败");
  return res.json();
}

export async function deleteAgentSession(sessionId: string): Promise<void> {
  const res = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除会话失败");
}

export interface AgentStreamCallbacks {
  onStatus: (msg: string, meta?: { session_id?: string; turn?: number }) => void;
  onToolEvent: (trace: AgentTraceItem) => void;
  onPlan: (plan: ItineraryPlan) => void;
  onCitations: (items: CitationItem[]) => void;
  onBookingDraft: (draft: BookingDraft) => void;
  onToken: (delta: string) => void;
  onDone: (metrics: AgentDoneMetrics) => void;
}

export async function streamAgentChat(
  query: string,
  cb: AgentStreamCallbacks,
  options?: { sessionId?: string | null; llm?: LlmConfig }
): Promise<void> {
  const llm = options?.llm;
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      session_id: options?.sessionId || undefined,
      llm_api_key: llm?.apiKey?.trim() || undefined,
      llm_base_url: llm?.baseUrl?.trim() || undefined,
      llm_model: llm?.model?.trim() || undefined,
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error("Agent 流式连接失败");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let traceSeq = 0;

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
          cb.onToolEvent({
            id: `tr-${traceSeq++}`,
            kind: "call",
            tool: payload.tool || "tool",
            label: `调用工具 ${payload.tool}`,
            detail: payload.args || {},
          });
          break;
        case "tool_result": {
          const tName = payload.tool || "result";
          const kind: AgentTraceItem["kind"] =
            tName === "agent_reflection"
              ? "reflection"
              : tName === "query_rewrite"
                ? "rewrite"
                : tName === "llm_guard"
                  ? "guard"
                  : "result";
          cb.onToolEvent({
            id: `tr-${traceSeq++}`,
            kind,
            tool: tName,
            label: typeof payload.summary === "string" ? payload.summary : JSON.stringify(payload.summary),
            latencyMs: typeof payload.latency_ms === "number" ? payload.latency_ms : undefined,
            detail: payload.detail ?? payload.summary,
          });
          break;
        }
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
          cb.onDone(payload as AgentDoneMetrics);
          break;
      }
    }
  }
}
