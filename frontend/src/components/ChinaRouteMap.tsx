import { geoContains, geoMercator } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import chinaGeoJson from "china-map-geojson/lib/china.js";
import type { ItineraryPlan, PlanStop, Spot } from "../types";
import {
  buildChinaTerrainGeometry,
  classifyChinaClimate,
  CLIMATE_LEGEND,
  elevationToWorldY,
  PROVINCE_MEAN_ELEVATION,
  PROJ_H,
  PROJ_W,
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
  kind: "stop" | "leg" | "selected";
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
  height = 480,
}: ChinaRouteMapProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const onToggleRef = useRef(onToggleSpot);
  const onInspectRef = useRef(onInspectSpot);
  onToggleRef.current = onToggleSpot;
  onInspectRef.current = onInspectSpot;

  const [colorMode, setColorMode] = useState<TerrainColorMode>("climate");
  const [hoverTerrain, setHoverTerrain] = useState<{
    province: string;
    elevMeters: number;
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
  } | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [webglError, setWebglError] = useState(false);

  const terrainColorDataRef = useRef<{
    geometry: THREE.BufferGeometry;
    elevationColors: Float32Array;
    climateColors: Float32Array;
  } | null>(null);

  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

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
        const wy = elevationToWorldY(elevMeters);
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

    orderedStops.forEach((st, idx) => {
      items.push({
        key: `stop-${st.spot_id}`,
        worldPos: new THREE.Vector3(st.wx, st.wy + 3.9, st.wz),
        kind: "stop",
        seq: st.seq,
        label: st.name.split(" · ")[0],
        color: st.color,
      });

      if (idx > 0) {
        const prev = orderedStops[idx - 1];
        const p0 = new THREE.Vector3(prev.wx, prev.wy + 0.5, prev.wz);
        const p1 = new THREE.Vector3(st.wx, st.wy + 0.5, st.wz);
        const dist = p0.distanceTo(p1);
        const midLng = (prev.lng + st.lng) / 2;
        const midLat = (prev.lat + st.lat) / 2;
        const midTerrainY = elevationToWorldY(sampleChinaElevationMeters(midLng, midLat));
        const arcPeak = Math.max(p0.y, p1.y, midTerrainY) + Math.min(14, Math.max(3.4, dist * 0.28));
        const pMid = new THREE.Vector3((p0.x + p1.x) / 2, arcPeak, (p0.z + p1.z) / 2);
        const curve = new THREE.QuadraticBezierCurve3(p0, pMid, p1);
        legs.push({ curve, color: st.color });

        if (st.distance_from_prev_km > 0) {
          items.push({
            key: `leg-${prev.spot_id}-${st.spot_id}`,
            worldPos: curve.getPoint(0.5).add(new THREE.Vector3(0, 1.0, 0)),
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
        const wy = elevationToWorldY(sampleChinaElevationMeters(s.lng, s.lat));
        items.push({
          key: `sel-${s.id}`,
          worldPos: new THREE.Vector3(wx, wy + 2.7, wz),
          kind: "selected",
          label: s.name.split(" · ")[0],
          color: "#f97316",
        });
      });
    }

    return { overlayItems: items, routeLegs: legs };
  }, [orderedStops, selectedSpotIds, spots, projection]);

  const overlayRef = useRef<OverlayItem[]>(overlayItems);
  overlayRef.current = overlayItems;

  const sceneRefs = useRef<{
    dynamicGroup: THREE.Group;
    pulseRings: THREE.Mesh[];
    comet: THREE.Mesh;
    legs: Array<{ curve: THREE.QuadraticBezierCurve3; color: string }>;
  } | null>(null);

  // Initialize Three.js WebGL 3D relief terrain + draped province borders once
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
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(40, w / h, 0.5, 500);
    camera.position.set(4, 54, 56);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minPolarAngle = 0.08;
    controls.minDistance = 24;
    controls.maxDistance = 138;
    controls.target.set(0, 2.5, 2);
    controls.update();
    controlsRef.current = controls;

    // Directional alpine sunlight + cool skylight fill so ridges cast natural relief shading
    scene.add(new THREE.AmbientLight(0xdaf4f8, 1.0));
    const sunLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
    sunLight.position.set(48, 72, 34);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(1024, 1024);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.72);
    rimLight.position.set(-55, 36, -42);
    scene.add(rimLight);

    // Spatial coordinate reference grid
    const grid = new THREE.GridHelper(132, 26, 0x1e6073, 0x0f303c);
    grid.position.y = -0.04;
    scene.add(grid);

    // 1. Displaced 3D China Elevation Relief Terrain Mesh (supports Elevation & Climate color layers)
    const { geometry: terrainGeo, elevationColors, climateColors } = buildChinaTerrainGeometry(
      chinaGeoJson,
      projection
    );
    terrainColorDataRef.current = { geometry: terrainGeo, elevationColors, climateColors };
    const colorAttr = terrainGeo.getAttribute("color") as THREE.BufferAttribute;
    (colorAttr.array as Float32Array).set(colorMode === "climate" ? climateColors : elevationColors);
    colorAttr.needsUpdate = true;

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.72,
      metalness: 0.08,
      flatShading: false,
      side: THREE.DoubleSide,
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // 2. Draped provincial border lines resting directly on top of the terrain elevation
    const provinceLines: Array<{ name: string; line: THREE.Line; mat: THREE.LineBasicMaterial }> = [];
    chinaGeoJson.features.forEach((feat) => {
      const geom = feat.geometry;
      const provName = feat.properties?.name || "";
      const polygons =
        geom.type === "Polygon"
          ? [geom.coordinates as number[][][]]
          : geom.type === "MultiPolygon"
            ? (geom.coordinates as number[][][][])
            : [];

      for (const poly of polygons) {
        const ring = poly[0];
        if (!ring || ring.length < 3) continue;
        const pts: THREE.Vector3[] = [];
        for (const coord of ring) {
          const p = projection([coord[0], coord[1]]);
          if (!p) continue;
          const [wx, wz] = toWorldXZ(p);
          const wy = elevationToWorldY(sampleChinaElevationMeters(coord[0], coord[1])) + 0.08;
          pts.push(new THREE.Vector3(wx, wy, wz));
        }
        if (pts.length > 2) {
          pts.push(pts[0].clone());
          const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
          const lineMat = new THREE.LineBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.48 });
          const line = new THREE.Line(lineGeo, lineMat);
          scene.add(line);
          provinceLines.push({ name: provName, line, mat: lineMat });
        }
      }
    });

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    const comet = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    comet.visible = false;
    scene.add(comet);

    sceneRefs.current = {
      dynamicGroup,
      pulseRings: [],
      comet,
      legs: [],
    };

    // Raycaster over spots + 3D relief terrain (exact geo inverse lookup avoids parallax drift)
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };

    function updatePointer(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    }

    function onPointerDown(e: PointerEvent) {
      downPos = { x: e.clientX, y: e.clientY };
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
        });
      } else {
        setHoverStop(null);
        renderer.domElement.style.cursor = "grab";
      }

      const terrainHits = raycaster.intersectObject(terrainMesh, false);
      if (terrainHits.length > 0 && projection.invert) {
        const p3 = terrainHits[0].point;
        const projX = p3.x / WORLD_SCALE + PROJ_W / 2;
        const projY = p3.z / WORLD_SCALE + PROJ_H / 2;
        const lonLat = projection.invert([projX, projY]);
        if (lonLat) {
          const elevMeters = sampleChinaElevationMeters(lonLat[0], lonLat[1]);
          const climateLabel = classifyChinaClimate(lonLat[0], lonLat[1], elevMeters).label;
          let prov = "";
          for (const feat of chinaGeoJson.features) {
            if (geoContains(feat, lonLat)) {
              prov = feat.properties?.name || "";
              break;
            }
          }
          setHoverTerrain(prov ? { province: prov, elevMeters, climateLabel } : null);
          provinceLines.forEach((pl) => {
            const active = prov !== "" && pl.name === prov;
            pl.mat.color.setHex(active ? 0xfbbf24 : 0xe0f2fe);
            pl.mat.opacity = active ? 0.95 : 0.42;
          });
          return;
        }
      }
      setHoverTerrain(null);
      provinceLines.forEach((pl) => {
        pl.mat.color.setHex(0xe0f2fe);
        pl.mat.opacity = 0.48;
      });
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

      controls.autoRotate = autoRotateRef.current;
      controls.autoRotateSpeed = 0.85;
      controls.update();

      const activeRefs = sceneRefs.current;
      if (activeRefs) {
        activeRefs.pulseRings.forEach((ring, idx) => {
          const s = 1 + 0.45 * Math.sin(elapsed * 3.2 + idx * 0.8);
          ring.scale.set(s, s, 1);
        });

        if (activeRefs.legs.length > 0) {
          activeRefs.comet.visible = true;
          const totalDuration = activeRefs.legs.length * 1.4;
          const progress = ((elapsed % totalDuration) / totalDuration) * activeRefs.legs.length;
          const legIdx = Math.min(activeRefs.legs.length - 1, Math.floor(progress));
          const t = progress - legIdx;
          const leg = activeRefs.legs[legIdx];
          leg.curve.getPoint(t, activeRefs.comet.position);
          (activeRefs.comet.material as THREE.MeshBasicMaterial).color.set(leg.color);
        } else {
          activeRefs.comet.visible = false;
        }
      }

      renderer.render(scene, camera);

      const cw = container?.clientWidth || 0;
      const ch = container?.clientHeight || 0;
      if (cw > 0 && ch > 0) {
        for (const item of overlayRef.current) {
          const el = labelRefs.current[item.key];
          if (!el) continue;
          tmpVec.copy(item.worldPos).project(camera);
          if (tmpVec.z > 1 || tmpVec.z < -1) {
            el.style.display = "none";
            continue;
          }
          const sx = (tmpVec.x * 0.5 + 0.5) * cw;
          const sy = (-tmpVec.y * 0.5 + 0.5) * ch;
          el.style.display = "flex";
          el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -100%)`;
        }
      }
    }

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      renderer.dispose();
      terrainGeo.dispose();
      terrainMat.dispose();
      terrainColorDataRef.current = null;
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [projection, height]);

  // Swap vertex color buffer on GPU (<1ms) when switching Elevation <-> Climate layer
  useEffect(() => {
    const data = terrainColorDataRef.current;
    if (!data) return;
    const attr = data.geometry.getAttribute("color") as THREE.BufferAttribute;
    (attr.array as Float32Array).set(colorMode === "climate" ? data.climateColors : data.elevationColors);
    attr.needsUpdate = true;
  }, [colorMode]);

  // Rebuild 3D spot pillars anchored onto actual terrain elevation + parabolic Bezier arcs
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const { dynamicGroup } = refs;

    while (dynamicGroup.children.length > 0) {
      dynamicGroup.remove(dynamicGroup.children[0]);
    }
    refs.pulseRings = [];
    refs.legs = routeLegs;

    const activeIds = new Set(orderedStops.map((s) => s.spot_id));
    const selectedSet = new Set(selectedSpotIds);

    spots.forEach((s) => {
      if (activeIds.has(s.id)) return;
      const pt = projection([s.lng, s.lat]);
      if (!pt) return;
      const [wx, wz] = toWorldXZ(pt);
      const elevMeters = sampleChinaElevationMeters(s.lng, s.lat);
      const climateLabel = classifyChinaClimate(s.lng, s.lat, elevMeters).label;
      const baseY = elevationToWorldY(elevMeters);
      const isSel = selectedSet.has(s.id);

      const h = isSel ? 2.2 : 0.95;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(isSel ? 0.34 : 0.22, isSel ? 0.42 : 0.28, h, 14),
        new THREE.MeshStandardMaterial({
          color: isSel ? 0xf97316 : 0x2dd4bf,
          emissive: isSel ? 0x9a3412 : 0x0f766e,
          emissiveIntensity: 0.45,
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
      };
      dynamicGroup.add(pillar);

      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(isSel ? 0.48 : 0.32, 12, 12),
        new THREE.MeshBasicMaterial({ color: isSel ? 0xfdba74 : 0x99f6e4 })
      );
      cap.position.set(wx, baseY + h + 0.15, wz);
      cap.userData = pillar.userData;
      dynamicGroup.add(cap);
    });

    orderedStops.forEach((st) => {
      const h = 3.0;
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.55, h, 16),
        new THREE.MeshStandardMaterial({
          color: st.color,
          emissive: st.color,
          emissiveIntensity: 0.55,
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
      };
      dynamicGroup.add(beacon);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      head.position.set(st.wx, st.wy + h + 0.25, st.wz);
      head.userData = beacon.userData;
      dynamicGroup.add(head);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.15, 24),
        new THREE.MeshBasicMaterial({ color: st.color, side: THREE.DoubleSide, transparent: true, opacity: 0.82 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(st.wx, st.wy + 0.12, st.wz);
      dynamicGroup.add(ring);
      refs.pulseRings.push(ring);
    });

    routeLegs.forEach((leg) => {
      const tubeGeo = new THREE.TubeGeometry(leg.curve, 38, 0.22, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: leg.color,
        emissive: leg.color,
        emissiveIntensity: 0.4,
        roughness: 0.25,
      });
      dynamicGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
    });
  }, [spots, selectedSpotIds, orderedStops, routeLegs, projection]);

  function setCameraPreset(mode: "3d" | "top") {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    if (mode === "3d") {
      cam.position.set(4, 54, 56);
    } else {
      cam.position.set(0, 84, 0.01);
    }
    ctrl.target.set(0, 2.5, 2);
    ctrl.update();
  }

  function stepZoom(factor: number) {
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    const offset = cam.position.clone().sub(ctrl.target);
    offset.multiplyScalar(factor);
    const len = offset.length();
    if (len < 22) offset.setLength(22);
    if (len > 138) offset.setLength(138);
    cam.position.copy(ctrl.target).add(offset);
    ctrl.update();
  }

  const provAvg = hoverTerrain ? PROVINCE_MEAN_ELEVATION[hoverTerrain.province] : undefined;

  return (
    <div
      style={{
        position: "relative",
        background: "linear-gradient(160deg, #071923 0%, #0d2b36 55%, #091e27 100%)",
        border: "1px solid #164e63",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* Top Floating HUD */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          right: 12,
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
            background: "rgba(7, 25, 35, 0.86)",
            border: "1px solid rgba(103, 232, 249, 0.38)",
            borderRadius: 999,
            padding: "3px 10px",
            fontSize: "0.73rem",
            color: "#cffafe",
            fontWeight: 600,
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {hoverTerrain
            ? `⛰️ ${hoverTerrain.province} · 海拔 ~${hoverTerrain.elevMeters}m${provAvg ? `（省均 ${provAvg}m）` : ""} · ${hoverTerrain.climateLabel}`
            : colorMode === "climate"
              ? "🌦️ 3D 地形 + 气候环境沙盘"
              : "⛰️ 3D 三级阶梯海拔沙盘"}
        </div>

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", pointerEvents: "auto" }}>
          <button
            type="button"
            className="chip"
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              background: colorMode === "climate" ? "#059669" : "rgba(7, 25, 35, 0.85)",
              color: "#ecfdf5",
              borderColor: colorMode === "climate" ? "#34d399" : "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => setColorMode("climate")}
          >
            气候
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              background: colorMode === "elevation" ? "#b45309" : "rgba(7, 25, 35, 0.85)",
              color: "#fef3c7",
              borderColor: colorMode === "elevation" ? "#fbbf24" : "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => setColorMode("elevation")}
          >
            海拔
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              background: autoRotate ? "#0e7490" : "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => setAutoRotate((r) => !r)}
          >
            {autoRotate ? "⏸ 停转" : "🔄 旋转"}
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              background: "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => setCameraPreset("3d")}
          >
            3D
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "2px 8px",
              fontSize: "0.72rem",
              background: "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
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
              background: "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
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
              background: "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => stepZoom(1.25)}
          >
            −
          </button>
        </div>
      </div>

      {/* Three.js Canvas Mount + Screen-Space Labels Overlay */}
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

        {/* Crisp HTML labels projected from 3D anchor coordinates */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 3 }}>
          {overlayItems.map((item) => (
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
                padding: item.kind === "leg" ? "1px 6px" : "2px 8px",
                borderRadius: 999,
                fontSize: item.kind === "leg" ? "0.68rem" : "0.74rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
                background: item.kind === "leg" ? "rgba(7, 25, 35, 0.88)" : item.color,
                color: item.kind === "leg" ? item.color : "#ffffff",
                border: item.kind === "leg" ? `1px solid ${item.color}` : "1.5px solid #ffffff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
              }}
            >
              {item.seq !== undefined && <span>{item.seq}.</span>}
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {/* Dynamic Elevation / Climate Legend Box */}
        <div
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            padding: "6px 10px",
            borderRadius: 8,
            background: "rgba(7, 25, 35, 0.86)",
            border: "1px solid rgba(103, 232, 249, 0.3)",
            color: "#cbd5e1",
            fontSize: "0.68rem",
            pointerEvents: "none",
            zIndex: 4,
          }}
        >
          {colorMode === "climate" ? (
            <>
              <div style={{ fontWeight: 700, color: "#e0f2fe", marginBottom: 4 }}>中国五大气候环境带</div>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "3px 10px" }}>
                {CLIMATE_LEGEND.map((item) => (
                  <span key={item.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
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
          ) : (
            <>
              <div style={{ fontWeight: 700, color: "#e0f2fe", marginBottom: 4 }}>海拔高度（m）</div>
              <div
                style={{
                  width: 148,
                  height: 8,
                  borderRadius: 4,
                  background: "linear-gradient(90deg, #0e747a 0%, #1f9d76 20%, #73b458 40%, #cfa048 62%, #c26b39 80%, #e8eef5 100%)",
                }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, fontSize: "0.64rem" }}>
                <span>50</span>
                <span>1500</span>
                <span>3000</span>
                <span>4600+</span>
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
            width: 74,
            padding: "5px 6px",
            borderRadius: 8,
            background: "rgba(7, 25, 35, 0.82)",
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
          padding: "8px 14px",
          borderTop: "1px solid #164e63",
          background: "#081c26",
          color: "#cbd5e1",
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
                <b style={{ color: "#f8fafc" }}>{d.day}</b>（{d.stops.length}站）
              </span>
            ))
          ) : (
            <span>点击 3D 光柱选择景点 · 拖拽旋转从东部平原俯瞰青藏高原三级阶梯</span>
          )}
        </div>
        {hoverStop && (
          <div style={{ color: "#67e8f9", fontWeight: 600 }}>
            {hoverStop.dayLabel ? `[${hoverStop.dayLabel}] ` : ""}
            {hoverStop.name} · {hoverStop.city} · 海拔 ~{hoverStop.elevMeters}m · {hoverStop.climateLabel} ·{" "}
            {hoverStop.price === 0 ? "免费" : `¥${hoverStop.price}`}
          </div>
        )}
      </div>
    </div>
  );
}
