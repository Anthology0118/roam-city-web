import { geoMercator } from "d3-geo";
import * as THREE from "three";
import type { FeatureCollection } from "geojson";

export const PROJ_W = 860;
export const PROJ_H = 640;
export const WORLD_SCALE = 0.1;
export const BASE_THICKNESS = 1.25;
export const MAX_RELIEF_HEIGHT = 7.6;

export function toWorldXZ(pt: [number, number]): [number, number] {
  return [(pt[0] - PROJ_W / 2) * WORLD_SCALE, (pt[1] - PROJ_H / 2) * WORLD_SCALE];
}

interface GaussianFeature {
  lng: number;
  lat: number;
  amp: number; // meters (+ mountain/plateau, - basin)
  sx: number;  // sigma longitude deg
  sy: number;  // sigma latitude deg
}

// High-detail orographic model capturing China's 3-step terrain, major mountain ranges & basins
const TERRAIN_FEATURES: GaussianFeature[] = [
  // Step 1: Tibetan Plateau, Himalaya, Kunlun, Qilian, Hengduan, Karakoram
  { lng: 88.0, lat: 32.8, amp: 4350, sx: 8.4, sy: 4.3 },
  { lng: 81.2, lat: 33.4, amp: 1550, sx: 4.2, sy: 2.8 },
  { lng: 94.6, lat: 34.4, amp: 1550, sx: 4.5, sy: 3.0 },
  { lng: 86.8, lat: 28.2, amp: 1450, sx: 5.5, sy: 1.3 }, // Himalaya crest
  { lng: 84.5, lat: 35.8, amp: 1150, sx: 5.0, sy: 1.3 }, // Kunlun main ridge
  { lng: 98.5, lat: 38.2, amp: 2350, sx: 3.6, sy: 1.6 }, // Qilian Mountains
  { lng: 100.2, lat: 30.2, amp: 2750, sx: 2.3, sy: 3.4 }, // Hengduan / West Sichuan

  // Step 2: Tianshan, Altai, Tarim Basin, Junggar Basin, Yunnan-Guizhou, Loess Plateau, Qinling, Sichuan Basin
  { lng: 83.8, lat: 43.0, amp: 2850, sx: 5.8, sy: 1.35 }, // Tianshan range
  { lng: 76.8, lat: 37.6, amp: 2650, sx: 3.8, sy: 2.0 },  // Pamir / West Kunlun
  { lng: 89.0, lat: 47.6, amp: 1950, sx: 3.4, sy: 1.5 },  // Altai Mountains
  { lng: 83.4, lat: 39.4, amp: -850, sx: 4.8, sy: 2.0 },  // Tarim Basin depression
  { lng: 86.2, lat: 45.2, amp: -450, sx: 3.2, sy: 1.4 },  // Junggar Basin
  { lng: 102.6, lat: 25.6, amp: 1850, sx: 3.8, sy: 2.6 }, // Yunnan-Guizhou Plateau
  { lng: 107.6, lat: 36.2, amp: 1420, sx: 3.9, sy: 2.8 }, // Loess Plateau
  { lng: 108.2, lat: 33.8, amp: 1120, sx: 3.8, sy: 0.95 }, // Qinling Mountain ridge
  { lng: 112.5, lat: 42.4, amp: 1150, sx: 6.2, sy: 2.6 }, // Inner Mongolia Plateau
  { lng: 105.5, lat: 30.5, amp: -1250, sx: 2.2, sy: 1.8 }, // Sichuan Basin bowl

  // Step 3 & Coastal Ranges: Greater Khingan, Changbai, Taihang, Wuyi, Nanling, Taiwan Central Range
  { lng: 121.4, lat: 48.6, amp: 1080, sx: 2.4, sy: 3.6 }, // Greater Khingan
  { lng: 127.8, lat: 42.2, amp: 1480, sx: 2.2, sy: 2.0 }, // Changbai Mountains
  { lng: 113.6, lat: 37.5, amp: 920, sx: 1.4, sy: 2.8 },  // Taihang Mountains
  { lng: 117.6, lat: 26.8, amp: 880, sx: 2.6, sy: 2.4 },  // Wuyi / Southeast Hills
  { lng: 112.5, lat: 25.2, amp: 680, sx: 3.2, sy: 1.2 },  // Nanling Range
  { lng: 121.0, lat: 23.7, amp: 2450, sx: 0.75, sy: 1.5 }, // Taiwan Central Range
];

