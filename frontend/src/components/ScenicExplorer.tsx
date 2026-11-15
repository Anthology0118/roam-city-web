import { useEffect, useState } from "react";
import { fetchFavorites, fetchSpots, toggleFavorite } from "../api/client";
import type { Spot } from "../types";

interface Props {
  onBookSpot: (spotId: string) => void;
}

const CATS = ["全部", "自然山水", "人文历史", "古城古镇", "海岛海滨"];

export function ScenicExplorer({ onBookSpot }: Props) {
  const [cat, setCat] = useState("全部");
  const [kw, setKw] = useState("");
  const [spots, setSpots] = useState<Spot[]>([]);
  const [favIds, setFavIds] = useState<string[]>([]);
  const [onlyFavs, setOnlyFavs] = useState(false);
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

  const visibleSpots = onlyFavs ? spots.filter((s) => favIds.includes(s.id)) : spots;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div>
      <div className="panel" style={{ marginBottom: 20 }}>
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
            className={`chip ${onlyFavs ? "active" : ""}`}
            onClick={() => setOnlyFavs((v) => !v)}
          >
            ♥ 心愿单 ({favIds.length})
          </button>
        </div>
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="防抖搜索：输入城市、景点名或标签（如 丽江 / 亲子 / 故宫）"
        />
      </div>

      {loading && <p style={{ marginBottom: 12, color: "var(--ink-soft)" }}>正在从后端检索景点...</p>}

      <div className="card-grid">
        {visibleSpots.map((s) => {
          const liked = favIds.includes(s.id);
          return (
            <article className="spot-card" key={s.id}>
              <img src={`/scenes/${s.scene}`} alt={s.name} loading="lazy" />
              <div className="spot-card-body">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="badge">{s.category}</span>
                  <span style={{ fontWeight: 700, color: "var(--orange-600)" }}>
                    {s.price === 0 ? "免费" : `¥${s.price} 起`}
                  </span>
                </div>
                <h3>{s.name}</h3>
                <div style={{ fontSize: "0.84rem", color: "var(--ink-soft)" }}>
                  📍 {s.city} · ⭐ {s.rating} · 余票 {s.daily_stock} 张
                </div>
                <p style={{ fontSize: "0.88rem", color: "var(--ink-soft)", flex: 1 }}>{s.description}</p>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className="btn btn-outline"
                    type="button"
                    aria-label={liked ? "取消收藏" : "加入心愿单"}
                    onClick={() => void handleToggleFav(s.id)}
                    style={{ color: liked ? "#d63b2f" : undefined, borderColor: liked ? "#d63b2f" : undefined }}
                  >
                    {liked ? "♥ 已收藏" : "♡ 收藏"}
                  </button>
                  <button className="btn btn-outline" type="button" onClick={() => setSelected(s)}>
                    详情
                  </button>
                  <button className="btn btn-primary" type="button" onClick={() => onBookSpot(s.id)}>
                    预约
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <img
              src={`/scenes/${selected.scene}`}
              alt={selected.name}
              style={{ width: "100%", height: 210, objectFit: "cover" }}
            />
            <div style={{ padding: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>{selected.name}</h2>
                <button className="btn btn-outline" type="button" onClick={() => setSelected(null)}>
                  关闭 (Esc)
                </button>
              </div>
              <p style={{ margin: "10px 0", color: "var(--ink-soft)" }}>{selected.description}</p>
              <div style={{ fontSize: "0.88rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>城市：{selected.city}</div>
                <div>建议时长：{selected.duration_hours} 小时</div>
                <div>
                  经纬度：{selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                </div>
                <div>实时余票：{selected.daily_stock} 张</div>
              </div>
              <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                <button
                  className="btn btn-outline"
                  type="button"
                  onClick={() => void handleToggleFav(selected.id)}
                >
                  {favIds.includes(selected.id) ? "♥ 移出心愿单" : "♡ 加入心愿单"}
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => {
                    onBookSpot(selected.id);
                    setSelected(null);
                  }}
                >
                  立即预约该景区门票 →
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
