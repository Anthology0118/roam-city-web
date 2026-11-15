import { geoMercator } from "d3-geo";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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

const DAY_COLORS = ["#f97316", "#22d3ee", "#60a5fa", "#c084fc", "#34d399", "#fbbf24", "#fb7185"];
const PROJ_W = 860;
const PROJ_H = 640;
const WORLD_SCALE = 0.1;
const MAP_DEPTH = 1.9;
const SURFACE_Y = MAP_DEPTH + 0.24;

type OrderedStop = PlanStop & {
  seq: number;
  dayIdx: number;
  dayLabel: string;
  color: string;
  wx: number;
  wz: number;
};

interface OverlayItem {
  key: string;
  worldPos: THREE.Vector3;
  kind: "stop" | "leg" | "selected";
  seq?: number;
  label: string;
  color: string;
}

function toWorldXZ(pt: [number, number]): [number, number] {
  return [(pt[0] - PROJ_W / 2) * WORLD_SCALE, (pt[1] - PROJ_H / 2) * WORLD_SCALE];
}

function ringToPoints(ring: number[][], projection: ReturnType<typeof geoMercator>): [number, number][] {
  const pts: [number, number][] = [];
  for (const coord of ring) {
    const projected = projection([coord[0], coord[1]]);
    if (!projected) continue;
    const [wx, wz] = toWorldXZ(projected);
    // In local XY before rotateX(-PI/2): sy = -wz
    pts.push([wx, -wz]);
  }
  return pts;
}

