import { geoMercator, geoPath } from "d3-geo";
import { useMemo, useState } from "react";
import chinaGeoJson from "china-map-geojson/lib/china.js";
import type { ItineraryPlan, PlanStop, Spot } from "../types";

interface ChinaRouteMapProps {
  spots?: Spot[];
  plan?: ItineraryPlan | null;
  selectedSpotIds?: string[];
  onToggleSpot?: (spotId: string) => void;
  onInspectSpot?: (spotId: string) => void;
  height?: number;
}

const DAY_COLORS = ["#f2601e", "#17a2a8", "#2d6cdf", "#9b51e0", "#0f9d58", "#d97706", "#e11d48"];
const MAP_W = 860;
const MAP_H = 640;

export function ChinaRouteMap({
  spots = [],
  plan = null,
  selectedSpotIds = [],
  onToggleSpot,
  onInspectSpot,
  height = 460,
}: ChinaRouteMapProps) {
  const [hoverProvince, setHoverProvince] = useState<string>("");
  const [hoverStop, setHoverStop] = useState<{
    id: string;
    name: string;
    city: string;
    price: number;
    dayLabel?: string;
    x: number;
    y: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);

  const { projection, provincePaths } = useMemo(() => {
    const proj = geoMercator().fitExtent(
      [
        [24, 24],
        [MAP_W - 24, MAP_H - 24],
      ],
      chinaGeoJson
    );
    const pathGen = geoPath().projection(proj);
    const paths = chinaGeoJson.features.map((feat, idx) => ({
      key: feat.properties?.id || String(idx),
      name: feat.properties?.name || "",
      d: pathGen(feat) || "",
    }));
    return { projection: proj, provincePaths: paths };
  }, []);

  // Flatten ordered route stops from plan with day color & sequence index
  const orderedStops = useMemo(() => {
    if (!plan) return [] as Array<PlanStop & { seq: number; dayIdx: number; dayLabel: string; color: string; x: number; y: number }>;
    const list: Array<PlanStop & { seq: number; dayIdx: number; dayLabel: string; color: string; x: number; y: number }> = [];
    let seq = 1;
    plan.days.forEach((d, dayIdx) => {
      const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
      d.stops.forEach((st) => {
        const pt = projection([st.lng, st.lat]);
        if (!pt) return;
        list.push({
          ...st,
          seq: seq++,
          dayIdx,
          dayLabel: d.day,
          color,
          x: pt[0],
          y: pt[1],
        });
      });
    });
    return list;
  }, [plan, projection]);

  const activeIds = useMemo(() => new Set(orderedStops.map((s) => s.spot_id)), [orderedStops]);
  const selectedSet = useMemo(() => new Set(selectedSpotIds), [selectedSpotIds]);

  const tx = (MAP_W * (1 - zoom)) / 2;
  const ty = (MAP_H * (1 - zoom)) / 2;

  return (
    <div style={{ position: "relative", background: "#f7fbfb", border: "1px solid var(--line)", borderRadius: 14, overflow: "hidden" }}>
      {/* Top toolbar */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          right: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          pointerEvents: "none",
          zIndex: 4,
        }}
      >
        <div
          style={{
            background: "rgba(255, 253, 248, 0.92)",
            border: "1px solid var(--line)",
            borderRadius: 999,
            padding: "4px 12px",
            fontSize: "0.78rem",
            color: "var(--teal-900)",
            fontWeight: 600,
          }}
        >
          {hoverProvince ? `📍 ${hoverProvince}` : "🇨🇳 中国地理坐标投影图 (Mercator · WGS-84)"}
        </div>
        <div style={{ display: "flex", gap: 6, pointerEvents: "auto" }}>
          <button
            type="button"
            className="chip"
            style={{ padding: "3px 10px", fontSize: "0.8rem" }}
            onClick={() => setZoom((z) => Math.min(2.2, Number((z + 0.25).toFixed(2))))}
          >
            +
          </button>
          <button
            type="button"
            className="chip"
            style={{ padding: "3px 10px", fontSize: "0.8rem" }}
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.25).toFixed(2))))}
          >
            −
          </button>
          {zoom > 1 && (
            <button
              type="button"
              className="chip"
              style={{ padding: "3px 10px", fontSize: "0.78rem" }}
              onClick={() => setZoom(1)}
            >
              重置
            </button>
          )}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{ width: "100%", height, display: "block", userSelect: "none" }}
        role="img"
        aria-label="中国景点与2-opt路线地图"
      >
        <defs>
          {DAY_COLORS.map((c, idx) => (
            <marker
              key={c}
              id={`arrow-day-${idx}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill={c} />
            </marker>
          ))}
        </defs>

        <g transform={`translate(${tx}, ${ty}) scale(${zoom})`}>
          {/* 1. China provincial polygons */}
          {provincePaths.map((p) => {
            const isHover = hoverProvince === p.name;
            return (
              <path
                key={p.key}
                d={p.d}
                fill={isHover ? "#cdebe8" : "#e7f3f2"}
                stroke="#ffffff"
                strokeWidth={1.1 / zoom}
                style={{ transition: "fill 0.15s ease", cursor: "pointer" }}
                onMouseEnter={() => setHoverProvince(p.name)}
                onMouseLeave={() => setHoverProvince("")}
              />
            );
          })}

          {/* 2. Background spots (unplanned or selectable) */}
          {spots.map((s) => {
            if (activeIds.has(s.id)) return null;
            const pt = projection([s.lng, s.lat]);
            if (!pt) return null;
            const isSel = selectedSet.has(s.id);
            return (
              <g
                key={s.id}
                transform={`translate(${pt[0]}, ${pt[1]})`}
                style={{ cursor: "pointer" }}
                onClick={() => {
                  onToggleSpot?.(s.id);
                  onInspectSpot?.(s.id);
                }}
                onMouseEnter={() =>
                  setHoverStop({ id: s.id, name: s.name, city: s.city, price: s.price, x: pt[0], y: pt[1] })
                }
                onMouseLeave={() => setHoverStop(null)}
              >
                <circle
                  r={(isSel ? 8 : 5.5) / zoom}
                  fill={isSel ? "#f2601e" : "#126e72"}
                  fillOpacity={isSel ? 0.95 : 0.72}
                  stroke="#fff"
                  strokeWidth={1.6 / zoom}
                />
                <text
                  y={-9 / zoom}
                  textAnchor="middle"
                  fontSize={10.5 / zoom}
                  fontWeight={isSel ? 700 : 500}
                  fill="#0c3b3f"
                >
                  {s.name.split(" · ")[0]}
                </text>
              </g>
            );
          })}

          {/* 3. Directed 2-opt route legs */}
          {orderedStops.map((curr, idx) => {
            if (idx === 0) return null;
            const prev = orderedStops[idx - 1];
            const mx = (prev.x + curr.x) / 2;
            const my = (prev.y + curr.y) / 2;
            const colorIdx = curr.dayIdx % DAY_COLORS.length;
            return (
              <g key={`leg-${prev.spot_id}-${curr.spot_id}`}>
                <line
                  x1={prev.x}
                  y1={prev.y}
                  x2={curr.x}
                  y2={curr.y}
                  stroke={curr.color}
                  strokeWidth={2.6 / zoom}
                  strokeDasharray={prev.dayIdx !== curr.dayIdx ? `${6 / zoom} ${4 / zoom}` : undefined}
                  markerEnd={`url(#arrow-day-${colorIdx})`}
                  opacity={0.9}
                />
                {curr.distance_from_prev_km > 0 && (
                  <g transform={`translate(${mx}, ${my})`}>
                    <rect
                      x={-26 / zoom}
                      y={-9 / zoom}
                      width={52 / zoom}
                      height={16 / zoom}
                      rx={8 / zoom}
                      fill="rgba(255,255,255,0.92)"
                      stroke={curr.color}
                      strokeWidth={0.9 / zoom}
                    />
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={9 / zoom}
                      fontWeight={700}
                      fill={curr.color}
                    >
                      {Math.round(curr.distance_from_prev_km)}km
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* 4. Planned route numbered markers */}
          {orderedStops.map((st) => (
            <g
              key={`stop-${st.spot_id}`}
              transform={`translate(${st.x}, ${st.y})`}
              style={{ cursor: "pointer" }}
              onClick={() => onInspectSpot?.(st.spot_id)}
              onMouseEnter={() =>
                setHoverStop({
                  id: st.spot_id,
                  name: st.name,
                  city: st.city,
                  price: st.price,
                  dayLabel: st.dayLabel,
                  x: st.x,
                  y: st.y,
                })
              }
              onMouseLeave={() => setHoverStop(null)}
            >
              <circle r={11 / zoom} fill={st.color} stroke="#ffffff" strokeWidth={2 / zoom} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={10.5 / zoom}
                fontWeight={700}
                fill="#ffffff"
              >
                {st.seq}
              </text>
              <text
                y={19 / zoom}
                textAnchor="middle"
                fontSize={10.5 / zoom}
                fontWeight={700}
                fill="#0c3b3f"
              >
                {st.name}
              </text>
            </g>
          ))}
        </g>

        {/* South China Sea Islands schematic inset box */}
        <g transform="translate(744, 514)">
          <rect width="102" height="114" rx="6" fill="rgba(255,253,248,0.9)" stroke="#9dc4c2" strokeWidth="1" />
          <text x="51" y="16" textAnchor="middle" fontSize="9.5" fill="#126e72" fontWeight="600">
            南海诸岛
          </text>
          <path
            d="M 22 36 Q 18 56 26 74 M 34 86 Q 48 96 64 90 M 76 80 Q 86 64 84 42 M 80 28 L 84 24"
            fill="none"
            stroke="#7fb5b3"
            strokeWidth="1.4"
            strokeDasharray="5 4"
          />
          <circle cx="46" cy="52" r="2" fill="#17a2a8" />
          <circle cx="62" cy="64" r="2" fill="#17a2a8" />
          <circle cx="52" cy="76" r="1.8" fill="#17a2a8" />
        </g>
      </svg>

      {/* Bottom legend & hover tooltip */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "8px 14px",
          borderTop: "1px solid var(--line)",
          background: "#fff",
          fontSize: "0.8rem",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {plan ? (
            plan.days.map((d, i) => (
              <span key={d.day} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: DAY_COLORS[i % DAY_COLORS.length],
                    display: "inline-block",
                  }}
                />
                <b>{d.day}</b>（{d.stops.length}站）
              </span>
            ))
          ) : (
            <span style={{ color: "var(--ink-soft)" }}>点击地图上的景点圆点可加入/移出排线候选集</span>
          )}
        </div>
        {hoverStop && (
          <div style={{ color: "var(--teal-900)", fontWeight: 600 }}>
            {hoverStop.dayLabel ? `[${hoverStop.dayLabel}] ` : ""}
            {hoverStop.name} · {hoverStop.city} · {hoverStop.price === 0 ? "免费" : `¥${hoverStop.price}`}
          </div>
        )}
      </div>
    </div>
  );
}