export const PROVINCE_MEAN_ELEVATION: Record<string, number> = {
  "西藏": 4500, "西藏自治区": 4500,
  "青海": 3800, "青海省": 3800,
  "云南": 1950, "云南省": 1950,
  "甘肃": 1850, "甘肃省": 1850,
  "四川": 1750, "四川省": 1750,
  "新疆": 1650, "新疆维吾尔自治区": 1650,
  "宁夏": 1450, "宁夏回族自治区": 1450,
  "贵州": 1300, "贵州省": 1300,
  "山西": 1200, "山西省": 1200,
  "内蒙古": 1150, "内蒙古自治区": 1150,
  "陕西": 1050, "陕西省": 1050,
  "台湾": 950, "台湾省": 950,
  "重庆": 800, "重庆市": 800,
  "广西": 650, "广西壮族自治区": 650,
  "福建": 560, "福建省": 560,
  "吉林": 520, "吉林省": 520,
  "河北": 480, "河北省": 480,
  "黑龙江": 450, "黑龙江省": 450,
  "北京": 420, "北京市": 420,
  "湖南": 420, "湖南省": 420,
  "浙江": 380, "浙江省": 380,
  "湖北": 380, "湖北省": 380,
  "江西": 360, "江西省": 360,
  "辽宁": 350, "辽宁省": 350,
  "海南": 320, "海南省": 320,
  "河南": 300, "河南省": 300,
  "广东": 280, "广东省": 280,
  "安徽": 240, "安徽省": 240,
  "山东": 220, "山东省": 220,
  "香港": 120, "澳门": 80,
  "江苏": 80, "江苏省": 80,
  "天津": 60, "天津市": 60,
  "上海": 40, "上海市": 40,
};

export function sampleChinaElevationMeters(lng: number, lat: number): number {
  let elev = 85;
  for (const f of TERRAIN_FEATURES) {
    const dx = (lng - f.lng) / f.sx;
    const dy = (lat - f.lat) / f.sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > 14) continue;
    elev += f.amp * Math.exp(-0.5 * d2);
  }
  // Multi-octave topographic ridge noise so mountain chains & plateaus show crisp relief under directional light
  const oct1 = 110 * Math.sin(lng * 1.15) * Math.cos(lat * 1.35);
  const oct2 = 65 * Math.sin((lng * 1.9 + lat * 2.1)) * Math.cos((lng - lat) * 1.7);
  const oct3 = 38 * Math.cos(lng * 3.6 - lat * 3.1);
  const reliefFactor = Math.min(1.25, Math.max(0.18, elev / 1350));
  elev += (oct1 + oct2 + oct3) * reliefFactor;
  return Math.max(25, Math.min(5350, Math.round(elev)));
}

export function elevationToWorldY(meters: number): number {
  // Smooth non-linear power curve gives eastern hills visible relief while keeping Tibetan plateau monumental
  const norm = Math.max(0, meters) / 5200;
  return BASE_THICKNESS + Math.pow(norm, 0.86) * MAX_RELIEF_HEIGHT;
}

export function computeAnalyticalTerrainNormal(
  lng: number,
  lat: number,
  target = new THREE.Vector3()
): THREE.Vector3 {
  const eps = 0.14;
  const hL = elevationToWorldY(sampleChinaElevationMeters(lng - eps, lat));
  const hR = elevationToWorldY(sampleChinaElevationMeters(lng + eps, lat));
  const hD = elevationToWorldY(sampleChinaElevationMeters(lng, lat - eps));
  const hU = elevationToWorldY(sampleChinaElevationMeters(lng, lat + eps));
  const stepWorld = eps * 1.28;
  target.set(hL - hR, 2 * stepWorld, hD - hU).normalize();
  return target;
}

