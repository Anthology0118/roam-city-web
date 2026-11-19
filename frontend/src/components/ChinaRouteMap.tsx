import { geoMercator } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import chinaGeoJson from "china-map-geojson/lib/china.js";
import type { ItineraryPlan, PlanStop, Spot } from "../types";
import {
  buildExtrudedChinaProvinces,
  classifyChinaClimate,
  CLIMATE_LEGEND,
  getSpotWorldY,
  PROJ_H,
  PROJ_W,
  ProvinceExtrudedMeshData,
  sampleChinaElevationMeters,
  TerrainColorMode,
  toWorldXZ,
  WORLD_SCALE,
} from "../utils/chinaTerrain";

interface ChinaRouteMapProps {
  spots?: Spot[];
  plan?: ItineraryPlan | null;
  selectedSpotIds?: string[];
  onToggleSpot?: (spotId: string) => void;
  onInspectSpot?: (spotId: string) => void;
  height?: number;
}

const DAY_COLORS = ["#f97316", "#22d3ee", "#60a5fa", "#c084fc", "#34d399", "#fbbf24", "#fb7185"];

const KEY_PROVINCE_LABELS = [
  "新疆", "西藏", "青海", "甘肃", "内蒙古", "四川", "云南", "黑龙江",
  "陕西", "湖北", "广东", "北京", "浙江", "台湾", "山东", "广西",
];

// Geographic mountain range / basin labels for authentic relief cartography
const GEO_LANDFORMS: Array<{ name: string; lng: number; lat: number }> = [
  { name: "青藏高原", lng: 87.5, lat: 33.0 },
  { name: "塔里木盆地", lng: 83.2, lat: 39.2 },
  { name: "天山山脉", lng: 84.0, lat: 43.3 },
  { name: "四川盆地", lng: 105.5, lat: 30.5 },
  { name: "秦岭", lng: 108.2, lat: 33.9 },
  { name: "长白山", lng: 127.8, lat: 42.1 },
];

type OrderedStop = PlanStop & {
  seq: number;
  dayIdx: number;
  dayLabel: string;
  color: string;
  wx: number;
  wy: number;
  wz: number;
  elevMeters: number;
};

interface OverlayItem {
  key: string;
  worldPos: THREE.Vector3;
  kind: "stop" | "leg" | "selected" | "province" | "landform";
  seq?: number;
  label: string;
  color: string;
}

