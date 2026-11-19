import { useEffect, useState } from "react";
import { fetchFavorites, fetchSpots, toggleFavorite } from "../api/client";
import type { Spot } from "../types";

interface Props {
  onBookSpot: (spotId: string) => void;
  onLocateSpot?: (spotId: string) => void;
}

type SortBy = "default" | "rating" | "price_asc" | "views";

const CATS = ["全部", "自然山水", "人文历史", "古城古镇", "海岛海滨"];

export function ScenicExplorer({ onBookSpot, onLocateSpot }: Props) {
  const [cat, setCat] = useState("全部");
  const [kw, setKw] = useState("");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);
  const [onlyFavs, setOnlyFavs] = useState(false);
  const [onlyFree, setOnlyFree] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("default");
  const [selected, setSelected] = useState<Spot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchFavorites().then(setFavIds).catch(() => {});
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(true);
      fetchSpots(cat, kw)
        .then(setSpots)
        .finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [cat, kw]);

  async function handleToggleFav(spotId: string) {
    try {
      const res = await toggleFavorite(spotId);
      setFavIds(res.spot_ids);
    } catch {
      // ignore transient error
    }
  }

  const visibleSpots = spots
    .filter((s) => (!onlyFavs || favIds.includes(s.id)) && (!onlyFree || s.price === 0))
    .slice()
    .sort((a, b) => {
      if (sortBy === "rating") return b.rating - a.rating;
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "views") return b.views - a.views;
      return 0;
    });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="hero-banner">
        <h1>中国 {spots.length || 126} 大精选实景地标与心愿单检索</h1>
        <p>
          全站接入 {spots.length || 126} 处全国 34 省市高清实景摄影，支持多维分类、关键词防抖检索、免费景区过滤、心愿单云端同步与一键定位 Three.js 3D 中国沙盘。
        </p>
      </div>

      <div className="panel">
        <div className="chips" style={{ alignItems: "center" }}>
          {CATS.map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${cat === c ? "active" : ""}`}
              onClick={() => setCat(c)}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            className={`chip ${onlyFree ? "active" : ""}`}
            onClick={() => setOnlyFree((v) => !v)}
          >
            ✨ 免费景区
          </button>
          <button
            type="button"
            className={`chip ${onlyFavs ? "active" : ""}`}
            onClick={() => setOnlyFavs((v) => !v)}
          >
            ♥ 心愿单 ({favIds.length})
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="🔍 防抖搜索：输入城市、景点名或特色标签（如 丽江 / 亲子 / 故宫 / 雪山）"
          />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)} style={{ width: 165 }}>
            <option value="default">默认推荐排序</option>
            <option value="rating">⭐ 评分从高到低</option>
            <option value="price_asc">💰 票价从低到高</option>
            <option value="views">🔥 热度人气优先</option>
          </select>
        </div>
      </div>

      {loading && <p style={{ color: "var(--ink-soft)" }}>正在从后端检索景点...</p>}

      <div className="card-grid">
        {visibleSpots.map((s) => {
          const liked = favIds.includes(s.id);
          return (
            <article className="spot-card" key={s.id}>
              <div className="spot-media" onClick={() => setSelected(s)}>
                <img src={`/scenes/${s.scene}`} alt={s.name} loading="lazy" />
                <div className="spot-media-overlay" />
                <div className="spot-media-top">
                  <span className="spot-glass-badge">{s.category}</span>
                  <span className="spot-price-pill">
                    {s.price === 0 ? "免费入园" : `¥${s.price} 起`}
                  </span>
                </div>
                <div className="spot-media-bottom">
                  <span>📍 {s.city}</span>
                  <span>⭐ {s.rating.toFixed(1)} · ⏱️ {s.duration_hours}h</span>
                </div>
              </div>
              <div className="spot-card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <h3 style={{ fontSize: "1.12rem", cursor: "pointer" }} onClick={() => setSelected(s)}>
                    {s.name}
                  </h3>
                  <small style={{ color: "var(--ink-soft)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                    余票 {s.daily_stock} 张
                  </small>
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--ink-soft)", flex: 1, lineHeight: 1.58 }}>
                  {s.description}
                </p>
                {s.tags && s.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                    {s.tags.map((tag) => (
                      <span key={tag} className="spot-tag">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button
                    className="btn btn-outline"
                    type="button"
                    aria-label={liked ? "取消收藏" : "加入心愿单"}
                    onClick={() => void handleToggleFav(s.id)}
                    style={{
                      padding: "7px 12px",
                      fontSize: "0.84rem",
                      color: liked ? "#e11d48" : undefined,
                      borderColor: liked ? "#fda4af" : undefined,
                      background: liked ? "#fff1f2" : undefined,
                    }}
                  >
                    {liked ? "♥ 已收藏" : "♡ 收藏"}
                  </button>
                  <button
                    className="btn btn-outline"
                    type="button"
                    style={{ padding: "7px 12px", fontSize: "0.84rem" }}
                    onClick={() => setSelected(s)}
                  >
                    实景详情
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    style={{ padding: "7px 14px", fontSize: "0.84rem", marginLeft: "auto" }}
                    onClick={() => onBookSpot(s.id)}
                  >
                    预约门票
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ position: "relative" }}>
              <img
                src={`/scenes/${selected.scene}`}
                alt={selected.name}
                style={{ width: "100%", height: 280, objectFit: "cover", display: "block" }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(to top, rgba(8,22,30,0.82) 0%, transparent 55%)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 16,
                  left: 20,
                  right: 20,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-end",
                  color: "#fff",
                }}
              >
                <div>
                  <span className="spot-glass-badge" style={{ marginBottom: 6, display: "inline-block" }}>
                    {selected.category} · {selected.en_name}
                  </span>
                  <h2 style={{ fontSize: "1.5rem", textShadow: "0 2px 10px rgba(0,0,0,0.5)" }}>{selected.name}</h2>
                </div>
                <span className="spot-price-pill" style={{ fontSize: "1rem", padding: "5px 14px" }}>
                  {selected.price === 0 ? "免费开放" : `¥${selected.price}`}
                </span>
              </div>
            </div>
            <div style={{ padding: 22 }}>
              <p style={{ margin: "0 0 14px", color: "var(--ink)", fontSize: "0.95rem", lineHeight: 1.7 }}>
                {selected.description}
              </p>
              {selected.tags && selected.tags.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
                  {selected.tags.map((t) => (
                    <span key={t} className="badge">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
              <div
                style={{
                  fontSize: "0.88rem",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  background: "#f8fafc",
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                }}
              >
                <div>📍 所在城市：<b>{selected.city}</b></div>
                <div>⏱️ 建议游玩：<b>{selected.duration_hours} 小时 ({selected.days_label})</b></div>
                <div>🧭 地理坐标：<b>{selected.lat.toFixed(4)}°N, {selected.lng.toFixed(4)}°E</b></div>
                <div>🎫 实时余票：<b>{selected.daily_stock} 张</b>（⭐ {selected.rating} 分）</div>
              </div>
              <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => void handleToggleFav(selected.id)}
                >
                  {favIds.includes(selected.id) ? "♥ 移出心愿单" : "♡ 加入心愿单"}
                </button>
                {onLocateSpot && (
                  <button
                    className="btn btn-outline"
                    type="button"
                    onClick={() => {
                      onLocateSpot(selected.id);
                      setSelected(null);
                    }}
                  >
                    🧭 在 3D 沙盘定位 →
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    onBookSpot(selected.id);
                    setSelected(null);
                  }}
                >
                  立即预约门票 →
                </button>
                <button className="btn btn-outline" type="button" onClick={() => setSelected(null)}>
                  关闭 (Esc)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