const COLOR_STOPS: Array<{ elev: number; color: THREE.Color }> = [
  { elev: 0, color: new THREE.Color("#1e3a8a") },     // Coastal deep sapphire blue
  { elev: 320, color: new THREE.Color("#2563eb") },   // Eastern plain royal azure
  { elev: 900, color: new THREE.Color("#0284c7") },   // Foothills & basins sky blue
  { elev: 1650, color: new THREE.Color("#38bdf8") },  // Second terrace luminous cyan
  { elev: 2650, color: new THREE.Color("#f59e0b") },  // Alpine plateau warm amber-gold
  { elev: 3800, color: new THREE.Color("#fbbf24") },  // High ridge radiant gold
  { elev: 4650, color: new THREE.Color("#f8fafc") },  // Snow-capped Tibetan crest
];

export function elevationToColor(meters: number): THREE.Color {
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (meters <= b.elev) {
      const t = Math.max(0, Math.min(1, (meters - a.elev) / (b.elev - a.elev)));
      return a.color.clone().lerp(b.color, t);
    }
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].color.clone();
}

export type TerrainColorMode = "elevation" | "climate" | "holo";

export interface ClimateInfo {
  id: "tropical" | "subtropical" | "temperate_monsoon" | "continental" | "alpine";
  label: string;
  color: string;
}

export const CLIMATE_LEGEND: ClimateInfo[] = [
  { id: "tropical", label: "热带季风", color: "#0284c7" },
  { id: "subtropical", label: "亚热带季风", color: "#06b6d4" },
  { id: "temperate_monsoon", label: "温带季风", color: "#6366f1" },
  { id: "continental", label: "温带大陆性", color: "#f59e0b" },
  { id: "alpine", label: "高原山地", color: "#a855f7" },
];

