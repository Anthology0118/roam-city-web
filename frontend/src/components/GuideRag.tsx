import { useEffect, useState, type ReactNode } from "react";
import { fetchGuides, ingestGuide, searchGuidesRag } from "../api/client";
import type { GuideDoc, GuideSearchHit, RagMode } from "../types";

interface Props {
  initialGuideId?: string;
}

const MODE_LABELS: Array<{ id: RagMode; label: string }> = [
  { id: "hybrid", label: "Hybrid RRF (BM25 + 向量)" },
  { id: "bm25", label: "仅 BM25 词法" },
  { id: "vector", label: "仅 384d 向量" },
];

function highlightText(text: string, query: string): ReactNode {
  const terms = Array.from(
    new Set(
      query
        .trim()
        .split(/[\s,，、。]+/)
        .filter((t) => t.length >= 2)
    )
  );
  if (!terms.length) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, idx) =>
    regex.test(part) ? (
      <mark key={idx} style={{ background: "#fef08a", color: "#0f172a", padding: "0 2px", borderRadius: 3 }}>
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function GuideRag({ initialGuideId }: Props) {
  const [query, setQuery] = useState("茶卡盐湖 拍照 避坑 风速");
  const [mode, setMode] = useState<RagMode>("hybrid");
  const [hits, setHits] = useState<GuideSearchHit[]>([]);
  const [guides, setGuides] = useState<GuideDoc[]>([]);
  const [activeGuideId, setActiveGuideId] = useState<string>(initialGuideId || "");

  // Custom ingestion form state
  const [showIngest, setShowIngest] = useState(false);
  const [ingestTitle, setIngestTitle] = useState("");
  const [ingestCat, setIngestCat] = useState("自定义");
  const [ingestTags, setIngestTags] = useState("避坑, 交通");
  const [ingestContent, setIngestContent] = useState("");
  const [ingestMsg, setIngestMsg] = useState("");
  const [ingesting, setIngesting] = useState(false);

  async function loadAllGuides(selectId?: string) {
    const items = await fetchGuides();
    setGuides(items);
    if (selectId && items.some((g) => g.id === selectId)) {
      setActiveGuideId(selectId);
    } else if (initialGuideId && items.some((g) => g.id === initialGuideId)) {
      setActiveGuideId(initialGuideId);
    } else if (items[0]) {
      setActiveGuideId((prev) => prev || items[0].id);
    }
  }

  useEffect(() => {
    void loadAllGuides();
    void runSearch("茶卡盐湖 拍照 避坑 风速", "hybrid");
  }, []);

  useEffect(() => {
    if (initialGuideId) setActiveGuideId(initialGuideId);
  }, [initialGuideId]);

  async function runSearch(q: string, m: RagMode = mode) {
    if (!q.trim()) return;
    const res = await searchGuidesRag(q, m);
    setHits(res);
  }

  async function handleIngest(e: React.FormEvent) {
    e.preventDefault();
    if (!ingestTitle.trim() || !ingestContent.trim() || ingesting) return;
    setIngesting(true);
    setIngestMsg("");
    try {
      const tags = ingestTags
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await ingestGuide({
        title: ingestTitle.trim(),
        category: ingestCat.trim() || "自定义",
        content: ingestContent.trim(),
        tags,
      });
      setIngestMsg(`入库成功！已生成 ${res.chunks_created} 个 384d 向量切片 (${res.guide_id})`);
      setIngestTitle("");
      setIngestContent("");
      await loadAllGuides(res.guide_id);
      await runSearch(query, mode);
    } catch (err) {
      setIngestMsg(err instanceof Error ? err.message : "入库失败");
    } finally {
      setIngesting(false);
    }
  }

  const activeGuide = guides.find((g) => g.id === activeGuideId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="panel" style={{ padding: "14px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <strong>RAG 知识库与消融实验台</strong>
            <span style={{ marginLeft: 10, fontSize: "0.84rem", color: "var(--ink-soft)" }}>
              当前已索引 {guides.length} 篇攻略 · 支持切换检索模式对比 BM25 / Vector / RRF 排序差异
            </span>
          </div>
          <button type="button" className="btn btn-outline" style={{ padding: "5px 14px", fontSize: "0.84rem" }} onClick={() => setShowIngest((v) => !v)}>
            {showIngest ? "收起入库面板" : "+ 导入新攻略切片"}
          </button>
        </div>

        {showIngest && (
          <form onSubmit={handleIngest} style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <label style={{ fontSize: "0.84rem" }}>
                攻略标题
                <input required value={ingestTitle} onChange={(e) => setIngestTitle(e.target.value)} placeholder="如：川西小环线 4 日自驾避坑" />
              </label>
              <label style={{ fontSize: "0.84rem" }}>
                分类
                <input value={ingestCat} onChange={(e) => setIngestCat(e.target.value)} placeholder="自驾 / 亲子 / 穷游" />
              </label>
              <label style={{ fontSize: "0.84rem" }}>
                标签（逗号分隔）
                <input value={ingestTags} onChange={(e) => setIngestTags(e.target.value)} placeholder="高反, 氧气瓶, 路况" />
              </label>
            </div>
            <label style={{ fontSize: "0.84rem" }}>
              攻略正文（支持 `# 章节标题` + 空行分段，自动切片并生成 384 维向量入库）
              <textarea
                required
                rows={4}
                value={ingestContent}
                onChange={(e) => setIngestContent(e.target.value)}
                placeholder={"# 装备与高反\n折多山海拔超4200米，建议提前备好氧气瓶与冲锋衣。\n\n# 交通贴士\n新都桥旺季堵车严重，建议早7点出发。"}
                style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1px solid #d5cfc2", fontFamily: "inherit", fontSize: "0.9rem" }}
              />
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button type="submit" className="btn btn-primary" disabled={ingesting}>
                {ingesting ? "切片向量化中..." : "切片并写入 RAG 索引"}
              </button>
              {ingestMsg && <span style={{ fontSize: "0.85rem", color: "var(--teal-700)", fontWeight: 600 }}>{ingestMsg}</span>}
            </div>
          </form>
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 style={{ marginBottom: 10 }}>检索模式对比（BM25 / Vector / RRF）</h3>
          <div className="chips" style={{ marginBottom: 10 }}>
            {MODE_LABELS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`chip ${mode === m.id ? "active" : ""}`}
                onClick={() => {
                  setMode(m.id);
                  void runSearch(query, m.id);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch(query, mode);
            }}
            style={{ display: "flex", gap: 8, marginBottom: 14 }}
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="检索避坑细节、交通或装备建议..." />
            <button className="btn btn-primary" type="submit">
              检索
            </button>
          </form>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {hits.map((h) => (
              <div
                key={h.id}
                onClick={() => setActiveGuideId(h.guide_id)}
                style={{
                  cursor: "pointer",
                  border: "1px solid var(--line)",
                  borderRadius: 12,
                  padding: 12,
                  background: h.guide_id === activeGuideId ? "#f2fbfa" : "#fff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                  <strong>
                    {h.guide_title} · {h.section_title}
                  </strong>
                  <span className="badge">
                    {mode === "bm25" ? `BM25 ${h.bm25_score}` : mode === "vector" ? `Vec ${h.vector_score}` : `RRF ${h.rrf_score}`}
                  </span>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--ink-soft)", margin: "6px 0" }}>
                  {highlightText(h.content, query)}
                </p>
                <div style={{ fontSize: "0.78rem", color: "var(--teal-700)" }}>
                  BM25={h.bm25_score} · VectorCosine={h.vector_score} · RRF={h.rrf_score}（点击定位原文）
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h3 style={{ marginBottom: 10 }}>攻略原文阅读</h3>
          <div className="chips">
            {guides.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`chip ${g.id === activeGuideId ? "active" : ""}`}
                onClick={() => setActiveGuideId(g.id)}
              >
                {g.category} · {g.id.toUpperCase()}
              </button>
            ))}
          </div>
          {activeGuide && (
            <div>
              <h2 style={{ marginBottom: 12 }}>{activeGuide.title}</h2>
              {activeGuide.sections.map((sec) => (
                <div key={sec.chunk_id} style={{ marginBottom: 14 }}>
                  <h4 style={{ color: "var(--teal-900)", marginBottom: 4 }}>{sec.section_title}</h4>
                  <p style={{ fontSize: "0.92rem", color: "var(--ink-soft)" }}>{highlightText(sec.content, query)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
