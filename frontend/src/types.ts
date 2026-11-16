export interface Spot {
  id: string;
  name: string;
  en_name: string;
  city: string;
  category: string;
  rating: number;
  price: number;
  days_label: string;
  duration_hours: number;
  views: number;
  scene: string;
  description: string;
  tags: string[];
  lat: number;
  lng: number;
  daily_stock: number;
}

export interface PlanStop {
  spot_id: string;
  name: string;
  city: string;
  category: string;
  price: number;
  duration_hours: number;
  lat: number;
  lng: number;
  scene: string;
  distance_from_prev_km: number;
}

export interface ItineraryPlan {
  days_requested: number;
  budget: number | null;
  total_ticket_cost: number;
  greedy_distance_km: number;
  optimized_distance_km: number;
  distance_saved_km: number;
  days: {
    day: string;
    total_hours: number;
    stops: PlanStop[];
  }[];
}

export interface CitationItem {
  index: number;
  chunk_id: string;
  guide_id: string;
  guide_title: string;
  section_title: string;
  content: string;
  rrf_score: number;
}

export interface BookingDraft {
  spot_id: string;
  spot_name: string;
  unit_price: number;
  suggested_count: number;
  reason: string;
}

export interface BookingOrder {
  id: string;
  spot_id: string;
  spot_name: string;
  visit_date: string;
  session_slot: string;
  ticket_type: "成人票" | "学生票";
  count: number;
  visitor_name: string;
  phone: string;
  id_card_masked?: string;
  email?: string;
  total_price: number;
  status: "CONFIRMED" | "CANCELLED";
  created_at?: string;
  remaining_stock?: number;
}

export type RagMode = "hybrid" | "bm25" | "vector";

export interface GuideSearchHit {
  id: string;
  guide_id: string;
  guide_title: string;
  category: string;
  section_title: string;
  content: string;
  bm25_score: number;
  vector_score: number;
  rrf_score: number;
}

export interface GuideDoc {
  id: string;
  title: string;
  category: string;
  sections: {
    chunk_id: string;
    section_title: string;
    content: string;
  }[];
}

export interface AgentSessionSummary {
  session_id: string;
  turns: number;
  title: string;
  updated_at: string;
}

export interface AgentTraceItem {
  id: string;
  kind: "call" | "result" | "reflection" | "rewrite" | "guard";
  tool: string;
  label: string;
  latencyMs?: number;
  detail?: unknown;
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LlmTestResult {
  ok: boolean;
  latency_ms: number;
  model: string;
  reply_preview?: string;
  available_models?: string[];
  error?: string;
}

export interface ModelProbeItem {
  model: string;
  usable: boolean;
  latency_ms: number;
  error?: string | null;
}

export interface DetectModelsResult {
  ok: boolean;
  total_models?: number;
  models: string[];
  probed: ModelProbeItem[];
  usable_models: string[];
  error?: string | null;
}

export interface AgentDoneMetrics {
  session_id?: string;
  ttft_ms: number;
  total_ms: number;
  mode: string;
  model?: string;
  fallback_reason?: string | null;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}
