/**
 * The 3D viewport: renders the selected piece's body + sculpt geometry, its
 * outlines, and a mm grid, in three view modes (top / underside / orbit).
 * Publishes a screen<->mm mapping (see `./mapping.ts`) every frame so 2D
 * overlays (cutter frames, magnet handles) drawn by other modules can line
 * up with the rendered geometry exactly.
 *
 * Coordinate convention: the kernel is Z-up (mm, bottom at z=0, plate top at
 * ~3mm). This file does NOT rotate the scene — piece-local coordinates are
 * used directly as three.js world coordinates. Instead, the cameras are
 * oriented explicitly for each view mode (see `Cameras` below).
 *
 * PERFORMANCE RULE: geometry (typed arrays) must never be passed as a React
 * prop, in this tree or anywhere else. React's development build deep-diffs
 * every changed prop in its commit instrumentation and enumerates typed
 * arrays element by element: with a 300k-triangle mesh in a prop that was
 * 1-2 s of main-thread stall per selection change in Chromium and 5-10 s in
 * Firefox. Components below take an id and read meshes from the store with
 * hooks (hook values are not diffed), and hand geometry to three.js
 * imperatively through refs so element props stay referentially stable.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import type { JSX } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Line, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useAppStore } from '@/state/project';
import { useViewMapping } from '@/viewport/mapping';
import type { Bounds3, Vec2 } from '@/kernel/types';
import type { MeshTransfer } from '@/worker/api';
import type { ViewMode } from '@/state/types';

/** Fixed distance of the top/underside ortho camera from the z=0 plane, mm. Orthographic projection is distance-independent, so any value that keeps piece geometry within [near, far] works for every piece size. */
const ORTHO_CAMERA_HEIGHT = 1000;
const MIN_PX_PER_MM = 0.02;
const MAX_PX_PER_MM = 500;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/* ------------------------------------------------------------------------ */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Wrap a worker-provided triangle mesh directly as a BufferGeometry. Never
 * copies `positions`/`indices` (the sculpt shell can be ~2M triangles);
 * disposes the previous geometry whenever `mesh` changes or on unmount.
 *
 * The worker sends no normals (root pieces are indexed, others are a flat
 * non-indexed triangle soup) - both are rendered with `flatShading` so
 * three.js derives per-face normals from screen-space position derivatives,
 * which needs no normal attribute and works for either topology.
 */
