import { geoContains, geoMercator } from "d3-geo";
import * as THREE from "three";
import type { Feature, FeatureCollection, Geometry } from "geojson";

export const PROJ_W = 860;
export const PROJ_H = 640;
export const WORLD_SCALE = 0.1;
export const BASE_THICKNESS = 0.85;
export const MAX_RELIEF_HEIGHT = 9.4;

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

// Orographic model capturing China's 3-step terrain (Tibetan Plateau -> 2nd Terrace -> Eastern Plains)
const TERRAIN_FEATURES: GaussianFeature[] = [
  // Step 1: Tibetan Plateau, Himalaya, Kunlun, Qilian, Hengduan
  { lng: 88.5, lat: 32.5, amp: 4450, sx: 8.8, sy: 4.5 },
  { lng: 81.2, lat: 33.2, amp: 1450, sx: 4.5, sy: 3.0 },
  { lng: 94.8, lat: 34.6, amp: 1550, sx: 4.6, sy: 3.1 },
  { lng: 87.2, lat: 28.4, amp: 1200, sx: 5.5, sy: 1.5 }, // Himalaya crest
  { lng: 98.5, lat: 38.2, amp: 2450, sx: 3.8, sy: 1.8 }, // Qilian Mountains
  { lng: 100.3, lat: 30.2, amp: 2700, sx: 2.5, sy: 3.4 }, // Hengduan / West Sichuan

  // Step 2: Tianshan, Altai, Tarim Basin, Yunnan-Guizhou, Loess Plateau, Inner Mongolia, Sichuan Basin
  { lng: 84.0, lat: 43.2, amp: 2750, sx: 6.2, sy: 1.6 }, // Tianshan
  { lng: 78.2, lat: 37.2, amp: 2550, sx: 4.5, sy: 2.0 }, // West Kunlun / Pamir
  { lng: 89.2, lat: 47.4, amp: 1850, sx: 3.6, sy: 1.8 }, // Altai
  { lng: 83.2, lat: 39.4, amp: -750, sx: 5.2, sy: 2.2 }, // Tarim Basin depression
  { lng: 102.6, lat: 25.8, amp: 1850, sx: 4.0, sy: 2.8 }, // Yunnan-Guizhou Plateau
  { lng: 107.6, lat: 36.2, amp: 1420, sx: 4.2, sy: 3.0 }, // Loess Plateau
  { lng: 108.4, lat: 33.8, amp: 850, sx: 4.2, sy: 1.1 },  // Qinling Mountain ridge
  { lng: 112.5, lat: 42.4, amp: 1180, sx: 6.5, sy: 2.8 }, // Inner Mongolia Plateau
  { lng: 105.6, lat: 30.5, amp: -1150, sx: 2.4, sy: 1.9 }, // Sichuan Basin bowl

  // Step 3 & Coastal Ranges: Greater Khingan, Changbai, Taihang, Wuyi, Taiwan Central Range
  { lng: 121.6, lat: 48.6, amp: 960, sx: 2.8, sy: 3.6 },  // Greater Khingan
  { lng: 127.8, lat: 42.2, amp: 1380, sx: 2.4, sy: 2.2 }, // Changbai Mountains
  { lng: 113.6, lat: 37.5, amp: 760, sx: 1.6, sy: 3.0 },  // Taihang Mountains
  { lng: 117.4, lat: 26.8, amp: 780, sx: 3.0, sy: 2.6 },  // Wuyi / Southeast Hills
  { lng: 121.0, lat: 23.7, amp: 2250, sx: 0.9, sy: 1.6 }, // Taiwan Central Range
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
  let elev = 90;
  for (const f of TERRAIN_FEATURES) {
    const dx = (lng - f.lng) / f.sx;
    const dy = (lat - f.lat) / f.sy;
    const d2 = dx * dx + dy * dy;
    if (d2 > 14) continue;
    elev += f.amp * Math.exp(-0.5 * d2);
  }
  // Subtle micro ridge variation so plains & foothills carry realistic texture
  const ridge = 55 * Math.sin(lng * 0.85) * Math.cos(lat * 1.1) + 35 * Math.sin((lng + lat) * 1.6);
  elev += ridge * Math.min(1, Math.max(0.25, elev / 1400));
  return Math.max(25, Math.min(5200, Math.round(elev)));
}

export function elevationToWorldY(meters: number): number {
  return BASE_THICKNESS + (Math.max(0, meters) / 5000) * MAX_RELIEF_HEIGHT;
}

