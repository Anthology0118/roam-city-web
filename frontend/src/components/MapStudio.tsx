import { useEffect, useState } from "react";
import { fetchFavorites, fetchSpots, optimizeRoute } from "../api/client";
import type { ItineraryPlan, Spot } from "../types";
import { ChinaRouteMap } from "./ChinaRouteMap";

interface Props {
  onBookSpot: (spotId: string) => void;
}

export function MapStudio({ onBookSpot }: Props) {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>(["gugong", "xian", "jiuzhaigou", "lijiang"]);
  const [favCount, setFavCount] = useState(0);
  const [days, setDays] = useState(3);
  const [budget, setBudget] = useState<string>("");
  const [plan, setPlan] = useState<ItineraryPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetchSpots().then((items) => {
      setSpots(items);
      void runOptimize(["gugong", "xian", "jiuzhaigou", "lijiang"], 3, "");
    });
    fetchFavorites().then((ids) => setFavCount(ids.length)).catch(() => {});
  }, []);

  async function importFavorites() {
    setErr("");
    try {
      const ids = await fetchFavorites();
      setFavCount(ids.length);
      if (ids.length === 0) {
        setErr("心愿单为空，请先在「景区导览」收藏至少 1 个景点");
        return;
      }
      setSelectedIds(ids);
      void runOptimize(ids, days, budget);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "读取心愿单失败");
    }
  }

  async function runOptimize(ids: string[], d: number, budgetVal: string) {
    if (ids.length === 0) {
      setPlan(null);
      return;
    }
    setLoading(true);
    setErr("");
    try {
      const b = budgetVal.trim() ? Number(budgetVal) : null;
      const res = await optimizeRoute({ spot_ids: ids, days: d, budget: b });
      setPlan(res);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "求解失败");
    } finally {
      setLoading(false);
    }
  }

  function toggleSpot(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="hero-banner">
        <h1>3D 中国地理坐标沙盘与 2-opt 最短路径实验室</h1>
        <p>
          基于 d3-geo Mercator 投影与 Three.js WebGL 立体挤出渲染全国 34 省级地形、36 处真实景区光柱与 3D 贝塞尔飞线；支持拖拽旋转、悬停高亮与心愿单路线求解。
        </p>
      </div>

      <div className="grid-2">
        <div className="sticky-pane">
          <ChinaRouteMap
            spots={spots}
            plan={plan}
            selectedSpotIds={selectedIds}
            onToggleSpot={toggleSpot}
            height={470}
          />
        </div>

        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3>自选站点求解 2-opt TSP 路线</h3>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="chip" onClick={() => void importFavorites()}>
                ♥ 导入心愿单 ({favCount})
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setSelectedIds([]);
                  setPlan(null);
                }}
              >
                清空
              </button>
            </div>
          </div>
          <div className="chips" style={{ maxHeight: 155, overflowY: "auto", paddingRight: 4 }}>
            {spots.map((s) => {
              const active = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`chip ${active ? "active" : ""}`}
                  onClick={() => toggleSpot(s.id)}
                >
                  {s.name.split(" · ")[0]} (¥{s.price})
                </button>
              );
            })}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              计划天数
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>
                    {d} 天
                  </option>
                ))}
              </select>
            </label>
            <label>
              门票预算上限（可选）
              <input
                type="number"
                min={0}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="不限"
              />
            </label>
          </div>

          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || selectedIds.length === 0}
            onClick={() => void runOptimize(selectedIds, days, budget)}
          >
            {loading ? "算法求解中..." : `运行 2-opt 排线（已选 ${selectedIds.length} 处）`}
          </button>

          {err && <div style={{ color: "#c8321e", fontSize: "0.88rem" }}>{err}</div>}

          {plan && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">贪心基线 {plan.greedy_distance_km} km</span>
                <span className="badge">2-opt 优化后 {plan.optimized_distance_km} km</span>
                <span className="badge orange">减少绕行 {plan.distance_saved_km} km</span>
                <span className="badge">总门票 ¥{plan.total_ticket_cost}</span>
              </div>

              {plan.days.map((d) => (
                <div key={d.day} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                    {d.day} · 约 {d.total_hours} 小时
                  </div>
                  <div style={{ fontSize: "0.85rem", color: "var(--ink-soft)", marginTop: 4 }}>
                    {d.stops.map((st, idx) => (
                      <div
                        key={st.spot_id}
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 0" }}
                      >
                        <span>
                          {idx + 1}. {st.name}
                          {st.distance_from_prev_km > 0 ? ` (+${st.distance_from_prev_km}km)` : ""}
                        </span>
                        <button
                          type="button"
                          className="chip"
                          style={{ padding: "2px 10px", fontSize: "0.75rem" }}
                          onClick={() => onBookSpot(st.spot_id)}
                        >
                          预约
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