export function classifyChinaClimate(lng: number, lat: number, elevMeters: number): ClimateInfo {
  if (elevMeters >= 2650 || (lng < 103.5 && lat >= 27.2 && lat <= 39.0 && elevMeters >= 2050)) {
    return CLIMATE_LEGEND[4];
  }
  const isXishuangbanna = lat <= 22.7 && lng <= 102.2;
  const isSouthCoast = lat <= 21.7 && lng >= 106.0;
  const isSouthTaiwan = lat <= 23.2 && lng >= 120.0;
  if (isXishuangbanna || isSouthCoast || isSouthTaiwan) {
    return CLIMATE_LEGEND[0];
  }
  const qinlingLat = lng < 111 ? 32.8 : 33.8;
  if (lat <= qinlingLat && lng >= 98.0) {
    return CLIMATE_LEGEND[1];
  }
  const monsoonWestLng = 106.5 + Math.max(0, lat - 34.0) * 1.0;
  if (lng >= monsoonWestLng) {
    return CLIMATE_LEGEND[2];
  }
  return CLIMATE_LEGEND[3];
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Smoothly blended climate coloring so climate zones transition naturally across topographic
 * boundaries (Qinling-Huaihe line, 400mm isohyet, and Tibetan plateau escarpment) while also
 * encoding elevation relief brightness.
 */
export function climateToColor(lng: number, lat: number, elevMeters: number): THREE.Color {
  const cTropical = new THREE.Color("#0284c7");
  const cSubtropical = new THREE.Color("#06b6d4");
  const cTempMonsoon = new THREE.Color("#6366f1");
  const cContinental = new THREE.Color("#f59e0b");
  const cAlpine = new THREE.Color("#a855f7");
  const cSnow = new THREE.Color("#f8fafc");

  // East China latitude transition: Tropical -> Subtropical -> Temperate Monsoon
  const qinlingLat = lng < 111 ? 32.8 : 33.8;
  const subToTemp = smoothstep(qinlingLat - 1.8, qinlingLat + 1.8, lat);
  const tropToSub = smoothstep(21.2, 23.8, lat);

  const eastColor = cTropical.clone().lerp(cSubtropical, tropToSub).lerp(cTempMonsoon, subToTemp);

  // Monsoon vs Continental transition along ~400mm isohyet
  const monsoonWestLng = 106.5 + Math.max(0, lat - 34.0) * 1.0;
  const westToEast = smoothstep(monsoonWestLng - 3.2, monsoonWestLng + 3.2, lng);
  const lowlandColor = cContinental.clone().lerp(eastColor, westToEast);

  // Alpine plateau transition by elevation
  const alpineT = smoothstep(2050, 2950, elevMeters);
  const base = lowlandColor.lerp(cAlpine, alpineT);

  // Snow / glacier transition above 3500m
  if (elevMeters > 3450) {
    const snowT = smoothstep(3450, 4700, elevMeters);
    base.lerp(cSnow, snowT);
  } else {
    const reliefTint = (elevMeters - 800) / 3600;
    if (reliefTint > 0) {
      base.lerp(new THREE.Color("#e0f2fe"), Math.min(0.22, reliefTint * 0.25));
    }
  }
  return base;
}

/**
 * DataV-inspired cyber holographic palette: deep indigo-violet plains -> electric cyan hills ->
 * luminous gold-white highland peaks.
 */
export function holoToColor(elevMeters: number): THREE.Color {
  const stops: Array<{ elev: number; color: THREE.Color }> = [
    { elev: 0, color: new THREE.Color("#1e1b4b") },
    { elev: 450, color: new THREE.Color("#312e81") },
    { elev: 1300, color: new THREE.Color("#4f46e5") },
    { elev: 2400, color: new THREE.Color("#06b6d4") },
    { elev: 3600, color: new THREE.Color("#38bdf8") },
    { elev: 4650, color: new THREE.Color("#f8fafc") },
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (elevMeters <= b.elev) {
      const t = Math.max(0, Math.min(1, (elevMeters - a.elev) / (b.elev - a.elev)));
      return a.color.clone().lerp(b.color, t);
    }
  }
  return stops[stops.length - 1].color.clone();
}

export interface ProvinceExtrudedMeshData {
  name: string;
  centerLngLat: [number, number];
  meanElevMeters: number;
  climateLabel: string;
  geometry: THREE.BufferGeometry;
  elevationColors: Float32Array;
  climateColors: Float32Array;
  holoColors: Float32Array;
  borderLinePoints: THREE.Vector3[][];
}

function subdivideTopTriangles(rawPos: ArrayLike<number>, maxEdgeLen = 1.65): number[] {
  let pos = Array.from(rawPos);
  for (let pass = 0; pass < 4; pass++) {
    const nextPos: number[] = [];
    let splits = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
      const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
      const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
      const dab = Math.hypot(bx - ax, bz - az);
      const dbc = Math.hypot(cx - bx, cz - bz);
      const dca = Math.hypot(ax - cx, az - cz);
      const maxD = Math.max(dab, dbc, dca);
      if (maxD <= maxEdgeLen) {
        nextPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        continue;
      }
      splits++;
      if (dab >= dbc && dab >= dca) {
        const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
        nextPos.push(ax, ay, az, mx, my, mz, cx, cy, cz);
        nextPos.push(mx, my, mz, bx, by, bz, cx, cy, cz);
      } else if (dbc >= dab && dbc >= dca) {
        const mx = (bx + cx) * 0.5, my = (by + cy) * 0.5, mz = (bz + cz) * 0.5;
        nextPos.push(ax, ay, az, bx, by, bz, mx, my, mz);
        nextPos.push(ax, ay, az, mx, my, mz, cx, cy, cz);
      } else {
        const mx = (cx + ax) * 0.5, my = (cy + ay) * 0.5, mz = (cz + az) * 0.5;
        nextPos.push(ax, ay, az, bx, by, bz, mx, my, mz);
        nextPos.push(mx, my, mz, bx, by, bz, cx, cy, cz);
      }
    }
    pos = nextPos;
    if (splits === 0) break;
  }
  return pos;
}

