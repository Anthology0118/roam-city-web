import { useEffect, useState } from "react";
import {
  deleteAgentSession,
  fetchAgentSessions,
  fetchAgentSessionTurns,
  streamAgentChat,
} from "../api/client";
import type {
  AgentDoneMetrics,
  AgentSessionSummary,
  AgentTraceItem,
  BookingDraft,
  CitationItem,
  ItineraryPlan,
  LlmConfig,
} from "../types";
import { ChinaRouteMap } from "./ChinaRouteMap";
import { MarkdownView } from "./MarkdownView";

interface Props {
  onApplyBookingDraft: (draft: BookingDraft) => void;
  onOpenGuide: (guideId: string) => void;
  onTransferToMap: (spotIds: string[], days: number, budget: number | null) => void;
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

const PRESETS = [
  "周末2天预算300看自然山水，不想太累",
  "从西安出发玩3天，不要去西北和西藏，顺便预约2张门票",
  "只看免费景点，带娃去三亚或江南玩3天，顺便查避坑攻略",
];

const FOLLOW_UPS = ["改为5天", "预算放宽到800", "那边的避坑攻略怎么说", "顺便帮我预约门票"];

const LLM_STORAGE_KEY = "roamcity_llm_config";

function loadInitialLlmConfig(): LlmConfig {
  try {
    const raw = sessionStorage.getItem(LLM_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore storage access issues
  }
  return { apiKey: "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" };
}

const TRACE_BADGES: Record<AgentTraceItem["kind"], { icon: string; tag: string; border: string }> = {
  call: { icon: "🔧", tag: "Tool Call", border: "#0ea5e9" },
  result: { icon: "📦", tag: "Tool Output", border: "#17a2a8" },
  rewrite: { icon: "✍️", tag: "Query Rewrite", border: "#8b5cf6" },
  reflection: { icon: "🛡️", tag: "Guardrail", border: "#10b981" },
  guard: { icon: "⚠️", tag: "Fallback Guard", border: "#f59e0b" },
};

export function AgentPlanner({ onApplyBookingDraft, onOpenGuide, onTransferToMap }: Props) {
  const [query, setQuery] = useState(PRESETS[0]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [traces, setTraces] = useState<AgentTraceItem[]>([]);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [plan, setPlan] = useState<ItineraryPlan | null>(null);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null);
  const [answer, setAnswer] = useState("");
  const [metrics, setMetrics] = useState<AgentDoneMetrics | null>(null);
  const [error, setError] = useState("");
  const [showLlmConfig, setShowLlmConfig] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(loadInitialLlmConfig);

  function reloadSessions() {
    fetchAgentSessions().then(setSessions).catch(() => {});
  }

  useEffect(() => {
    reloadSessions();
  }, []);

  function updateLlmConfig(next: LlmConfig) {
    setLlmConfig(next);
    try {
      sessionStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }

  function resetSession() {
    if (loading) return;
    setSessionId(null);
    setTurnCount(0);
    setHistory([]);
    setStatusMsg("");
    setTraces([]);
    setExpandedTraceId(null);
    setPlan(null);
    setCitations([]);
    setBookingDraft(null);
    setAnswer("");
    setMetrics(null);
    setError("");
  }

  async function loadSavedSession(sid: string) {
    if (loading) return;
    setError("");
    try {
      const data = await fetchAgentSessionTurns(sid);
      const msgs: ChatMsg[] = data.turns.map((t) => ({ role: t.role, text: t.content }));
      setSessionId(sid);
      setHistory(msgs);
      setTurnCount(Math.ceil(msgs.length / 2));
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      setAnswer(lastAssistant?.text || "");
      setTraces([]);
      setStatusMsg(`已恢复历史会话 #${sid.slice(0, 8)}，可继续追问`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载历史会话失败");
    }
  }

  async function handleDeleteSession(sid: string) {
    try {
      await deleteAgentSession(sid);
      if (sessionId === sid) resetSession();
      reloadSessions();
    } catch {
      // ignore transient error
    }
  }

  async function runAgent(inputQuery: string) {
    if (!inputQuery.trim() || loading) return;
    const trimmed = inputQuery.trim();
    setLoading(true);
    setError("");
    setStatusMsg("初始化 Agent 会话...");
    setTraces([]);
    setExpandedTraceId(null);
    setBookingDraft(null);
    setAnswer("");
    setMetrics(null);
    setHistory((prev) => [...prev, { role: "user", text: trimmed }]);

    let fullAnswer = "";
    try {
      await streamAgentChat(
        trimmed,
        {
          onStatus: (msg, meta) => {
            setStatusMsg(msg);
            if (meta?.session_id) setSessionId(meta.session_id);
            if (meta?.turn) setTurnCount(meta.turn);
          },
          onToolEvent: (trace) => setTraces((prev) => [...prev, trace]),
          onPlan: (p) => setPlan(p),
          onCitations: (items) => setCitations(items),
          onBookingDraft: (draft) => setBookingDraft(draft),
          onToken: (delta) => {
            fullAnswer += delta;
            setAnswer((prev) => prev + delta);
          },
          onDone: (m) => {
            if (m.session_id) setSessionId(m.session_id);
            setMetrics(m);
            setStatusMsg("规划完成");
            if (fullAnswer.trim()) {
              setHistory((prev) => [...prev, { role: "assistant", text: fullAnswer.trim() }]);
            }
            reloadSessions();
          },
        },
        { sessionId, llm: llmConfig.apiKey.trim() ? llmConfig : undefined }
      );
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  function exportMarkdownPlan() {
    if (!answer && !plan) return;
    const citeBlock = citations.length
      ? "\n\n## 参考攻略溯源\n" +
        citations.map((c) => `- [${c.index}] **${c.guide_title} · ${c.section_title}**：${c.content}`).join("\n")
      : "";
    const mdContent = `${answer || ""}${citeBlock}\n`;
    const blob = new Blob([mdContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roamcity-plan-${sessionId || "draft"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="hero-banner">
        <h1>AI 智能行程规划与 ReAct 工具编排工作台</h1>
        <p>
          多轮记忆与 Query 改写 → 6 工具 Function Calling（景点 / RAG / 2-opt 排线 / 预约核验 / 心愿单 / 订单）→ Guardrail 自检 → 真流式 SSE 输出
        </p>
      </div>

      <div className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="badge">
              {sessionId ? `多轮会话 #${sessionId.slice(0, 8)} · 第 ${turnCount} 轮` : "新会话（支持否定过滤 / 出发地锁定 / 多轮追问）"}
            </span>
            {llmConfig.apiKey.trim() && (
              <span className="badge orange">已启用外部 LLM ({llmConfig.model})</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn-outline"
              type="button"
              style={{ padding: "5px 12px", fontSize: "0.82rem" }}
              onClick={() => setShowLlmConfig((v) => !v)}
            >
              ⚙️ {showLlmConfig ? "收起模型配置" : "接入大模型 API"}
            </button>
            {sessionId && (
              <button
                className="btn btn-outline"
                type="button"
                style={{ padding: "5px 12px", fontSize: "0.82rem" }}
                onClick={resetSession}
                disabled={loading}
              >
                + 新建对话
              </button>
            )}
          </div>
        </div>

        {/* Optional Runtime LLM Configuration Drawer */}
        {showLlmConfig && (
          <div
            style={{
              background: "#faf8f2",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 0.8fr auto",
              gap: 10,
              alignItems: "end",
            }}
          >
            <label style={{ fontSize: "0.82rem" }}>
              OpenAI 兼容 API Key（仅存当前浏览器会话，留空则用零门槛兜底引擎）
              <input
                type="password"
                value={llmConfig.apiKey}
                onChange={(e) => updateLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                placeholder="sk-..."
              />
            </label>
            <label style={{ fontSize: "0.82rem" }}>
              Base URL
              <input
                value={llmConfig.baseUrl}
                onChange={(e) => updateLlmConfig({ ...llmConfig, baseUrl: e.target.value })}
                placeholder="https://api.deepseek.com/v1"
              />
            </label>
            <label style={{ fontSize: "0.82rem" }}>
              Model
              <input
                value={llmConfig.model}
                onChange={(e) => updateLlmConfig({ ...llmConfig, model: e.target.value })}
                placeholder="deepseek-chat"
              />
            </label>
            <button
              type="button"
              className="chip"
              onClick={() => updateLlmConfig({ apiKey: "", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" })}
            >
              清空 Key
            </button>
          </div>
        )}

        {/* Saved Sessions Switcher */}
        {sessions.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            <span style={{ fontSize: "0.78rem", color: "var(--ink-soft)" }}>历史会话：</span>
            {sessions.slice(0, 5).map((s) => (
              <span
                key={s.session_id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: "0.76rem",
                  border: "1px solid var(--line)",
                  background: sessionId === s.session_id ? "var(--teal-100)" : "#fff",
                }}
              >
                <button
                  type="button"
                  onClick={() => void loadSavedSession(s.session_id)}
                  style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--teal-900)" }}
                >
                  {s.title} ({Math.ceil(s.turns / 2)}轮)
                </button>
                <button
                  type="button"
                  aria-label="删除会话"
                  onClick={() => void handleDeleteSession(s.session_id)}
                  style={{ border: 0, background: "transparent", cursor: "pointer", color: "#94a3b8" }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="chips">
          {(sessionId ? FOLLOW_UPS : PRESETS).map((p) => (
            <button key={p} className="chip" type="button" onClick={() => setQuery(p)}>
              {p}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runAgent(query);
          }}
          style={{ display: "flex", gap: 10 }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              sessionId
                ? "继续追问（如：改为5天 / 不要去西北 / 预算放宽到800 / 顺便预约门票）..."
                : "输入天数、预算、出发城市、不想去的地区、节奏或购票意图..."
            }
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "规划中..." : sessionId ? "继续对话" : "生成 AI 行程"}
          </button>
        </form>

        {history.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 150, overflowY: "auto" }}>
            {history.map((m, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: "0.84rem",
                  padding: "6px 10px",
                  borderRadius: 8,
                  background: m.role === "user" ? "#f4f1e8" : "#eef6f5",
                  color: "var(--ink)",
                }}
              >
                <strong>{m.role === "user" ? "你：" : "Agent："}</strong>
                {m.text.replace(/[#>*`]/g, "").length > 140
                  ? `${m.text.replace(/[#>*`]/g, "").slice(0, 140)}...`
                  : m.text.replace(/[#>*`]/g, "")}
              </div>
            ))}
          </div>
        )}

        {statusMsg && (
          <div style={{ marginTop: 10, fontSize: "0.85rem", color: "var(--teal-700)" }}>
            状态：{statusMsg}
            {metrics && (
              <span style={{ marginLeft: 12, color: "var(--ink-soft)" }}>
                TTFT {metrics.ttft_ms}ms · 总耗时 {metrics.total_ms}ms · 模式：{metrics.mode}
                {metrics.model ? ` (${metrics.model})` : ""}
                {metrics.usage?.total_tokens ? ` · Tokens ${metrics.usage.total_tokens}` : ""}
              </span>
            )}
          </div>
        )}
        {metrics?.fallback_reason && (
          <div style={{ marginTop: 4, fontSize: "0.8rem", color: "#b45309" }}>
            兜底降级原因：{metrics.fallback_reason}
          </div>
        )}
        {error && <div style={{ marginTop: 8, color: "#c8321e" }}>{error}</div>}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <h3>Agent 执行链路 & 流式解读</h3>
            {answer && (
              <button
                type="button"
                className="chip"
                style={{ padding: "3px 10px", fontSize: "0.78rem" }}
                onClick={exportMarkdownPlan}
              >
                导出 Markdown 行程单
              </button>
            )}
          </div>

          {traces.length > 0 && (
            <div className="trace-list">
              {traces.map((t) => {
                const meta = TRACE_BADGES[t.kind];
                const isOpen = expandedTraceId === t.id;
                return (
                  <div
                    className="trace-item"
                    key={t.id}
                    style={{ borderLeftColor: meta.border, cursor: t.detail ? "pointer" : "default" }}
                    onClick={() => t.detail && setExpandedTraceId(isOpen ? null : t.id)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <span>
                        {meta.icon} <strong>[{meta.tag}]</strong> {t.label}
                      </span>
                      <span style={{ fontSize: "0.75rem", color: "var(--ink-soft)" }}>
                        {t.latencyMs !== undefined ? `${t.latencyMs}ms · ` : ""}
                        {t.detail ? (isOpen ? "收起详情" : "查看 JSON") : ""}
                      </span>
                    </div>
                    {isOpen && t.detail !== undefined && (
                      <pre
                        style={{
                          marginTop: 6,
                          padding: 8,
                          borderRadius: 6,
                          background: "#0f172a",
                          color: "#e2e8f0",
                          fontSize: "0.75rem",
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(t.detail, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <MarkdownView
            content={answer}
            placeholder="点击上方「生成 AI 行程」，观察多阶段 SSE 事件流、Guardrail 自检与溯源解读。"
            onCiteClick={(num) => {
              const hit = citations.find((c) => c.index === num);
              if (hit) onOpenGuide(hit.guide_id);
            }}
          />

          {citations.length > 0 && (
            <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
              <h4 style={{ marginBottom: 8 }}>RAG 攻略溯源引用（RRF 融合排序）</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {citations.map((c) => (
                  <div
                    key={c.chunk_id}
                    style={{
                      background: "#faf8f2",
                      border: "1px solid var(--line)",
                      borderRadius: 10,
                      padding: 10,
                      fontSize: "0.85rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div>
                        <span className="badge">[{c.index}] {c.guide_title}</span>{" "}
                        <strong>{c.section_title}</strong>{" "}
                        <span style={{ color: "var(--ink-soft)" }}>RRF={c.rrf_score}</span>
                      </div>
                      <button
                        type="button"
                        className="chip"
                        style={{ padding: "2px 8px", fontSize: "0.75rem" }}
                        onClick={() => onOpenGuide(c.guide_id)}
                      >
                        查看全文 →
                      </button>
                    </div>
                    <p style={{ marginTop: 4, color: "var(--ink-soft)" }}>{c.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <h3>确定性 2-opt 排线结果</h3>
            {plan && (
              <button
                type="button"
                className="chip"
                style={{ padding: "4px 10px", fontSize: "0.78rem" }}
                onClick={() => {
                  const ids = plan.days.flatMap((d) => d.stops.map((s) => s.spot_id));
                  onTransferToMap(ids, plan.days_requested, plan.budget);
                }}
              >
                带入 3D 沙盘微调 →
              </button>
            )}
          </div>

          {plan ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">总门票 ¥{plan.total_ticket_cost}</span>
                <span className="badge">优化里程 {plan.optimized_distance_km} km</span>
                {plan.distance_saved_km > 0 && (
                  <span className="badge orange">2-opt 省路 {plan.distance_saved_km} km</span>
                )}
              </div>

              <ChinaRouteMap plan={plan} height={310} />

              {plan.days.map((d) => (
                <div
                  key={d.day}
                  style={{
                    border: "1px solid var(--line)",
                    borderRadius: 12,
                    padding: 12,
                    background: "#fffdf9",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>
                    {d.day} · 预计游玩 {d.total_hours} 小时
                  </div>
                  {d.stops.map((st) => (
                    <div
                      key={st.spot_id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        borderTop: "1px dashed #ece6d8",
                        fontSize: "0.9rem",
                      }}
                    >
                      <span>
                        {st.name} <small style={{ color: "var(--ink-soft)" }}>({st.city})</small>
                      </span>
                      <span>
                        ¥{st.price} · {st.duration_hours}h
                        {st.distance_from_prev_km > 0 && (
                          <small style={{ color: "var(--teal-700)", marginLeft: 6 }}>
                            +{st.distance_from_prev_km}km
                          </small>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              ))}

              {bookingDraft && (
                <div
                  style={{
                    background: "#fff4eb",
                    border: "1px solid #f7be99",
                    borderRadius: 12,
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#b6400a" }}>Human-in-the-Loop 预填预约单</div>
                  <p style={{ fontSize: "0.86rem", margin: "4px 0 10px" }}>{bookingDraft.reason}</p>
                  <div style={{ fontSize: "0.9rem", marginBottom: 10 }}>
                    景区：<b>{bookingDraft.spot_name}</b> · 单价 ¥{bookingDraft.unit_price} · 建议{" "}
                    <b>{bookingDraft.suggested_count}</b> 张
                  </div>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => onApplyBookingDraft(bookingDraft)}
                  >
                    确认并前往门票预约页提交 →
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p style={{ color: "var(--ink-soft)", fontSize: "0.92rem" }}>
              提交需求后，这里会展示算法求解后的每日路线、3D 地形航线与跨站距离。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