const COLOR_STOPS: Array<{ elev: number; color: THREE.Color }> = [
  { elev: 0, color: new THREE.Color("#0e747a") },     // Low coastal teal-green
  { elev: 320, color: new THREE.Color("#1f9d76") },   // Alluvial plain emerald
  { elev: 850, color: new THREE.Color("#73b458") },   // Hills & basins sage-olive
  { elev: 1650, color: new THREE.Color("#cfa048") },  // Second terrace plateau amber
  { elev: 2800, color: new THREE.Color("#c26b39") },  // Alpine highland terracotta
  { elev: 3900, color: new THREE.Color("#946d60") },  // Permafrost mountain ridge
  { elev: 4650, color: new THREE.Color("#e8eef5") },  // Snow-capped Tibetan crest
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

interface BBoxFeature {
  feature: Feature<Geometry>;
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

function collectCoordsBBox(geom: Geometry): [number, number, number, number] {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  const walk = (arr: unknown) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    if (typeof arr[0] === "number" && typeof arr[1] === "number") {
      if (arr[0] < minLng) minLng = arr[0];
      if (arr[0] > maxLng) maxLng = arr[0];
      if (arr[1] < minLat) minLat = arr[1];
      if (arr[1] > maxLat) maxLat = arr[1];
    } else {
      for (const child of arr) walk(child);
    }
  };
  if ("coordinates" in geom) walk(geom.coordinates);
  return [minLng, maxLng, minLat, maxLat];
}

export type TerrainColorMode = "elevation" | "climate";

export interface ClimateInfo {
  id: "tropical" | "subtropical" | "temperate_monsoon" | "continental" | "alpine";
  label: string;
  color: string;
}

export const CLIMATE_LEGEND: ClimateInfo[] = [
  { id: "tropical", label: "热带季风", color: "#059669" },
  { id: "subtropical", label: "亚热带季风", color: "#22c55e" },
  { id: "temperate_monsoon", label: "温带季风", color: "#84cc16" },
  { id: "continental", label: "温带大陆性", color: "#eab308" },
  { id: "alpine", label: "高原山地", color: "#818cf8" },
];

export function classifyChinaClimate(lng: number, lat: number, elevMeters: number): ClimateInfo {
  // 1. Plateau / Alpine Mountain climate (Tibetan Plateau, Pamir, high Tianshan/Hengduan)
  if (elevMeters >= 2650 || (lng < 103.5 && lat >= 27.2 && lat <= 39.0 && elevMeters >= 2050)) {
    return CLIMATE_LEGEND[4];
  }
  // 2. Tropical Monsoon (Hainan, Leizhou, Xishuangbanna, Southern Taiwan)
  const isXishuangbanna = lat <= 22.7 && lng <= 102.2;
  const isSouthCoast = lat <= 21.7 && lng >= 106.0;
  const isSouthTaiwan = lat <= 23.2 && lng >= 120.0;
  if (isXishuangbanna || isSouthCoast || isSouthTaiwan) {
    return CLIMATE_LEGEND[0];
  }
  // 3. Subtropical Monsoon (South of Qinling-Huaihe ~33.5N, east of Tibetan slope)
  const qinlingLat = lng < 111 ? 32.8 : 33.8;
  if (lat <= qinlingLat && lng >= 98.0) {
    return CLIMATE_LEGEND[1];
  }
  // 4. Temperate Monsoon vs Temperate Continental along the ~400mm isohyet
  const monsoonWestLng = 106.5 + Math.max(0, lat - 34.0) * 1.0;
  if (lng >= monsoonWestLng) {
    return CLIMATE_LEGEND[2];
  }
  return CLIMATE_LEGEND[3];
}

export function climateToColor(lng: number, lat: number, elevMeters: number): THREE.Color {
  const info = classifyChinaClimate(lng, lat, elevMeters);
  const c = new THREE.Color(info.color);
  // Subtle climate sub-variations (glacier tops in alpine, lush boreal north, sandy Tarim core)
  if (info.id === "alpine" && elevMeters > 3800) {
    const snowT = Math.min(1, (elevMeters - 3800) / 950);
    c.lerp(new THREE.Color("#eef4fb"), snowT);
  } else if (info.id === "temperate_monsoon" && lat > 45.5) {
    c.lerp(new THREE.Color("#15803d"), Math.min(0.45, (lat - 45.5) / 10));
  } else if (info.id === "continental" && lng < 94 && lat > 37 && lat < 42.5) {
    c.lerp(new THREE.Color("#f59e0b"), 0.55); // Tarim / Taklamakan desert warmth
  }
  return c;
}

export function buildChinaTerrainGeometry(
  geoJson: FeatureCollection,
  projection: ReturnType<typeof geoMercator>
): { geometry: THREE.BufferGeometry; elevationColors: Float32Array; climateColors: Float32Array } {
  const bboxFeatures: BBoxFeature[] = geoJson.features.map((feature) => {
    const [minLng, maxLng, minLat, maxLat] = collectCoordsBBox(feature.geometry);
    return { feature, minLng, maxLng, minLat, maxLat };
  });

  const isInsideChina = (lng: number, lat: number): boolean => {
    for (const bf of bboxFeatures) {
      if (lng < bf.minLng || lng > bf.maxLng || lat < bf.minLat || lat > bf.maxLat) continue;
      if (geoContains(bf.feature, [lng, lat])) return true;
    }
    return false;
  };

  const cols = 122;
  const rows = 90;
  const lngMin = 73.2;
  const lngMax = 135.2;
  const latMin = 18.0;
  const latMax = 53.8;
  const dLng = (lngMax - lngMin) / cols;
  const dLat = (latMax - latMin) / rows;

  interface GridNode {
    wx: number;
    wy: number;
    wz: number;
    elevColor: THREE.Color;
    climColor: THREE.Color;
  }

  const nodes: GridNode[][] = [];
  for (let r = 0; r <= rows; r++) {
    const rowArr: GridNode[] = [];
    const lat = latMin + r * dLat;
    for (let c = 0; c <= cols; c++) {
      const lng = lngMin + c * dLng;
      const pt = projection([lng, lat]) || [PROJ_W / 2, PROJ_H / 2];
      const [wx, wz] = toWorldXZ(pt);
      const elev = sampleChinaElevationMeters(lng, lat);
      const wy = elevationToWorldY(elev);
      rowArr.push({
        wx,
        wy,
        wz,
        elevColor: elevationToColor(elev),
        climColor: climateToColor(lng, lat, elev),
      });
    }
    nodes.push(rowArr);
  }

  const cellInside: boolean[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => {
      const cLng = lngMin + (c + 0.5) * dLng;
      const cLat = latMin + (r + 0.5) * dLat;
      return isInsideChina(cLng, cLat);
    })
  );

  const positions: number[] = [];
  const elevColors: number[] = [];
  const climColors: number[] = [];

  const pushTri = (a: GridNode, b: GridNode, d: GridNode) => {
    positions.push(a.wx, a.wy, a.wz, b.wx, b.wy, b.wz, d.wx, d.wy, d.wz);
    elevColors.push(
      a.elevColor.r, a.elevColor.g, a.elevColor.b,
      b.elevColor.r, b.elevColor.g, b.elevColor.b,
      d.elevColor.r, d.elevColor.g, d.elevColor.b
    );
    climColors.push(
      a.climColor.r, a.climColor.g, a.climColor.b,
      b.climColor.r, b.climColor.g, b.climColor.b,
      d.climColor.r, d.climColor.g, d.climColor.b
    );
  };

  const skirtColor = new THREE.Color("#0c3b46");
  const pushSkirt = (a: GridNode, b: GridNode) => {
    positions.push(a.wx, 0, a.wz, a.wx, a.wy, a.wz, b.wx, b.wy, b.wz);
    elevColors.push(
      skirtColor.r, skirtColor.g, skirtColor.b,
      a.elevColor.r * 0.72, a.elevColor.g * 0.72, a.elevColor.b * 0.72,
      b.elevColor.r * 0.72, b.elevColor.g * 0.72, b.elevColor.b * 0.72
    );
    climColors.push(
      skirtColor.r, skirtColor.g, skirtColor.b,
      a.climColor.r * 0.72, a.climColor.g * 0.72, a.climColor.b * 0.72,
      b.climColor.r * 0.72, b.climColor.g * 0.72, b.climColor.b * 0.72
    );

    positions.push(a.wx, 0, a.wz, b.wx, b.wy, b.wz, b.wx, 0, b.wz);
    elevColors.push(
      skirtColor.r, skirtColor.g, skirtColor.b,
      b.elevColor.r * 0.72, b.elevColor.g * 0.72, b.elevColor.b * 0.72,
      skirtColor.r, skirtColor.g, skirtColor.b
    );
    climColors.push(
      skirtColor.r, skirtColor.g, skirtColor.b,
      b.climColor.r * 0.72, b.climColor.g * 0.72, b.climColor.b * 0.72,
      skirtColor.r, skirtColor.g, skirtColor.b
    );
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cellInside[r][c]) continue;
      const n00 = nodes[r][c];
      const n10 = nodes[r][c + 1];
      const n01 = nodes[r + 1][c];
      const n11 = nodes[r + 1][c + 1];

      pushTri(n00, n10, n11);
      pushTri(n00, n11, n01);

      if (r === 0 || !cellInside[r - 1][c]) pushSkirt(n00, n10);
      if (r === rows - 1 || !cellInside[r + 1][c]) pushSkirt(n11, n01);
      if (c === 0 || !cellInside[r][c - 1]) pushSkirt(n01, n00);
      if (c === cols - 1 || !cellInside[r][c + 1]) pushSkirt(n10, n11);
    }
  }

  const geometry = new THREE.BufferGeometry();
  const elevationColors = new Float32Array(elevColors);
  const climateColors = new Float32Array(climColors);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(elevationColors), 3));
  geometry.computeVertexNormals();
  return { geometry, elevationColors, climateColors };
}