/**
 * Builds seamless, high-detail vector-extruded 3D province meshes:
 * 1. Every province's top surface is adaptively subdivided and displaced by a continuous
 *    topographic elevation field + analytical gradient normals so province borders meet with
 *    ZERO vertical step cliffs while interior mountain ranges show true 3D relief.
 * 2. Smooth vertical side walls with subtle horizontal stratum shading give the entire China
 *    map a clean architectural sandbox pedestal.
 */
export function buildExtrudedChinaProvinces(
  geoJson: FeatureCollection,
  projection: ReturnType<typeof geoMercator>
): ProvinceExtrudedMeshData[] {
  const result: ProvinceExtrudedMeshData[] = [];
  const sideBaseDark = new THREE.Color("#0f172a");
  const sideTopAccent = new THREE.Color("#312e81");
  const tmpNorm = new THREE.Vector3();

  for (const feat of geoJson.features) {
    const props = (feat.properties || {}) as unknown as Record<string, unknown>;
    const provName = String(props.name || "");
    const meanElev = PROVINCE_MEAN_ELEVATION[provName] ?? 500;
    const cp: [number, number] = Array.isArray(props.cp)
      ? [Number(props.cp[0]), Number(props.cp[1])]
      : [Number(props.longitude || 105), Number(props.latitude || 35)];
    const provClimate = classifyChinaClimate(cp[0], cp[1], meanElev).label;

    const geom = feat.geometry;
    const polygons =
      geom.type === "Polygon"
        ? [geom.coordinates as number[][][]]
        : geom.type === "MultiPolygon"
          ? (geom.coordinates as number[][][][])
          : [];

    const posList: number[] = [];
    const normList: number[] = [];
    const elevColList: number[] = [];
    const climColList: number[] = [];
    const holoColList: number[] = [];
    const borderLinePoints: THREE.Vector3[][] = [];

    const pushVertex = (
      wx: number,
      wy: number,
      wz: number,
      nx: number,
      ny: number,
      nz: number,
      ec: THREE.Color,
      cc: THREE.Color,
      hc: THREE.Color
    ) => {
      posList.push(wx, wy, wz);
      normList.push(nx, ny, nz);
      elevColList.push(ec.r, ec.g, ec.b);
      climColList.push(cc.r, cc.g, cc.b);
      holoColList.push(hc.r, hc.g, hc.b);
    };

    for (const poly of polygons) {
      const ring = poly[0];
      if (!ring || ring.length < 4) continue;

      const shapePts: THREE.Vector2[] = [];
      const topBorderPts: THREE.Vector3[] = [];

      for (let i = 0; i < ring.length; i++) {
        const coord = ring[i];
        const p = projection([coord[0], coord[1]]);
        if (!p) continue;
        const [wx, wz] = toWorldXZ(p);

        const elev = sampleChinaElevationMeters(coord[0], coord[1]);
        const wy = elevationToWorldY(elev);
        topBorderPts.push(new THREE.Vector3(wx, wy + 0.09, wz));

        if (i < ring.length - 1) {
          if (shapePts.length > 0) {
            const prev = shapePts[shapePts.length - 1];
            if (Math.hypot(wx - prev.x, -wz - prev.y) < 0.004) continue;
          }
          shapePts.push(new THREE.Vector2(wx, -wz));
        }
      }

      if (topBorderPts.length > 2) {
        borderLinePoints.push(topBorderPts);
      }

      if (shapePts.length < 3) continue;

      // 1. Subdivided top relief cap
      let sGeo: THREE.ShapeGeometry;
      try {
        const shape = new THREE.Shape(shapePts);
        sGeo = new THREE.ShapeGeometry(shape);
      } catch {
        continue;
      }

      sGeo.rotateX(-Math.PI / 2);
      const nonIndexed = sGeo.index ? sGeo.toNonIndexed() : sGeo;
      const subPos = subdivideTopTriangles(
        (nonIndexed.getAttribute("position") as THREE.BufferAttribute).array,
        1.65
      );

      for (let i = 0; i < subPos.length; i += 3) {
        const wx = subPos[i];
        const wz = subPos[i + 2];
        const projX = wx / WORLD_SCALE + PROJ_W / 2;
        const projY = wz / WORLD_SCALE + PROJ_H / 2;
        const lonLat = projection.invert ? projection.invert([projX, projY]) : cp;
        const lng = lonLat ? lonLat[0] : cp[0];
        const lat = lonLat ? lonLat[1] : cp[1];

        const elev = sampleChinaElevationMeters(lng, lat);
        const wy = elevationToWorldY(elev);
        computeAnalyticalTerrainNormal(lng, lat, tmpNorm);

        const ec = elevationToColor(elev);
        const cc = climateToColor(lng, lat, elev);
        const hc = holoToColor(elev);

        pushVertex(wx, wy, wz, tmpNorm.x, tmpNorm.y, tmpNorm.z, ec, cc, hc);
      }

      sGeo.dispose();
      if (nonIndexed !== sGeo) nonIndexed.dispose();

      // 2. Clean architectural side walls along the polygon perimeter
      for (let i = 0; i < topBorderPts.length - 1; i++) {
        const a = topBorderPts[i];
        const b = topBorderPts[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz);
        if (len < 1e-4) continue;
        const nx = dz / len;
        const nz = -dx / len;

        const ay = a.y - 0.09;
        const by = b.y - 0.09;

        const topCol = sideTopAccent;
        const botCol = sideBaseDark;

        // Triangle 1: (a, 0) -> (a, ay) -> (b, by)
        pushVertex(a.x, 0, a.z, nx, 0, nz, botCol, botCol, botCol);
        pushVertex(a.x, ay, a.z, nx, 0, nz, topCol, topCol, topCol);
        pushVertex(b.x, by, b.z, nx, 0, nz, topCol, topCol, topCol);

        // Triangle 2: (a, 0) -> (b, by) -> (b, 0)
        pushVertex(a.x, 0, a.z, nx, 0, nz, botCol, botCol, botCol);
        pushVertex(b.x, by, b.z, nx, 0, nz, topCol, topCol, topCol);
        pushVertex(b.x, 0, b.z, nx, 0, nz, botCol, botCol, botCol);
      }
    }

    if (posList.length === 0) continue;

    const geometry = new THREE.BufferGeometry();
    const elevationColors = new Float32Array(elevColList);
    const climateColors = new Float32Array(climColList);
    const holoColors = new Float32Array(holoColList);
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(posList, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normList, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(climateColors), 3));

    result.push({
      name: provName,
      centerLngLat: cp,
      meanElevMeters: meanElev,
      climateLabel: provClimate,
      geometry,
      elevationColors,
      climateColors,
      holoColors,
      borderLinePoints,
    });
  }

  return result;
}

export function getSpotWorldY(lng: number, lat: number): number {
  return elevationToWorldY(sampleChinaElevationMeters(lng, lat));
}

export function buildChinaTerrainGeometry(
  geoJson: FeatureCollection,
  projection: ReturnType<typeof geoMercator>
): { geometry: THREE.BufferGeometry; elevationColors: Float32Array; climateColors: Float32Array } {
  const provinces = buildExtrudedChinaProvinces(geoJson, projection);
  const pos: number[] = [];
  const elev: number[] = [];
  const clim: number[] = [];
  for (const p of provinces) {
    const pAttr = p.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pArr = pAttr.array as Float32Array;
    for (let i = 0; i < pArr.length; i++) pos.push(pArr[i]);
    for (let i = 0; i < p.elevationColors.length; i++) elev.push(p.elevationColors[i]);
    for (let i = 0; i < p.climateColors.length; i++) clim.push(p.climateColors[i]);
    p.geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  const elevationColors = new Float32Array(elev);
  const climateColors = new Float32Array(clim);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(elevationColors), 3));
  geometry.computeVertexNormals();
  return { geometry, elevationColors, climateColors };
}
