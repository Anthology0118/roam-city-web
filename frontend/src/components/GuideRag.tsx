import { useEffect, useState } from "react";
import { fetchGuides, searchGuidesRag } from "../api/client";
import type { GuideDoc, GuideSearchHit } from "../types";

interface Props {
  initialGuideId?: string;
}

export function GuideRag({ initialGuideId }: Props) {
  const [query, setQuery] = useState("茶卡盐湖 拍照 避坑 风速");
  const [hits, setHits] = useState<GuideSearchHit[]>([]);
  const [guides, setGuides] = useState<GuideDoc[]>([]);
  const [activeGuideId, setActiveGuideId] = useState<string>(initialGuideId || "");

  useEffect(() => {
    fetchGuides().then((items) => {
      setGuides(items);
      if (initialGuideId && items.some((g) => g.id === initialGuideId)) {
        setActiveGuideId(initialGuideId);
      } else if (items[0]) {
        setActiveGuideId((prev) => prev || items[0].id);
      }
    });
    void runSearch("茶卡盐湖 拍照 避坑 风速");
  }, []);

  useEffect(() => {
    if (initialGuideId) setActiveGuideId(initialGuideId);
  }, [initialGuideId]);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    const res = await searchGuidesRag(q);
    setHits(res);
  }

  const activeGuide = guides.find((g) => g.id === activeGuideId);

  return (
    <div className="grid-2">
      <div className="panel">
        <h3 style={{ marginBottom: 10 }}>Hybrid RAG 攻略片段检索引擎（BM25 + Vector RRF）</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch(query);
          }}
          style={{ display: "flex", gap: 8, marginBottom: 14 }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="检索避坑细节或装备建议..." />
          <button className="btn btn-primary" type="submit">
            混合检索
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
                <span className="badge">RRF {h.rrf_score}</span>
              </div>
              <p style={{ fontSize: "0.88rem", color: "var(--ink-soft)", margin: "6px 0" }}>{h.content}</p>
              <div style={{ fontSize: "0.78rem", color: "var(--teal-700)" }}>
                BM25={h.bm25_score} · VectorCosine={h.vector_score}（点击定位原文）
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
                <p style={{ fontSize: "0.92rem", color: "var(--ink-soft)" }}>{sec.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