function useTriSoupGeometry(mesh: MeshTransfer | undefined): THREE.BufferGeometry | null {
  const geometry = useMemo(() => {
    if (!mesh || mesh.triCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    if (mesh.indices) g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }, [mesh]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  return geometry;
}

/**
 * Shared materials: created once and never disposed. r3f disposes JSX-created
 * materials whenever their mesh unmounts, and three.js then recompiles the
 * shader on the next mount; with shared instances that never happens.
 */
const BODY_MATERIAL = new THREE.MeshStandardMaterial({ color: '#8a8f98', flatShading: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const SCULPT_MATERIAL = new THREE.MeshStandardMaterial({ color: '#d9d4c7', flatShading: true, side: THREE.FrontSide });

/**
 * The displayed piece's body and sculpt. Two Mesh objects live for the whole
 * session; only their `.geometry` is swapped (imperatively, so no React prop
 * ever holds a mesh). Geometry is read from the store by id, and the store
 * keeps the last geometry while a recompute is pending, so the meshes never
 * unmount or flicker.
 */
function PieceMeshes({ id, showSculpt }: { id: string; showSculpt: boolean }) {
  const body = useAppStore((s) => s.geometry[id]?.data?.body);
  const sculpt = useAppStore((s) => s.geometry[id]?.data?.sculpt);
  const hasSculpt = useAppStore((s) => s.geometry[id]?.data?.hasSculpt ?? false);
  const bodyGeom = useTriSoupGeometry(body);
  const sculptGeom = useTriSoupGeometry(sculpt);
  const invalidate = useThree((s) => s.invalidate);
  const bodyMesh = useMemo(() => new THREE.Mesh(new THREE.BufferGeometry(), BODY_MATERIAL), []);
  const sculptMesh = useMemo(() => new THREE.Mesh(new THREE.BufferGeometry(), SCULPT_MATERIAL), []);

  useLayoutEffect(() => {
    bodyMesh.geometry = bodyGeom ?? EMPTY_GEOMETRY;
    bodyMesh.visible = !!bodyGeom;
    invalidate();
  }, [bodyMesh, bodyGeom, invalidate]);
  useLayoutEffect(() => {
    sculptMesh.geometry = sculptGeom && hasSculpt ? sculptGeom : EMPTY_GEOMETRY;
    sculptMesh.visible = !!sculptGeom && hasSculpt && showSculpt;
    invalidate();
  }, [sculptMesh, sculptGeom, hasSculpt, showSculpt, invalidate]);

  return (
    <>
      <primitive object={bodyMesh} />
      <primitive object={sculptMesh} />
    </>
  );
}
const EMPTY_GEOMETRY = new THREE.BufferGeometry();

function polyToClosedLoop(poly: Vec2[], z: number): [number, number, number][] {
  if (poly.length === 0) return [];
  const pts: [number, number, number][] = poly.map(([x, y]) => [x, y, z]);
  pts.push(pts[0]);
  return pts;
}

function PieceOutlines({ id }: { id: string }) {
  const outline = useAppStore((s) => s.geometry[id]?.data?.outline);
  const bottomPts = useMemo(() => (outline ? polyToClosedLoop(outline.bottom, 0.01) : []), [outline]);
  const topPts = useMemo(() => (outline ? polyToClosedLoop(outline.top, outline.plateTop) : []), [outline]);

  return (
    <>
      {bottomPts.length > 1 && <Line points={bottomPts} color="#5eb0ff" lineWidth={1.25} />}
      {topPts.length > 1 && (
        <Line points={topPts} color="#5eb0ff" lineWidth={0.75} dashed dashSize={1.5} gapSize={1} />
      )}
    </>
  );
}

/** A 1mm-cell / 10mm-section grid lying flat in the world XY plane (z~0), sized to the piece. */
function SceneGrid({ id }: { id: string | null }) {
  const bounds = useAppStore((s) => (id ? s.geometry[id]?.data?.bounds : undefined));
  const { w, d, cx, cy } = useMemo(() => {
    if (!bounds) return { w: 150, d: 150, cx: 0, cy: 0 };
    const w = Math.max(bounds.max[0] - bounds.min[0], 10) * 1.6;
    const d = Math.max(bounds.max[1] - bounds.min[1], 10) * 1.6;
    const cx = (bounds.max[0] + bounds.min[0]) / 2;
    const cy = (bounds.max[1] + bounds.min[1]) / 2;
    return { w, d, cx, cy };
  }, [bounds]);

  return (
    <Grid
      position={[cx, cy, 0.001]}
      rotation={[-Math.PI / 2, 0, 0]}
      args={[w, d]}
      cellSize={1}
      cellThickness={0.5}
      cellColor="#4a4d55"
      sectionSize={10}
      sectionThickness={1}
      sectionColor="#6a6f78"
      fadeDistance={Math.max(w, d) * 3}
      fadeStrength={1}
      infiniteGrid={false}
      followCamera={false}
    />
  );
}

/* ------------------------------------------------------------------------ */
/* Cameras: top / underside (custom pan+zoom ortho) and orbit (perspective)  */
/* ------------------------------------------------------------------------ */

interface PanZoomState {
  x: number;
  y: number;
  pxPerMm: number;
}

function frameOrtho(bounds: Bounds3, cssWidth: number, cssHeight: number): PanZoomState {
  const w = Math.max(bounds.max[0] - bounds.min[0], 1e-3);
  const d = Math.max(bounds.max[1] - bounds.min[1], 1e-3);
  const cx = (bounds.max[0] + bounds.min[0]) / 2;
  const cy = (bounds.max[1] + bounds.min[1]) / 2;
  // ~10% margin on each side => 1.2x the footprint.
  const marginW = w * 1.2;
  const marginD = d * 1.2;
  const pxPerMm = clamp(Math.min(cssWidth / marginW, cssHeight / marginD), MIN_PX_PER_MM, MAX_PX_PER_MM);
  return { x: cx, y: cy, pxPerMm };
}

/**
 * Pan (middle/right drag or shift+left drag) and wheel-zoom-about-cursor for
 * the top/underside orthographic camera. Implemented directly on the canvas
 * DOM element (rather than drei's MapControls) so the math is exact and
 * self-consistent with `mmToPx`/`pxToMm`: every pan/zoom step keeps the world
 * point under the cursor fixed on screen, computed via the camera's own
 * unproject (which already accounts for the underside camera's mirroring).
 */
function OrthoPanZoom({
  camRef,
  panZoomRef,
}: {
  camRef: RefObject<THREE.OrthographicCamera | null>;
  panZoomRef: RefObject<PanZoomState>;
}): null {
  const { gl, invalidate } = useThree();

  useEffect(() => {
    const el = gl.domElement;

    function ndcFromClient(clientX: number, clientY: number): [number, number] {
      const rect = el.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
      return [nx, ny];
    }

    function unproject(nx: number, ny: number): [number, number] {
      const cam = camRef.current;
      if (!cam) return [0, 0];
      cam.updateMatrixWorld();
      const v = new THREE.Vector3(nx, ny, 0).unproject(cam);
      return [v.x, v.y];
    }

    function isPanButton(e: PointerEvent): boolean {
      return e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey);
    }

    let dragging = false;
    let lastNdc: [number, number] | null = null;

    function onPointerDown(e: PointerEvent): void {
      if (!isPanButton(e)) return;
      e.preventDefault();
      // Capture can throw in edge cases (e.g. pointer already released); panning
      // still works without it, it just won't survive the cursor leaving the canvas.
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragging = true;
      lastNdc = ndcFromClient(e.clientX, e.clientY);
    }

    function onPointerMove(e: PointerEvent): void {
      if (!dragging || !lastNdc) return;
      const cam = camRef.current;
      if (!cam) return;
      const ndc = ndcFromClient(e.clientX, e.clientY);
      const [px, py] = unproject(lastNdc[0], lastNdc[1]);
      const [cx, cy] = unproject(ndc[0], ndc[1]);
      cam.position.x += px - cx;
      cam.position.y += py - cy;
      panZoomRef.current.x = cam.position.x;
      panZoomRef.current.y = cam.position.y;
      lastNdc = ndc;
      publishMapping(gl, cam, cam.position.z < 0 ? 'underside' : 'top');
      invalidate();
    }

    function onPointerUp(e: PointerEvent): void {
      dragging = false;
      lastNdc = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }

    function onContextMenu(e: MouseEvent): void {
      e.preventDefault();
    }

    function onWheel(e: WheelEvent): void {
      const cam = camRef.current;
      if (!cam) return;
      e.preventDefault();
      const [nx, ny] = ndcFromClient(e.clientX, e.clientY);
      const [wx, wy] = unproject(nx, ny);
      const oldZoom = cam.zoom;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newZoom = clamp(oldZoom * factor, MIN_PX_PER_MM, MAX_PX_PER_MM);
      // Keep the world point under the cursor fixed on screen.
      cam.position.x = wx + (cam.position.x - wx) * (oldZoom / newZoom);
      cam.position.y = wy + (cam.position.y - wy) * (oldZoom / newZoom);
      cam.zoom = newZoom;
      cam.updateProjectionMatrix();
      panZoomRef.current.x = cam.position.x;
      panZoomRef.current.y = cam.position.y;
      panZoomRef.current.pxPerMm = newZoom;
      publishMapping(gl, cam, cam.position.z < 0 ? 'underside' : 'top');
      invalidate();
    }

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('contextmenu', onContextMenu);
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerUp);
      el.removeEventListener('contextmenu', onContextMenu);
      el.removeEventListener('wheel', onWheel);
    };
  }, [gl, camRef, panZoomRef, invalidate]);

  return null;
}

function Cameras({ mode, selectedId }: { mode: ViewMode; selectedId: string | null }) {
  const { gl, invalidate } = useThree();
  const bounds: Bounds3 | undefined = useAppStore((s) => (selectedId ? s.geometry[selectedId]?.data?.bounds : undefined));
  const camRef = useRef<THREE.OrthographicCamera>(null);
  const perspRef = useRef<THREE.PerspectiveCamera>(null);
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const panZoomRef = useRef<PanZoomState>({ x: 0, y: 0, pxPerMm: 4 });
  const lastFramedKey = useRef<string>('');

  // Frame the current piece on mode change and on selection change (not on
  // every geometry recompute of the same piece/mode, so mid-edit cutting
  // doesn't yank the camera around).
  useEffect(() => {
    if (!bounds) return;
    const key = `${selectedId ?? ''}|${mode}`;
    if (lastFramedKey.current === key) return;
    lastFramedKey.current = key;

    const b = bounds;
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = (b.min[1] + b.max[1]) / 2;
    const cz = (b.min[2] + b.max[2]) / 2;

    if (mode !== 'orbit') {
      const cssW = gl.domElement.clientWidth || 1;
      const cssH = gl.domElement.clientHeight || 1;
      const pz = frameOrtho(b, cssW, cssH);
      panZoomRef.current = pz;
      const cam = camRef.current;
      if (cam) {
        cam.position.set(pz.x, pz.y, mode === 'underside' ? -ORTHO_CAMERA_HEIGHT : ORTHO_CAMERA_HEIGHT);
        cam.rotation.set(0, mode === 'underside' ? Math.PI : 0, 0);
        cam.zoom = pz.pxPerMm;
        cam.updateProjectionMatrix();
      }
    } else {
      const w = Math.max(b.max[0] - b.min[0], 1e-3);
      const d = Math.max(b.max[1] - b.min[1], 1e-3);
      const h = Math.max(b.max[2] - b.min[2], 1e-3);
      const diag = Math.sqrt(w * w + d * d + h * h);
      const dist = Math.max(diag * 1.4, 20);
      const dir = new THREE.Vector3(0.9, -1.1, 0.9).normalize();
      const cam = perspRef.current;
      const controls = orbitRef.current;
      if (cam && controls) {
        cam.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
        controls.target.set(cx, cy, cz);
        controls.update();
      }
    }
    publishMapping(gl, mode !== 'orbit' ? camRef.current : null, mode);
    invalidate();
  }, [selectedId, mode, bounds, gl, invalidate]);

  return (
    <>
      {/* Shared top/underside camera: identity-oriented (looking down -Z,
          +Y up) for 'top'; flipped 180deg about Y (looking up +Z, +Y still
          up, so +X mirrors) for 'underside'. Only position/rotation/zoom
          change between the two - no lookAt needed. */}
      <OrthographicCamera
        ref={camRef}
        makeDefault={mode !== 'orbit'}
        near={1}
        far={5000}
        position={[
          panZoomRef.current.x,
          panZoomRef.current.y,
          mode === 'underside' ? -ORTHO_CAMERA_HEIGHT : ORTHO_CAMERA_HEIGHT,
        ]}
        rotation={[0, mode === 'underside' ? Math.PI : 0, 0]}
        zoom={panZoomRef.current.pxPerMm}
      />
      <PerspectiveCamera ref={perspRef} makeDefault={mode === 'orbit'} near={1} far={20000} fov={45} up={[0, 0, 1]} />
      {/* Always mounted (toggled via `enabled`) rather than conditionally
          mounted, so there is no mount-order race with `makeDefault` when
          switching into orbit mode. */}
      <OrbitControls ref={orbitRef} enabled={mode === 'orbit'} enableDamping={false} />
      {mode !== 'orbit' && <OrthoPanZoom camRef={camRef} panZoomRef={panZoomRef} />}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Mapping publisher                                                         */
/* ------------------------------------------------------------------------ */

interface MappingSnapshot {
  width: number;
  height: number;
  pxPerMm: number;
  originPx: [number, number];
  mirrored: boolean;
  valid: boolean;
}

let lastMapping: MappingSnapshot = { width: -1, height: -1, pxPerMm: -1, originPx: [0, 0], mirrored: false, valid: false };

/**
 * Publish the top-down mm→px mapping for the overlays. Called synchronously
 * whenever the camera or canvas changes (framing, pan, zoom) and once per
 * rendered frame as a safety net, so overlays never lag behind the 3D view.
 * Returns true when something changed.
 */
function publishMapping(gl: THREE.WebGLRenderer, camera: THREE.Camera | null, mode: ViewMode): boolean {
  const width = gl.domElement.clientWidth;
  const height = gl.domElement.clientHeight;
  const mirrored = mode === 'underside';
  const valid = mode !== 'orbit';
  let pxPerMm = lastMapping.pxPerMm;
  let originPx = lastMapping.originPx;
  if (valid && camera instanceof THREE.OrthographicCamera) {
    pxPerMm = camera.zoom;
    camera.updateMatrixWorld();
    const p = new THREE.Vector3(0, 0, 0).project(camera);
    originPx = [((p.x + 1) / 2) * width, ((1 - p.y) / 2) * height];
  }
  const prev = lastMapping;
  const changed =
    prev.width !== width ||
    prev.height !== height ||
    prev.mirrored !== mirrored ||
    prev.valid !== valid ||
    Math.abs(prev.pxPerMm - pxPerMm) > 1e-4 ||
    Math.abs(prev.originPx[0] - originPx[0]) > 1e-3 ||
    Math.abs(prev.originPx[1] - originPx[1]) > 1e-3;
  if (changed) {
    lastMapping = { width, height, pxPerMm, originPx, mirrored, valid };
    useViewMapping.getState().set(lastMapping);
  }
  return changed;
}

/** Dev-only hook so the r3f state can be inspected/timed from the console. */
function DevHooks(): null {
  const get = useThree((s) => s.get);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __three?: unknown; __renderTimes?: { t: number; ms: number; tris: number }[] };
    w.__three = { get, invalidate };
    // Time every WebGL render call so the ?autotest=1 run can tell GL cost from React cost.
    const gl = get().gl;
    const orig = gl.render.bind(gl);
    w.__renderTimes = [];
    gl.render = (scene: THREE.Object3D, camera: THREE.Camera) => {
      const t = performance.now();
      orig(scene, camera);
      w.__renderTimes!.push({ t, ms: performance.now() - t, tris: gl.info.render.triangles });
      if (w.__renderTimes!.length > 5000) w.__renderTimes!.splice(0, 2500);
    };
    return () => { gl.render = orig; };
  }, [get, invalidate]);
  return null;
}