function polygonToShape(rings: number[][][], projection: ReturnType<typeof geoMercator>): THREE.Shape | null {
  if (!rings.length) return null;
  const outer = ringToPoints(rings[0], projection);
  if (outer.length < 3) return null;
  const shape = new THREE.Shape();
  shape.moveTo(outer[0][0], outer[0][1]);
  for (let i = 1; i < outer.length; i++) {
    shape.lineTo(outer[i][0], outer[i][1]);
  }
  shape.closePath();

  for (let h = 1; h < rings.length; h++) {
    const holePts = ringToPoints(rings[h], projection);
    if (holePts.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(holePts[0][0], holePts[0][1]);
    for (let i = 1; i < holePts.length; i++) {
      path.lineTo(holePts[i][0], holePts[i][1]);
    }
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
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

  const [hoverProvince, setHoverProvince] = useState("");
  const [hoverStop, setHoverStop] = useState<{
    id: string;
    name: string;
    city: string;
    price: number;
    dayLabel?: string;
  } | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [webglError, setWebglError] = useState(false);

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
        list.push({
          ...st,
          seq: seq++,
          dayIdx,
          dayLabel: d.day,
          color,
          wx,
          wz,
        });
      });
    });
    return list;
  }, [plan, projection]);

  // Projected label items & 3D Bezier curves derived from current plan + spots
  const { overlayItems, routeLegs } = useMemo(() => {
    const items: OverlayItem[] = [];
    const legs: Array<{ curve: THREE.QuadraticBezierCurve3; color: string }> = [];

    orderedStops.forEach((st, idx) => {
      items.push({
        key: `stop-${st.spot_id}`,
        worldPos: new THREE.Vector3(st.wx, SURFACE_Y + 4.3, st.wz),
        kind: "stop",
        seq: st.seq,
        label: st.name.split(" · ")[0],
        color: st.color,
      });

      if (idx > 0) {
        const prev = orderedStops[idx - 1];
        const p0 = new THREE.Vector3(prev.wx, SURFACE_Y + 0.6, prev.wz);
        const p1 = new THREE.Vector3(st.wx, SURFACE_Y + 0.6, st.wz);
        const dist = p0.distanceTo(p1);
        const arcPeak = SURFACE_Y + Math.min(18, Math.max(3.6, dist * 0.34));
        const pMid = new THREE.Vector3((p0.x + p1.x) / 2, arcPeak, (p0.z + p1.z) / 2);
        const curve = new THREE.QuadraticBezierCurve3(p0, pMid, p1);
        legs.push({ curve, color: st.color });

        if (st.distance_from_prev_km > 0) {
          items.push({
            key: `leg-${prev.spot_id}-${st.spot_id}`,
            worldPos: curve.getPoint(0.5).add(new THREE.Vector3(0, 1.1, 0)),
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
        items.push({
          key: `sel-${s.id}`,
          worldPos: new THREE.Vector3(wx, SURFACE_Y + 2.8, wz),
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
    scene: THREE.Scene;
    provinceMeshes: THREE.Mesh[];
    dynamicGroup: THREE.Group;
    pulseRings: THREE.Mesh[];
    comet: THREE.Mesh;
    legs: Array<{ curve: THREE.QuadraticBezierCurve3; color: string }>;
  } | null>(null);

  // Initialize Three.js WebGL stage + extruded 34-province China mesh once
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
    camera.position.set(0, 56, 54);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minPolarAngle = 0.08;
    controls.minDistance = 24;
    controls.maxDistance = 135;
    controls.target.set(0, 1.5, 2);
    controls.update();
    controlsRef.current = controls;

    // Studio & GIS lighting
    scene.add(new THREE.AmbientLight(0xd8f3f8, 1.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.45);
    keyLight.position.set(35, 75, 40);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
    rimLight.position.set(-45, 32, -40);
    scene.add(rimLight);

    // Subtle spatial coordinate grid beneath China landmass
    const grid = new THREE.GridHelper(130, 26, 0x1e6073, 0x113643);
    grid.position.y = -0.05;
    scene.add(grid);

    // Extrude 34 China provinces
    const mapGroup = new THREE.Group();
    const provinceMeshes: THREE.Mesh[] = [];
    const baseColor = new THREE.Color(0x165363);
    const altColor = new THREE.Color(0x195e70);

    chinaGeoJson.features.forEach((feat, idx) => {
      const geom = feat.geometry;
      const provName = feat.properties?.name || "";
      const shapes: THREE.Shape[] = [];
      const polygons =
        geom.type === "Polygon"
          ? [geom.coordinates as number[][][]]
          : geom.type === "MultiPolygon"
            ? (geom.coordinates as number[][][][])
            : [];

      for (const poly of polygons) {
        const shape = polygonToShape(poly, projection);
        if (shape) shapes.push(shape);
      }
      if (!shapes.length) return;

      const geo = new THREE.ExtrudeGeometry(shapes, {
        depth: MAP_DEPTH,
        bevelEnabled: true,
        bevelThickness: 0.22,
        bevelSize: 0.16,
        bevelSegments: 2,
        curveSegments: 2,
      });
      geo.rotateX(-Math.PI / 2);

      const mat = new THREE.MeshStandardMaterial({
        color: idx % 2 === 0 ? baseColor.clone() : altColor.clone(),
        roughness: 0.52,
        metalness: 0.18,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { kind: "province", name: provName, baseHex: mat.color.getHex(), targetY: 0 };
      mapGroup.add(mesh);
      provinceMeshes.push(mesh);

      // Crisp border outline on the top face
      for (const poly of polygons) {
        const ring = poly[0];
        if (!ring || ring.length < 3) continue;
        const borderPts: THREE.Vector3[] = [];
        for (const coord of ring) {
          const p = projection([coord[0], coord[1]]);
          if (!p) continue;
          const [wx, wz] = toWorldXZ(p);
          borderPts.push(new THREE.Vector3(wx, SURFACE_Y + 0.03, wz));
        }
        if (borderPts.length > 2) {
          borderPts.push(borderPts[0].clone());
          const lineGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
          const lineMat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.58 });
          mapGroup.add(new THREE.Line(lineGeo, lineMat));
        }
      }
    });
    scene.add(mapGroup);

    const dynamicGroup = new THREE.Group();
    scene.add(dynamicGroup);

    // Animated comet traversing the active 2-opt route
    const comet = new THREE.Mesh(
      new THREE.SphereGeometry(0.65, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    comet.visible = false;
    scene.add(comet);

    sceneRefs.current = {
      scene,
      provinceMeshes,
      dynamicGroup,
      pulseRings: [],
      comet,
      legs: [],
    };

    // Raycaster for province & 3D beacon hover/click
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
        setHoverStop({ id: d.spotId, name: d.name, city: d.city, price: d.price, dayLabel: d.dayLabel });
      } else {
        setHoverStop(null);
      }

      const provHits = raycaster.intersectObjects(provinceMeshes, false);
      const hitProv = provHits[0]?.object as THREE.Mesh | undefined;
      provinceMeshes.forEach((pm) => {
        const isHit = pm === hitProv;
        pm.userData.targetY = isHit ? 0.65 : 0;
        const m = pm.material as THREE.MeshStandardMaterial;
        m.color.setHex(isHit ? 0x248ea6 : pm.userData.baseHex);
      });
      if (hitProv) {
        setHoverProvince(hitProv.userData.name || "");
        if (!hitSpotObj) renderer.domElement.style.cursor = "grab";
      } else {
        setHoverProvince("");
        if (!hitSpotObj) renderer.domElement.style.cursor = "grab";
      }
    }

    function onPointerUp(e: PointerEvent) {
      const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (moved > 6) return; // Ignore orbit drag
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

      // Smoothly lift hovered province
      for (const pm of provinceMeshes) {
        pm.position.y += (pm.userData.targetY - pm.position.y) * 0.16;
      }

      // Pulse beacon rings
      const activeRefs = sceneRefs.current;
      if (activeRefs) {
        activeRefs.pulseRings.forEach((ring, idx) => {
          const s = 1 + 0.45 * Math.sin(elapsed * 3.2 + idx * 0.8);
          ring.scale.set(s, s, 1);
        });

        // Animate route comet across legs
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

      // Project 3D anchor coordinates into crisp 2D DOM label overlays
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
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [projection, height]);

  // Rebuild 3D spot pillars & parabolic route tubes when spots / selected / plan changes
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    const { dynamicGroup } = refs;

    while (dynamicGroup.children.length > 0) {
      const child = dynamicGroup.children[0];
      dynamicGroup.remove(child);
    }
    refs.pulseRings = [];
    refs.legs = routeLegs;

    const activeIds = new Set(orderedStops.map((s) => s.spot_id));
    const selectedSet = new Set(selectedSpotIds);

    // 1. Background / selected spots
    spots.forEach((s) => {
      if (activeIds.has(s.id)) return;
      const pt = projection([s.lng, s.lat]);
      if (!pt) return;
      const [wx, wz] = toWorldXZ(pt);
      const isSel = selectedSet.has(s.id);

      const h = isSel ? 2.1 : 0.9;
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(isSel ? 0.34 : 0.22, isSel ? 0.42 : 0.28, h, 14),
        new THREE.MeshStandardMaterial({
          color: isSel ? 0xf97316 : 0x2dd4bf,
          emissive: isSel ? 0x9a3412 : 0x0f766e,
          emissiveIntensity: 0.45,
        })
      );
      pillar.position.set(wx, SURFACE_Y + h / 2, wz);
      pillar.userData = {
        kind: "spot",
        planned: false,
        spotId: s.id,
        name: s.name,
        city: s.city,
        price: s.price,
      };
      dynamicGroup.add(pillar);

      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(isSel ? 0.5 : 0.32, 12, 12),
        new THREE.MeshBasicMaterial({ color: isSel ? 0xfdba74 : 0x99f6e4 })
      );
      cap.position.set(wx, SURFACE_Y + h + 0.15, wz);
      cap.userData = pillar.userData;
      dynamicGroup.add(cap);
    });

    // 2. Active 2-opt route stops (tall glowing beacons + pulsing rings)
    orderedStops.forEach((st) => {
      const h = 3.2;
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.55, h, 16),
        new THREE.MeshStandardMaterial({
          color: st.color,
          emissive: st.color,
          emissiveIntensity: 0.55,
        })
      );
      beacon.position.set(st.wx, SURFACE_Y + h / 2, st.wz);
      beacon.userData = {
        kind: "spot",
        planned: true,
        spotId: st.spot_id,
        name: st.name,
        city: st.city,
        price: st.price,
        dayLabel: st.dayLabel,
      };
      dynamicGroup.add(beacon);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.65, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0xffffff })
      );
      head.position.set(st.wx, SURFACE_Y + h + 0.25, st.wz);
      head.userData = beacon.userData;
      dynamicGroup.add(head);

      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.15, 24),
        new THREE.MeshBasicMaterial({ color: st.color, side: THREE.DoubleSide, transparent: true, opacity: 0.78 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(st.wx, SURFACE_Y + 0.06, st.wz);
      dynamicGroup.add(ring);
      refs.pulseRings.push(ring);
    });

    // 3. 3D Parabolic Bezier Tubes
    routeLegs.forEach((leg) => {
      const tubeGeo = new THREE.TubeGeometry(leg.curve, 36, 0.22, 8, false);
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
      cam.position.set(0, 56, 54);
    } else {
      cam.position.set(0, 82, 0.01);
    }
    ctrl.target.set(0, 1.5, 2);
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
    if (len > 135) offset.setLength(135);
    cam.position.copy(ctrl.target).add(offset);
    ctrl.update();
  }

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
            background: "rgba(7, 25, 35, 0.85)",
            border: "1px solid rgba(103, 232, 249, 0.35)",
            borderRadius: 999,
            padding: "4px 12px",
            fontSize: "0.78rem",
            color: "#cffafe",
            fontWeight: 600,
          }}
        >
          {hoverProvince ? `📍 ${hoverProvince}` : "🌐 3D 中国地形路线沙盘 (Three.js · 拖拽旋转 / 滚轮缩放)"}
        </div>

        <div style={{ display: "flex", gap: 6, pointerEvents: "auto" }}>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.76rem",
              background: autoRotate ? "#0e7490" : "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => setAutoRotate((r) => !r)}
          >
            {autoRotate ? "⏸ 暂停旋转" : "🔄 自动旋转"}
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.76rem",
              background: "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => setCameraPreset("3d")}
          >
            3D 俯瞰
          </button>
          <button
            type="button"
            className="chip"
            style={{
              padding: "3px 10px",
              fontSize: "0.76rem",
              background: "rgba(7, 25, 35, 0.85)",
              color: "#e0f2fe",
              borderColor: "rgba(103, 232, 249, 0.4)",
            }}
            onClick={() => setCameraPreset("top")}
          >
            顶视图
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
            当前浏览器环境未开启 WebGL 硬件加速，请启用 WebGL 后查看 3D 中国地图沙盘。
          </div>
        )}

        {/* Crisp HTML labels projected from 3D world positions */}
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
            <span>点击 3D 光柱选择或查看景点，左键拖拽旋转视角，滚轮缩放</span>
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