export function ChinaRouteMap({
  spots = [],
  plan = null,
  selectedSpotIds = [],
  onToggleSpot,
  onInspectSpot,
  height = 500,
}: ChinaRouteMapProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const onToggleRef = useRef(onToggleSpot);
  const onInspectRef = useRef(onInspectSpot);
  onToggleRef.current = onToggleSpot;
  onInspectRef.current = onInspectSpot;

  const [colorMode, setColorMode] = useState<TerrainColorMode>("elevation");
  const [showProvLabels, setShowProvLabels] = useState(true);
  const [hoverTerrain, setHoverTerrain] = useState<{
    province: string;
    elevMeters: number;
    provAvgMeters: number;
    climateLabel: string;
  } | null>(null);
  const [hoverStop, setHoverStop] = useState<{
    id: string;
    name: string;
    city: string;
    price: number;
    elevMeters: number;
    climateLabel: string;
    dayLabel?: string;
    scene?: string;
  } | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [webglError, setWebglError] = useState(false);

  const provinceRenderItemsRef = useRef<
    Array<{
      data: ProvinceExtrudedMeshData;
      mesh: THREE.Mesh;
      mat: THREE.MeshPhysicalMaterial;
      borders: Array<{ line: THREE.Line; mat: THREE.LineBasicMaterial }>;
    }>
  >([]);

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;
  const flyTargetRef = useRef<{ camPos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  const projection = useMemo(
    () =>
      geoMercator().fitExtent(
        [
          [24, 24],
          [PROJ_W - 24, PROJ_H - 24],
        ],
        chinaGeoJson
      ),
    []
  );

  const provinceAnchors = useMemo<OverlayItem[]>(() => {
    if (!showProvLabels) return [];
    const items: OverlayItem[] = [];
    for (const feat of chinaGeoJson.features) {
      const props = (feat.properties || {}) as unknown as Record<string, unknown>;
      const name = String(props.name || "");
      if (!KEY_PROVINCE_LABELS.includes(name)) continue;
      const cp: [number, number] = Array.isArray(props.cp)
        ? [Number(props.cp[0]), Number(props.cp[1])]
        : [Number(props.longitude || 105), Number(props.latitude || 35)];
      const pt = projection(cp);
      if (!pt) continue;
      const [wx, wz] = toWorldXZ(pt);
      const wy = getSpotWorldY(cp[0], cp[1]);
      items.push({
        key: `prov-${name}`,
        worldPos: new THREE.Vector3(wx, wy + 0.3, wz),
        kind: "province",
        label: name,
        color: "#94a3b8",
      });
    }
    for (const lf of GEO_LANDFORMS) {
      const pt = projection([lf.lng, lf.lat]);
      if (!pt) continue;
      const [wx, wz] = toWorldXZ(pt);
      const wy = getSpotWorldY(lf.lng, lf.lat);
      items.push({
        key: `lf-${lf.name}`,
        worldPos: new THREE.Vector3(wx, wy + 0.45, wz),
        kind: "landform",
        label: `⛰ ${lf.name}`,
        color: "#fde68a",
      });
    }
    return items;
  }, [projection, showProvLabels]);

  const orderedStops = useMemo<OrderedStop[]>(() => {
    if (!plan) return [];
    const list: OrderedStop[] = [];
    let seq = 1;
    plan.days.forEach((d, dayIdx) => {
      const color = DAY_COLORS[dayIdx % DAY_COLORS.length];
      d.stops.forEach((st) => {
        const pt = projection([st.lng, st.lat]);
        if (!pt) return;
        const [wx, wz] = toWorldXZ(pt);
        const elevMeters = sampleChinaElevationMeters(st.lng, st.lat);
        const wy = getSpotWorldY(st.lng, st.lat);
        list.push({
          ...st,
          seq: seq++,
          dayIdx,
          dayLabel: d.day,
          color,
          wx,
          wy,
          wz,
          elevMeters,
        });
      });
    });
    return list;
  }, [plan, projection]);

  const { overlayItems, routeLegs } = useMemo(() => {
    const items: OverlayItem[] = [];
    const legs: Array<{ curve: THREE.QuadraticBezierCurve3; color: string }> = [];

    // Put high-priority stop & leg badges first so collision resolver prioritizes them over background labels
    orderedStops.forEach((st, idx) => {
      items.push({
        key: `stop-${st.spot_id}`,
        worldPos: new THREE.Vector3(st.wx, st.wy + 4.1, st.wz),
        kind: "stop",
        seq: st.seq,
        label: st.name.split(" · ")[0],
        color: st.color,
      });

      if (idx > 0) {
        const prev = orderedStops[idx - 1];
        const p0 = new THREE.Vector3(prev.wx, prev.wy + 0.55, prev.wz);
        const p1 = new THREE.Vector3(st.wx, st.wy + 0.55, st.wz);
        const dist = p0.distanceTo(p1);
        const midLng = (prev.lng + st.lng) / 2;
        const midLat = (prev.lat + st.lat) / 2;
        const midTerrainY = getSpotWorldY(midLng, midLat);
        const arcPeak = Math.max(p0.y, p1.y, midTerrainY) + Math.min(14, Math.max(3.6, dist * 0.28));
        const pMid = new THREE.Vector3((p0.x + p1.x) / 2, arcPeak, (p0.z + p1.z) / 2);
        const curve = new THREE.QuadraticBezierCurve3(p0, pMid, p1);
        legs.push({ curve, color: st.color });

        if (st.distance_from_prev_km > 0) {
          items.push({
            key: `leg-${prev.spot_id}-${st.spot_id}`,
            worldPos: curve.getPoint(0.5).add(new THREE.Vector3(0, 1.05, 0)),
            kind: "leg",
            label: `${Math.round(st.distance_from_prev_km)}km`,
            color: st.color,
          });
        }
      }
    });

    if (orderedStops.length === 0) {
      const selSet = new Set(selectedSpotIds);
      spots.forEach((s) => {
        if (!selSet.has(s.id)) return;
        const pt = projection([s.lng, s.lat]);
        if (!pt) return;
        const [wx, wz] = toWorldXZ(pt);
        const wy = getSpotWorldY(s.lng, s.lat);
        items.push({
          key: `sel-${s.id}`,
          worldPos: new THREE.Vector3(wx, wy + 2.8, wz),
          kind: "selected",
          label: s.name.split(" · ")[0],
          color: "#f97316",
        });
      });
    }

    items.push(...provinceAnchors);

    return { overlayItems: items, routeLegs: legs };
  }, [orderedStops, selectedSpotIds, spots, projection, provinceAnchors]);

  const overlayRef = useRef<OverlayItem[]>(overlayItems);
  overlayRef.current = overlayItems;

  const sceneRefs = useRef<{
    dynamicGroup: THREE.Group;
    pulseRings: THREE.Mesh[];
    crystals: THREE.Mesh[];
    comet: THREE.Mesh;
    cometTrail: THREE.Mesh[];
    legs: Array<{ curve: THREE.QuadraticBezierCurve3; color: string }>;
  } | null>(null);

  // Initialize Three.js WebGL 3D seamless relief China map + studio lighting
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      setWebglError(true);
      return;
    }

    const w = container.clientWidth || 720;
    const h = container.clientHeight || height;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05131c, 0.0034);

    const camera = new THREE.PerspectiveCamera(37, w / h, 0.5, 500);
    camera.position.set(1.5, 55, 53);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.minPolarAngle = 0.08;
    controls.minDistance = 22;
    controls.maxDistance = 135;
    controls.target.set(0, 2.2, 1.5);
    controls.update();
    controlsRef.current = controls;

    // Cancel camera fly-to if user manually drags or zooms
    const cancelFly = () => {
      flyTargetRef.current = null;
    };
    controls.addEventListener("start", cancelFly);

    // Studio three-point lighting + subtle hemisphere sky fill for dramatic mountain relief shadows
    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x072336, 0.92));
    const sunLight = new THREE.DirectionalLight(0xfff7ed, 2.15);
    sunLight.position.set(46, 68, 36);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 180;
    const d = 55;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.92);
    rimLight.position.set(-58, 34, -44);
    scene.add(rimLight);

    // Architectural sandbox base pedestal + glowing compass radar rings
    const baseDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(57, 59, 0.4, 72),
      new THREE.MeshStandardMaterial({
        color: 0x061b26,
        roughness: 0.35,
        metalness: 0.35,
        transparent: true,
        opacity: 0.88,
      })
    );
    baseDisc.position.y = -0.24;
    baseDisc.receiveShadow = true;
    scene.add(baseDisc);

    const outerRing = new THREE.Mesh(
      new THREE.RingGeometry(52.2, 52.8, 96),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9, side: THREE.DoubleSide, transparent: true, opacity: 0.32 })
    );
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = -0.02;
    scene.add(outerRing);

    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(36.0, 36.35, 96),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide, transparent: true, opacity: 0.18 })
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = -0.02;
    scene.add(innerRing);

    const grid = new THREE.GridHelper(122, 24, 0x155e75, 0x092532);
    grid.position.y = -0.03;
    scene.add(grid);

    // 1. Seamless high-detail relief 3D provinces of China
    const provincesGroup = new THREE.Group();
    scene.add(provincesGroup);

    const extrudedProvinces = buildExtrudedChinaProvinces(chinaGeoJson, projection);
    const renderItems: typeof provinceRenderItemsRef.current = [];

    for (const pData of extrudedProvinces) {
      const colorAttr = pData.geometry.getAttribute("color") as THREE.BufferAttribute;
      const targetColors =
        colorMode === "climate"
          ? pData.climateColors
          : colorMode === "holo"
            ? pData.holoColors
            : pData.elevationColors;
      (colorAttr.array as Float32Array).set(targetColors);
      colorAttr.needsUpdate = true;

      const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.08,
        clearcoat: 0.22,
        clearcoatRoughness: 0.38,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(pData.geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = {
        kind: "province",
        provinceName: pData.name,
        meanElevMeters: pData.meanElevMeters,
        climateLabel: pData.climateLabel,
      };
      provincesGroup.add(mesh);

      const borders: Array<{ line: THREE.Line; mat: THREE.LineBasicMaterial }> = [];
      for (const pts of pData.borderLinePoints) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const lineMat = new THREE.LineBasicMaterial({
          color: 0xe0f2fe,
          transparent: true,
          opacity: 0.62,
        });
        const line = new THREE.Line(lineGeo, lineMat);
        provincesGroup.add(line);
        borders.push({ line, mat: lineMat });
      }

      renderItems.push({ data: pData, mesh, mat, borders });
    }
    provinceRenderItemsRef.current = renderItems;

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    const comet = new THREE.Mesh(
      new THREE.SphereGeometry(0.66, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    comet.visible = false;
    scene.add(comet);

    const cometTrail = [0.48, 0.34, 0.22, 0.12].map((radius, idx) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 12, 12),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.68 - idx * 0.15,
        })
      );
      m.visible = false;
      scene.add(m);
      return m;
    });

    sceneRefs.current = {
      dynamicGroup,
      pulseRings: [],
      crystals: [],
      comet,
      cometTrail,
      legs: [],
    };

    // Raycaster over spots + 3D province meshes
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };
    let hoveredProvName = "";

    function updatePointer(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerDown(e: PointerEvent) {
      downPos = { x: e.clientX, y: e.clientY };
    }

    function setHighlightedProvince(nextProv: string) {
      if (hoveredProvName === nextProv) return;
      hoveredProvName = nextProv;
      for (const item of provinceRenderItemsRef.current) {
        const active = nextProv !== "" && item.data.name === nextProv;
        item.mat.emissive.setHex(active ? 0x0ea5e9 : 0x000000);
        item.mat.emissiveIntensity = active ? 0.3 : 0;
        for (const b of item.borders) {
          b.mat.color.setHex(active ? 0xfbbf24 : 0xe0f2fe);
          b.mat.opacity = active ? 1.0 : 0.62;
          b.line.position.y = active ? 0.36 : 0;
        }
      }
    }

    function onPointerMove(e: PointerEvent) {
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);

      const spotHits = raycaster.intersectObjects(dynamicGroup.children, true);
      const hitSpotObj = spotHits.find((h) => h.object.userData?.kind === "spot");
      if (hitSpotObj) {
        const d = hitSpotObj.object.userData;
        renderer.domElement.style.cursor = "pointer";
        setHoverStop({
          id: d.spotId,
          name: d.name,
          city: d.city,
          price: d.price,
          elevMeters: d.elevMeters,
          climateLabel: d.climateLabel,
          dayLabel: d.dayLabel,
          scene: d.scene,
        });
      } else {
        setHoverStop(null);
        renderer.domElement.style.cursor = "grab";
      }

      const provMeshes = provinceRenderItemsRef.current.map((it) => it.mesh);
      const provHits = raycaster.intersectObjects(provMeshes, false);
      if (provHits.length > 0) {
        const hit = provHits[0];
        const pName = String(hit.object.userData?.provinceName || "");
        const provAvg = Number(hit.object.userData?.meanElevMeters || 500);
        const p3 = hit.point;
        const projX = p3.x / WORLD_SCALE + PROJ_W / 2;
        const projY = p3.z / WORLD_SCALE + PROJ_H / 2;
        const lonLat = projection.invert ? projection.invert([projX, projY]) : null;
        const elevMeters = lonLat ? sampleChinaElevationMeters(lonLat[0], lonLat[1]) : provAvg;
        const climateLabel = lonLat
          ? classifyChinaClimate(lonLat[0], lonLat[1], elevMeters).label
          : String(hit.object.userData?.climateLabel || "");

        setHighlightedProvince(pName);
        setHoverTerrain({
          province: pName,
          elevMeters,
          provAvgMeters: provAvg,
          climateLabel,
        });
        return;
      }

      setHighlightedProvince("");
      setHoverTerrain(null);
    }

    function onPointerUp(e: PointerEvent) {
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (moved > 6) return;
      updatePointer(e);
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(dynamicGroup.children, true);
      const hitSpot = hits.find((h) => h.object.userData?.kind === "spot");
      if (hitSpot) {
        const d = hitSpot.object.userData;
        // Smooth camera fly-to focus around clicked spot
        if (typeof d.wx === "number" && typeof d.wz === "number") {
          const target = new THREE.Vector3(d.wx * 0.45, 2.4, d.wz * 0.45);
          const camPos = new THREE.Vector3(d.wx * 0.55 + 2, 46, d.wz * 0.55 + 42);
          flyTargetRef.current = { camPos, target };
        }
        if (d.planned) {
          onInspectRef.current?.(d.spotId);
        } else {
          onToggleRef.current?.(d.spotId);
          onInspectRef.current?.(d.spotId);
        }
      }
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const nw = container.clientWidth || 720;
      const nh = container.clientHeight || height;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(container);

    let rafId = 0;
    const clock = new THREE.Clock();
    const tmpVec = new THREE.Vector3();

    function animate() {
      rafId = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      if (flyTargetRef.current) {
        camera.position.lerp(flyTargetRef.current.camPos, 0.08);
        controls.target.lerp(flyTargetRef.current.target, 0.08);
        if (camera.position.distanceTo(flyTargetRef.current.camPos) < 0.25) {
          flyTargetRef.current = null;
        }
      }

      controls.autoRotate = autoRotateRef.current;
      controls.autoRotateSpeed = 0.85;
      controls.update();

      // Smoothly lift hovered province mesh for interactive 3D feedback
      for (const item of provinceRenderItemsRef.current) {
        const targetY = hoveredProvName !== "" && item.data.name === hoveredProvName ? 0.36 : 0;
        item.mesh.position.y += (targetY - item.mesh.position.y) * 0.18;
      }

      const activeRefs = sceneRefs.current;
      if (activeRefs) {
        activeRefs.pulseRings.forEach((ring, idx) => {
          const s = 1 + 0.48 * Math.sin(elapsed * 3.2 + idx * 0.8);
          ring.scale.set(s, s, 1);
        });

        activeRefs.crystals.forEach((crystal, idx) => {
          crystal.rotation.y = elapsed * 1.8 + idx * 0.7;
        });

        if (activeRefs.legs.length > 0) {
          activeRefs.comet.visible = true;
          const totalDuration = activeRefs.legs.length * 1.45;
          const progress = ((elapsed % totalDuration) / totalDuration) * activeRefs.legs.length;
          const legIdx = Math.min(activeRefs.legs.length - 1, Math.floor(progress));
          const t = progress - legIdx;
          const leg = activeRefs.legs[legIdx];
          leg.curve.getPoint(t, activeRefs.comet.position);
          (activeRefs.comet.material as THREE.MeshBasicMaterial).color.set(leg.color);

          activeRefs.cometTrail.forEach((trailMesh, idx) => {
            trailMesh.visible = true;
            const trailT = Math.max(0, t - (idx + 1) * 0.048);
            leg.curve.getPoint(trailT, trailMesh.position);
            (trailMesh.material as THREE.MeshBasicMaterial).color.set(leg.color);
          });
        } else {
          activeRefs.comet.visible = false;
          activeRefs.cometTrail.forEach((m) => {
            m.visible = false;
          });
        }
      }

      renderer.render(scene, camera);

      // Screen-space projection with smart collision avoidance so labels never overlap
      const cw = container?.clientWidth || 0;
      const ch = container?.clientHeight || 0;
      if (cw > 0 && ch > 0) {
        const occupiedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number; kind: OverlayItem["kind"] }> = [];

        for (const item of overlayRef.current) {
          const el = labelRefs.current[item.key];
          if (!el) continue;
          tmpVec.copy(item.worldPos).project(camera);
          if (tmpVec.z > 1 || tmpVec.z < -1) {
            el.style.display = "none";
            continue;
          }
          let sx = (tmpVec.x * 0.5 + 0.5) * cw;
          let sy = (-tmpVec.y * 0.5 + 0.5) * ch;

          const boxW =
            item.kind === "stop" || item.kind === "selected"
              ? 82
              : item.kind === "leg"
                ? 50
                : 46;
          const boxH = item.kind === "stop" || item.kind === "selected" ? 26 : 19;

          // If background province/landform label collides with any placed route badge, hide it cleanly
          if (item.kind === "province" || item.kind === "landform") {
            const x1 = sx - boxW / 2;
            const y1 = sy - boxH;
            const x2 = sx + boxW / 2;
            const y2 = sy;
            const hit = occupiedBoxes.some(
              (b) => !(x2 < b.x1 - 4 || x1 > b.x2 + 4 || y2 < b.y1 - 3 || y1 > b.y2 + 3)
            );
            if (hit) {
              el.style.display = "none";
              continue;
            }
            occupiedBoxes.push({ x1, y1, x2, y2, kind: item.kind });
            el.style.display = "flex";
            el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -100%)`;
            continue;
          }

          // For stop/leg badges, nudge vertically/horizontally if overlapping another stop/leg badge
          const candidateOffsets: Array<[number, number]> = [
            [0, 0],
            [0, -24],
            [28, -14],
            [-28, -14],
            [0, 22],
            [38, 8],
            [-38, 8],
          ];
          let chosenX = sx;
          let chosenY = sy;
          for (const [ox, oy] of candidateOffsets) {
            const tx = sx + ox;
            const ty = sy + oy;
            const x1 = tx - boxW / 2;
            const y1 = ty - boxH;
            const x2 = tx + boxW / 2;
            const y2 = ty;
            const hit = occupiedBoxes.some(
              (b) => !(x2 < b.x1 - 3 || x1 > b.x2 + 3 || y2 < b.y1 - 2 || y1 > b.y2 + 2)
            );
            if (!hit) {
              chosenX = tx;
              chosenY = ty;
              break;
            }
          }

          occupiedBoxes.push({
            x1: chosenX - boxW / 2,
            y1: chosenY - boxH,
            x2: chosenX + boxW / 2,
            y2: chosenY,
            kind: item.kind,
          });
          el.style.display = "flex";
          el.style.transform = `translate3d(${chosenX}px, ${chosenY}px, 0) translate(-50%, -100%)`;
        }
      }
    }

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      controls.removeEventListener("start", cancelFly);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
      for (const item of provinceRenderItemsRef.current) {
        item.data.geometry.dispose();
        item.mat.dispose();
        item.borders.forEach((b) => {
          b.line.geometry.dispose();
          b.mat.dispose();
        });
      }
      provinceRenderItemsRef.current = [];
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [projection, height]);

  // Swap vertex color buffer on GPU (<1ms) when switching Elevation <-> Climate <-> Holo layer
  useEffect(() => {
    for (const item of provinceRenderItemsRef.current) {
      const attr = item.data.geometry.getAttribute("color") as THREE.BufferAttribute;
      const targetColors =
        colorMode === "climate"
          ? item.data.climateColors
          : colorMode === "holo"
            ? item.data.holoColors
            : item.data.elevationColors;
      (attr.array as Float32Array).set(targetColors);
      attr.needsUpdate = true;
    }
  }, [colorMode]);

  // Rebuild 3D spot crystal beacons anchored onto seamless terrain elevation + parabolic Bezier arcs
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const { dynamicGroup } = refs;

    while (dynamicGroup.children.length > 0) {
      dynamicGroup.remove(dynamicGroup.children[0]);
    }
    refs.pulseRings = [];
    refs.crystals = [];
    refs.legs = routeLegs;

    const activeIds = new Set(orderedStops.map((s) => s.spot_id));
    const selectedSet = new Set(selectedSpotIds);
    const spotMap = new Map(spots.map((s) => [s.id, s]));

    spots.forEach((s) => {
      if (activeIds.has(s.id)) return;
      const pt = projection([s.lng, s.lat]);
      if (!pt) return;
      const [wx, wz] = toWorldXZ(pt);
      const elevMeters = sampleChinaElevationMeters(s.lng, s.lat);
      const climateLabel = classifyChinaClimate(s.lng, s.lat, elevMeters).label;
      const baseY = getSpotWorldY(s.lng, s.lat);
      const isSel = selectedSet.has(s.id);

      const h = isSel ? 2.3 : 1.05;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(isSel ? 0.32 : 0.19, isSel ? 0.42 : 0.26, h, 16),
        new THREE.MeshStandardMaterial({
          color: isSel ? 0xf97316 : 0x2dd4bf,
          emissive: isSel ? 0xc2410c : 0x0f766e,
          emissiveIntensity: 0.55,
          roughness: 0.25,
        })
      );
      pillar.position.set(wx, baseY + h / 2, wz);
      pillar.userData = {
        kind: "spot",
        planned: false,
        spotId: s.id,
        name: s.name,
        city: s.city,
        price: s.price,
        elevMeters,
        climateLabel,
        scene: s.scene,
        wx,
        wz,
      };
      dynamicGroup.add(pillar);

      const cap = new THREE.Mesh(
        new THREE.OctahedronGeometry(isSel ? 0.52 : 0.34, 0),
        new THREE.MeshStandardMaterial({
          color: isSel ? 0xfed7aa : 0x99f6e4,
          emissive: isSel ? 0xf97316 : 0x14b8a6,
          emissiveIntensity: 0.45,
          roughness: 0.15,
        })
      );
      cap.position.set(wx, baseY + h + 0.22, wz);
      cap.userData = pillar.userData;
      dynamicGroup.add(cap);
      if (isSel) refs.crystals.push(cap);
    });

    orderedStops.forEach((st) => {
      const h = 3.15;
      const fullSpot = spotMap.get(st.spot_id);
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.52, h, 18),
        new THREE.MeshStandardMaterial({
          color: st.color,
          emissive: st.color,
          emissiveIntensity: 0.65,
          roughness: 0.2,
        })
      );
      beacon.position.set(st.wx, st.wy + h / 2, st.wz);
      beacon.userData = {
        kind: "spot",
        planned: true,
        spotId: st.spot_id,
        name: st.name,
        city: st.city,
        price: st.price,
        elevMeters: st.elevMeters,
        climateLabel: classifyChinaClimate(st.lng, st.lat, st.elevMeters).label,
        dayLabel: st.dayLabel,
        scene: st.scene || fullSpot?.scene,
        wx: st.wx,
        wz: st.wz,
      };
      dynamicGroup.add(beacon);

      const crystalHead = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.68, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: st.color,
          emissiveIntensity: 0.55,
          roughness: 0.1,
          metalness: 0.2,
        })
      );
      crystalHead.position.set(st.wx, st.wy + h + 0.36, st.wz);
      crystalHead.userData = beacon.userData;
      dynamicGroup.add(crystalHead);
      refs.crystals.push(crystalHead);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1.24, 28),
        new THREE.MeshBasicMaterial({ color: st.color, side: THREE.DoubleSide, transparent: true, opacity: 0.88 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(st.wx, st.wy + 0.14, st.wz);
      dynamicGroup.add(ring);
      refs.pulseRings.push(ring);
    });

    routeLegs.forEach((leg) => {
      const tubeGeo = new THREE.TubeGeometry(leg.curve, 48, 0.22, 10, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: leg.color,
        emissive: leg.color,
        emissiveIntensity: 0.55,
        roughness: 0.2,
      });
      dynamicGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
    });
  }, [spots, selectedSpotIds, orderedStops, routeLegs, projection]);

  function setCameraPreset(mode: "3d" | "top") {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    if (mode === "3d") {
      flyTargetRef.current = {
        camPos: new THREE.Vector3(1.5, 55, 53),
        target: new THREE.Vector3(0, 2.2, 1.5),
      };
    } else {
      flyTargetRef.current = {
        camPos: new THREE.Vector3(0, 84, 0.01),
        target: new THREE.Vector3(0, 2.2, 1.5),
      };
    }
  }

  function stepZoom(factor: number) {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    flyTargetRef.current = null;
    const offset = cam.position.clone().sub(ctrl.target);
    offset.multiplyScalar(factor);
    const len = offset.length();
    if (len < 22) offset.setLength(22);
    if (len > 135) offset.setLength(135);
    cam.position.copy(ctrl.target).add(offset);
    ctrl.update();
  }

  return (
    <div
      style={{
        position: "relative",
        background: "radial-gradient(circle at 50% 35%, #1e1b4b 0%, #0f172a 62%, #090d16 100%)",
        border: "1px solid rgba(99, 102, 241, 0.32)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 18px 42px rgba(15, 23, 42, 0.3)",
      }}
    >
      {/* Top Floating HUD */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 14,
          right: 14,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          pointerEvents: "none",
          zIndex: 5,
        }}
      >
        <div
          style={{
            background: "rgba(6, 22, 31, 0.88)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(103, 232, 249, 0.38)",
            borderRadius: 999,
            padding: "4px 12px",
            fontSize: "0.75rem",
            color: "#cffafe",
            fontWeight: 600,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}
        >
          {hoverTerrain
            ? `⛰️ ${hoverTerrain.province} · 实时海拔 ~${hoverTerrain.elevMeters}m（省均 ${hoverTerrain.provAvgMeters}m）· ${hoverTerrain.climateLabel}`
            : colorMode === "elevation"
              ? "⛰️ Three.js 无缝浮雕山脉 · 三级阶梯海拔沙盘"
              : colorMode === "climate"
                ? "🌦️ Three.js 无缝浮雕山脉 · 五大气候环境沙盘"
                : "🌌 Three.js 无缝浮雕山脉 · 科技全息流光沙盘"}
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", pointerEvents: "auto", background: "rgba(15, 23, 42, 0.82)", padding: "3px 4px", borderRadius: 10, border: "1px solid rgba(148, 163, 184, 0.25)", backdropFilter: "blur(10px)" }}>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.73rem",
              background: colorMode === "elevation" ? "linear-gradient(135deg, #4f46e5, #6366f1)" : "transparent",
              color: colorMode === "elevation" ? "#ffffff" : "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => setColorMode("elevation")}
          >
            海拔阶梯
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.73rem",
              background: colorMode === "climate" ? "linear-gradient(135deg, #4f46e5, #6366f1)" : "transparent",
              color: colorMode === "climate" ? "#ffffff" : "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => setColorMode("climate")}
          >
            气候带
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.73rem",
              background: colorMode === "holo" ? "linear-gradient(135deg, #4f46e5, #6366f1)" : "transparent",
              color: colorMode === "holo" ? "#ffffff" : "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => setColorMode("holo")}
          >
            星夜全息
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.73rem",
              background: showProvLabels ? "rgba(99, 102, 241, 0.28)" : "transparent",
              color: showProvLabels ? "#e0e7ff" : "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => setShowProvLabels((v) => !v)}
          >
            地名
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.73rem",
              background: autoRotate ? "rgba(99, 102, 241, 0.28)" : "transparent",
              color: autoRotate ? "#e0e7ff" : "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => setAutoRotate((r) => !r)}
          >
            {autoRotate ? "⏸ 停转" : "🔄 巡航"}
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 9px",
              fontSize: "0.73rem",
              background: "transparent",
              color: "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => setCameraPreset("3d")}
          >
            3D
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 9px",
              fontSize: "0.73rem",
              background: "transparent",
              color: "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => setCameraPreset("top")}
          >
            顶视
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 9px",
              fontSize: "0.8rem",
              background: "transparent",
              color: "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => stepZoom(0.8)}
          >
            +
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 9px",
              fontSize: "0.8rem",
              background: "transparent",
              color: "#cbd5e1",
              borderColor: "transparent",
            }}
            onClick={() => stepZoom(1.25)}
          >
            −
          </button>
        </div>
      </div>

      {/* Three.js Canvas Mount + Screen-Space Collision-Free Labels Overlay */}
      <div style={{ position: "relative", width: "100%", height }}>
        <div ref={mountRef} style={{ width: "100%", height: "100%" }} />

        {webglError && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#cffafe",
              padding: 20,
              textAlign: "center",
            }}
          >
            当前浏览器环境未开启 WebGL 硬件加速，请启用 WebGL 后查看 3D 中国地形沙盘。
          </div>
        )}

        {/* Crisp HTML labels projected from 3D anchor coordinates with collision avoidance */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 3 }}>
          {overlayItems.map((item) => {
            if (item.kind === "province" || item.kind === "landform") {
              const isLf = item.kind === "landform";
              return (
                <div
                  key={item.key}
                  ref={(el) => {
                    labelRefs.current[item.key] = el;
                  }}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    display: "none",
                    fontSize: isLf ? "0.64rem" : "0.67rem",
                    fontWeight: isLf ? 700 : 600,
                    color: isLf ? "rgba(253, 230, 138, 0.85)" : "rgba(224, 242, 254, 0.72)",
                    textShadow: "0 1px 4px rgba(0, 0, 0, 0.92)",
                    letterSpacing: "0.5px",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </div>
              );
            }
            return (
              <div
                key={item.key}
                ref={(el) => {
                  labelRefs.current[item.key] = el;
                }}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  display: "none",
                  alignItems: "center",
                  gap: 4,
                  padding: item.kind === "leg" ? "1px 7px" : "3px 10px",
                  borderRadius: 999,
                  fontSize: item.kind === "leg" ? "0.68rem" : "0.75rem",
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  background: item.kind === "leg" ? "rgba(7, 25, 35, 0.92)" : item.color,
                  color: item.kind === "leg" ? item.color : "#ffffff",
                  border: item.kind === "leg" ? `1px solid ${item.color}` : "1.5px solid #ffffff",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.45)",
                }}
              >
                {item.seq !== undefined && <span>{item.seq}.</span>}
                <span>{item.label}</span>
              </div>
            );
          })}
        </div>

        {/* Floating Spot Preview Card on 3D Pillar Hover */}
        {hoverStop && (
          <div
            style={{
              position: "absolute",
              top: 52,
              right: 14,
              width: 230,
              background: "rgba(7, 24, 34, 0.92)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(103, 232, 249, 0.45)",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 12px 28px rgba(0,0,0,0.5)",
              color: "#f8fafc",
              pointerEvents: "none",
              zIndex: 6,
            }}
          >
            {hoverStop.scene && (
              <img
                src={`/scenes/${hoverStop.scene}`}
                alt={hoverStop.name}
                style={{ width: "100%", height: 108, objectFit: "cover", display: "block" }}
              />
            )}
            <div style={{ padding: "8px 10px", fontSize: "0.75rem", lineHeight: 1.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
                <strong style={{ fontSize: "0.82rem", color: "#fff" }}>{hoverStop.name}</strong>
                <span style={{ color: "#fb923c", fontWeight: 700 }}>
                  {hoverStop.price === 0 ? "免费" : `¥${hoverStop.price}`}
                </span>
              </div>
              <div style={{ color: "#94a3b8", marginTop: 2 }}>
                📍 {hoverStop.city} · 海拔 ~{hoverStop.elevMeters}m
              </div>
              <div style={{ color: "#67e8f9", marginTop: 2 }}>
                {hoverStop.dayLabel ? `🗓️ ${hoverStop.dayLabel} · ` : ""}
                {hoverStop.climateLabel}
              </div>
            </div>
          </div>
        )}

        {/* Dynamic Elevation / Climate / Holo Legend Box */}
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(6, 22, 31, 0.88)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(103, 232, 249, 0.3)",
            color: "#cbd5e1",
            fontSize: "0.69rem",
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          {colorMode === "climate" ? (
            <>
              <div style={{ fontWeight: 700, color: "#e0f2fe", marginBottom: 4 }}>中国五大气候环境带</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "4px 12px" }}>
                {CLIMATE_LEGEND.map((item) => (
                  <span key={item.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 2,
                        background: item.color,
                        display: "inline-block",
                      }}
                    />
                    {item.label}
                  </span>
                ))}
              </div>
            </>
          ) : colorMode === "holo" ? (
            <>
              <div style={{ fontWeight: 700, color: "#e0f2fe", marginBottom: 4 }}>全息高程能级（m）</div>
              <div
                style={{
                  width: 156,
                  height: 8,
                  borderRadius: 4,
                  background: "linear-gradient(90deg, #1e1b4b 0%, #312e81 25%, #4f46e5 50%, #06b6d4 72%, #38bdf8 88%, #f8fafc 100%)",
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: "0.64rem" }}>
                <span>平原</span>
                <span>丘陵</span>
                <span>高原</span>
                <span>极高山</span>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, color: "#e0f2fe", marginBottom: 4 }}>三级阶梯海拔高度（m）</div>
              <div
                style={{
                  width: 156,
                  height: 8,
                  borderRadius: 4,
                  background: "linear-gradient(90deg, #1e3a8a 0%, #2563eb 20%, #0284c7 40%, #38bdf8 62%, #f59e0b 80%, #f8fafc 100%)",
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: "0.64rem" }}>
                <span>50m</span>
                <span>1500m</span>
                <span>3000m</span>
                <span>4600m+</span>
              </div>
            </>
          )}
        </div>

        {/* South China Sea Inset */}
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 78,
            padding: "6px 7px",
            borderRadius: 10,
            background: "rgba(6, 22, 31, 0.86)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(103, 232, 249, 0.35)",
            color: "#a5f3fc",
            fontSize: "0.66rem",
            textAlign: "center",
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 2 }}>南海诸岛</div>
          <svg viewBox="0 0 60 44" style={{ width: "100%", display: "block" }}>
            <path
              d="M12 10 Q10 24 16 34 M24 38 Q34 42 44 36 M50 30 Q54 20 52 10"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.4"
              strokeDasharray="4 3"
            />
            <circle cx="28" cy="20" r="1.8" fill="#22d3ee" />
            <circle cx="38" cy="27" r="1.6" fill="#22d3ee" />
          </svg>
        </div>
      </div>

      {/* Bottom legend & hover tooltip */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
          padding: "9px 16px",
          borderTop: "1px solid rgba(56, 189, 248, 0.25)",
          background: "rgba(6, 20, 29, 0.95)",
          color: "#cbd5e1",
          fontSize: "0.8rem",
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
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
                    boxShadow: `0 0 8px ${DAY_COLORS[i % DAY_COLORS.length]}`,
                  }}
                />
                <b style={{ color: "#f8fafc" }}>{d.day}</b>（{d.stops.length}站）
              </span>
            ))
          ) : (
            <span>🖱️ 悬停省份浮动高亮 · 点击水晶光柱平滑飞跃聚焦 · 拖拽旋转</span>
          )}
        </div>
        {hoverStop && (
          <div style={{ color: "#67e8f9", fontWeight: 600 }}>
            {hoverStop.dayLabel ? `[${hoverStop.dayLabel}] ` : ""}
            {hoverStop.name} · {hoverStop.city} · {hoverStop.price === 0 ? "免费" : `¥${hoverStop.price}`}
          </div>
        )}
      </div>
    </div>
  );
}