/** Safety net: re-publish on rendered frames (covers canvas resizes). */
function MappingPublisher({ mode }: { mode: ViewMode }): null {
  useFrame((state) => {
    if (publishMapping(state.gl, state.camera, mode)) state.invalidate();
  });
  return null;
}

/* ------------------------------------------------------------------------ */
/* Scene / Viewport                                                          */
/* ------------------------------------------------------------------------ */

/** Which base the view shows: the big base in the top view, the selected base otherwise. */
function useDisplayedId(): string | null {
  return useAppStore((s) => {
    const sel = s.project.selectedId;
    if (!sel) return null;
    if (s.view.mode !== 'top') return sel;
    const piece = s.project.pieces[sel];
    const src = piece ? s.project.sources[piece.sourceId] : undefined;
    return src?.rootPieceId ?? sel;
  });
}

function SceneContent() {
  const selectedId = useDisplayedId();
  // the last computed geometry stays on screen while a recompute is pending
  const hasData = useAppStore((s) => (selectedId ? s.geometry[selectedId]?.data != null : false));
  const mode = useAppStore((s) => s.view.mode);
  const showSculpt = useAppStore((s) => s.view.showSculpt);

  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [hasData, mode, showSculpt, invalidate]);

  return (
    <>
      <color attach="background" args={['#24262b']} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#ffffff', '#3a3d44', 0.8]} position={[0, 0, 1]} />
      <directionalLight position={[150, -220, 320]} intensity={1.15} />
      <directionalLight position={[-120, 150, 180]} intensity={0.35} />
      {/* Fills the underside (both directional lights shine from above) so
          the 'underside' view - used to inspect magnet slots - stays legible. */}
      <directionalLight position={[-80, 100, -260]} intensity={0.55} />
      <SceneGrid id={selectedId} />
      {selectedId && hasData && <PieceOutlines id={selectedId} />}
      {selectedId && hasData && <PieceMeshes id={selectedId} showSculpt={showSculpt} />}
      <Cameras mode={mode} selectedId={selectedId} />
      <MappingPublisher mode={mode} />
      <DevHooks />
    </>
  );
}

export function Viewport(): JSX.Element {
  const selectedId = useDisplayedId();
  const geomState = useAppStore((s) => (selectedId ? s.geometry[selectedId] : undefined));

  let message: string | null = null;
  let corner = false;
  if (!selectedId) {
    message = 'Load a base from the library';
  } else if (!geomState || geomState.status === 'pending') {
    message = geomState?.data ? 'Updating…' : 'Computing…';
    corner = !!geomState?.data;
  } else if (geomState.status === 'error') {
    message = geomState.error ?? 'Failed to compute geometry';
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        frameloop="demand"
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        dpr={1}
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <SceneContent />
      </Canvas>
      {message && (
        <div
          style={
            corner
              ? { position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none', color: '#e8e2d2', fontSize: 12, fontFamily: 'system-ui, sans-serif' }
              : { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', color: '#9aa0aa', fontSize: 14, fontFamily: 'system-ui, sans-serif' }
          }
        >
          {message}
        </div>
      )}
    </div>
  );
}
