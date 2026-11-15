import { useState } from "react";
import { streamAgentChat } from "../api/client";
import type { BookingDraft, CitationItem, ItineraryPlan } from "../types";
import { ChinaRouteMap } from "./ChinaRouteMap";

interface Props {
  onApplyBookingDraft: (draft: BookingDraft) => void;
}

interface ChatMsg {
  role: "user" | "assistant";
  text: string;
}

const PRESETS = [
  "周末2天预算300看自然山水，不想太累",
  "预算500去北京故宫和西安古城墙玩3天，顺便预约门票",
  "带娃去三亚3天怎么玩不累，顺便查查攻略避坑",
];

const FOLLOW_UPS = ["改为5天", "预算放宽到800", "顺便帮我预约门票"];

export function AgentPlanner({ onApplyBookingDraft }: Props) {
  const [query, setQuery] = useState(PRESETS[0]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0);
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [traces, setTraces] = useState<string[]>([]);
  const [plan, setPlan] = useState<ItineraryPlan | null>(null);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null);
  const [answer, setAnswer] = useState("");
  const [metrics, setMetrics] = useState<{ session_id?: string; ttft_ms: number; total_ms: number; mode: string } | null>(null);
  const [error, setError] = useState("");

  function resetSession() {
    if (loading) return;
    setSessionId(null);
    setTurnCount(0);
    setHistory([]);
    setStatusMsg("");
    setTraces([]);
    setPlan(null);
    setCitations([]);
    setBookingDraft(null);
    setAnswer("");
    setMetrics(null);
    setError("");
  }

  async function runAgent(inputQuery: string) {
    if (!inputQuery.trim() || loading) return;
    const trimmed = inputQuery.trim();
    setLoading(true);
    setError("");
    setStatusMsg("初始化 Agent 会话...");
    setTraces([]);
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
          onToolEvent: (label) => setTraces((prev) => [...prev, label]),
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
          },
        },
        sessionId
      );
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="hero-banner">
        <h1>AI 智能行程规划与工具编排工作台</h1>
        <p>
          Intent 解析 → 数据库真景点召回 → Hybrid RAG（BM25 + Vector RRF）→ 2-opt TSP 算法排线 → Human-in-the-Loop 一键预填单
        </p>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="badge">
              {sessionId ? `多轮会话 #${sessionId.slice(0, 8)} · 第 ${turnCount} 轮` : "新会话（支持多轮追问继承意图）"}
            </span>
          </div>
          {sessionId && (
            <button className="btn btn-outline" type="button" onClick={resetSession} disabled={loading}>
              新建对话
            </button>
          )}
        </div>

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
                ? "继续追问（如：改为5天 / 预算追加到800 / 顺便帮我预约门票）..."
                : "输入你的天数、预算、同行人群或想预约的景点..."
            }
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? "规划中..." : sessionId ? "继续对话" : "生成 AI 行程"}
          </button>
        </form>
        {history.length > 0 && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto" }}>
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
                {m.text.length > 140 ? `${m.text.slice(0, 140)}...` : m.text}
              </div>
            ))}
          </div>
        )}
        {statusMsg && (
          <div style={{ marginTop: 10, fontSize: "0.86rem", color: "var(--teal-700)" }}>
            状态：{statusMsg}
            {metrics && (
              <span style={{ marginLeft: 12, color: "var(--ink-soft)" }}>
                TTFT {metrics.ttft_ms}ms · 总耗时 {metrics.total_ms}ms · 模式：{metrics.mode}
              </span>
            )}
          </div>
        )}
        {error && <div style={{ marginTop: 8, color: "#c8321e" }}>{error}</div>}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginBottom: 10 }}>Agent 执行链路 & 流式解读</h3>
          {traces.length > 0 && (
            <div className="trace-list">
              {traces.map((t, i) => (
                <div className="trace-item" key={i}>
                  {t}
                </div>
              ))}
            </div>
          )}
          <div style={{ whiteSpace: "pre-wrap", fontSize: "0.95rem", minHeight: 120 }}>
            {answer || "点击上方「生成 AI 行程」，观察多阶段 SSE 事件流与溯源解读。"}
          </div>

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
                    <div>
                      <span className="badge">[{c.index}] {c.guide_title}</span>{" "}
                      <strong>{c.section_title}</strong>{" "}
                      <span style={{ color: "var(--ink-soft)" }}>RRF={c.rrf_score}</span>
                    </div>
                    <p style={{ marginTop: 4, color: "var(--ink-soft)" }}>{c.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <h3 style={{ marginBottom: 10 }}>确定性 2-opt 排线结果</h3>
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
              提交需求后，这里会展示算法求解后的每日路线与跨站距离。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
