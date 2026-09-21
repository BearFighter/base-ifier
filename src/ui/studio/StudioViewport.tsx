/**
 * Base Studio's 3D view: the ground and props preview from the studio store,
 * rendered like the cutter's viewport (flat shading, demand frames, meshes
 * reach three.js through refs, never through React props).
 *
 * Props can be picked here: clicking one selects it, the selected one is lifted
 * out of the merged props mesh and redrawn in a highlight colour, and a drag
 * handle (slide / turn / resize) hangs on the spot the prop's own origin ended
 * up. What the handle did is written back to the document on release, which
 * drops the prop onto the ground again at its new place.
 *
 * Picking is a plain pointer listener that casts ONE ray when a click ends,
 * rather than react-three-fiber's event system: r3f re-casts against every
 * object that has a handler on every pointer move, and the ground here is a
 * couple of hundred thousand triangles.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl, TransformControls as TransformControlsImpl } from 'three-stdlib';
import { useStudioStore } from '@/studio/store';
import type { PropTransform } from '@/studio/store';
import type { MeshTransfer, StudioPropRange } from '@/worker/api';

const GROUND_MATERIAL = new THREE.MeshStandardMaterial({ color: '#c9bfa8', flatShading: true });
const PROP_MATERIAL = new THREE.MeshStandardMaterial({ color: '#8f8a80', flatShading: true });
const PLATE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6e6a63', flatShading: true });
/** The selected prop is drawn as its own highlighted copy, so its slice of the merged mesh is left out. */
const HIDDEN_MATERIAL = new THREE.MeshBasicMaterial({ visible: false });
const PROP_MATERIALS = [PROP_MATERIAL, HIDDEN_MATERIAL];
const SELECTED_MATERIAL = new THREE.MeshStandardMaterial({ color: '#d9a441', emissive: '#4a3208', flatShading: true });
const EMPTY = new THREE.BufferGeometry();

/** How far the pointer may travel and still count as a click rather than a drag of the view, px. */
const CLICK_SLOP = 4;

/**
 * Shared, mutable and deliberately outside React: is the pointer on the drag
 * handle? The handle sits in front of everything, and a click that grabs it
 * must not also count as a click on whatever is behind it.
 */
const handleState: { busy: boolean; axis: () => string | null } = { busy: false, axis: () => null };
const handleInUse = (): boolean => handleState.busy || handleState.axis() !== null;

/** Which prop owns triangle `tri` of the merged props mesh (ranges are in order and touch). */
function propAtTriangle(ranges: StudioPropRange[], tri: number): string | null {
  let lo = 0, hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid];
    if (tri < r.start) hi = mid - 1;
    else if (tri >= r.start + r.count) lo = mid + 1;
    else return r.id;
  }
  return null;
}

/** Turn of a rotation that is only ever about Z, in degrees. */
function turnDeg(q: THREE.Quaternion): number {
  return (2 * Math.atan2(q.z, q.w) * 180) / Math.PI;
}

function useSoupGeometry(mesh: MeshTransfer | undefined): THREE.BufferGeometry | null {
  const geometry = useMemo(() => {
    if (!mesh || mesh.triCount === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    return g;
  }, [mesh]);
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);
  return geometry;
}

function PreviewMeshes() {
  const ground = useStudioStore((s) => s.preview?.ground);
  const props = useStudioStore((s) => s.preview?.props);
  const ranges = useStudioStore((s) => s.preview?.propRanges);
  const selected = useStudioStore((s) => s.selectedPropId);
  const board = useStudioStore((s) => s.doc?.board);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const groundGeom = useSoupGeometry(ground);
  const propGeom = useSoupGeometry(props);
  const groundMesh = useMemo(() => new THREE.Mesh(EMPTY, GROUND_MATERIAL), []);
  // the material is swapped for a pair (normal + invisible) while one prop is selected
  const propMesh = useMemo(() => new THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(EMPTY, PROP_MATERIAL), []);
  const plateMesh = useMemo(() => new THREE.Mesh(EMPTY, PLATE_MATERIAL), []);

  useLayoutEffect(() => {
    groundMesh.geometry = groundGeom ?? EMPTY;
    groundMesh.visible = !!groundGeom;
    propMesh.geometry = propGeom ?? EMPTY;
    propMesh.visible = !!propGeom;
    invalidate();
  }, [groundMesh, propMesh, groundGeom, propGeom, invalidate]);

  // leave the selected prop's triangles out of the merged mesh: its own highlighted copy is drawn there
  useLayoutEffect(() => {
    const g = propGeom;
    if (!g) return;
    g.clearGroups();
    const total = props?.triCount ?? 0;
    const r = selected && ranges ? ranges.find((x) => x.id === selected) : undefined;
    if (!r || total === 0) {
      propMesh.material = PROP_MATERIAL;
    } else {
      if (r.start > 0) g.addGroup(0, r.start * 3, 0);
      g.addGroup(r.start * 3, r.count * 3, 1);
      const after = total - r.start - r.count;
      if (after > 0) g.addGroup((r.start + r.count) * 3, after * 3, 0);
      propMesh.material = PROP_MATERIALS;
    }
    invalidate();
  }, [propGeom, props, ranges, selected, propMesh, invalidate]);

  // the plate under the ground, so the board reads as a base: a round board gets a round plate
  useLayoutEffect(() => {
    if (!board) { plateMesh.visible = false; return; }
    const m = board.margin ?? 0;
    const w = board.shape.w + 2 * m, d = board.shape.d + 2 * m;
    const g = board.shape.kind === 'ellipse' ? new THREE.CylinderGeometry(0.5, 0.5, board.plateTop, 128) : new THREE.BoxGeometry(1, board.plateTop, 1);
    g.rotateX(Math.PI / 2);
    plateMesh.geometry.dispose();
    plateMesh.geometry = g;
    plateMesh.scale.set(w, d, 1);
    plateMesh.position.set(0, 0, board.plateTop / 2);
    plateMesh.visible = true;
    invalidate();
  }, [board, plateMesh, invalidate]);

  // click a prop to pick it up; click anywhere else to let it go
  useEffect(() => {
    const el = gl.domElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let downX = 0, downY = 0, down = false;
    function onDown(ev: PointerEvent) { down = true; downX = ev.clientX; downY = ev.clientY; }
    function onUp(ev: PointerEvent) {
      const wasDown = down;
      down = false;
      if (!wasDown || handleInUse()) return;
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > CLICK_SLOP) return; // that was a drag of the view
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const rs = useStudioStore.getState().preview?.propRanges;
      const hit = propMesh.visible && rs && rs.length > 0 ? ray.intersectObject(propMesh, false)[0] : undefined;
      const id = hit && hit.faceIndex !== undefined && hit.faceIndex !== null && rs ? propAtTriangle(rs, hit.faceIndex) : null;
      useStudioStore.getState().select(id);
    }
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); };
  }, [gl, camera, propMesh]);

  return (
    <>
      <primitive object={plateMesh} />
      <primitive object={groundMesh} />
      <primitive object={propMesh} />
    </>
  );
}

/**
 * The selected prop: its own copy of the triangles, drawn in the highlight
 * colour and hung on an otherwise empty group that sits exactly where the
 * prop's origin ended up. The drag handle moves that group; on release the
 * difference is written back to the document as one change.
 */
function SelectedProp() {
  const selected = useStudioStore((s) => s.selectedPropId);
  const mode = useStudioStore((s) => s.transformMode);
  const preview = useStudioStore((s) => s.preview);
  const viewMode = useStudioStore((s) => s.viewMode);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useThree((s) => s.controls) as unknown as OrbitControlsImpl | null;
  const proxy = useMemo(() => new THREE.Group(), []);
  const highlight = useMemo(() => new THREE.Mesh(EMPTY, SELECTED_MATERIAL), []);
  const handle = useRef<TransformControlsImpl | null>(null);
  const start = useRef({ turn: 0, size: 1 });

  // the highlight hangs off the group imperatively, so React never sees the geometry
  useEffect(() => {
    proxy.add(highlight);
    handleState.axis = () => (handle.current as unknown as { axis?: string | null } | null)?.axis ?? null;
    return () => { proxy.remove(highlight); handleState.axis = () => null; };
  }, [proxy, highlight]);

  // rebuild the highlight whenever the selection or the preview changes, and put the
  // group back on the spot the drop worked out (which also clears the last drag)
  useLayoutEffect(() => {
    const r = selected && preview ? preview.propRanges.find((x) => x.id === selected) : undefined;
    const at = selected && preview ? preview.placements.find((x) => x.id === selected) : undefined;
    if (highlight.geometry !== EMPTY) highlight.geometry.dispose();
    if (!preview || !r || !at || r.count === 0) {
      highlight.geometry = EMPTY;
      proxy.visible = false;
      invalidate();
      return;
    }
    const src = preview.props.positions;
    const from = r.start * 9;
    const n = r.count * 9;
    const pos = new Float32Array(n);
    for (let i = 0; i < n; i += 3) {
      pos[i] = src[from + i] - at.x;
      pos[i + 1] = src[from + i + 1] - at.y;
      pos[i + 2] = src[from + i + 2] - at.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    highlight.geometry = g;
    proxy.position.set(at.x, at.y, at.z);
    proxy.quaternion.identity();
    proxy.rotation.set(0, 0, 0);
    proxy.scale.set(1, 1, 1);
    proxy.visible = true;
    invalidate();
  }, [selected, preview, proxy, highlight, invalidate]);

  const onGrab = useCallback(() => {
    handleState.busy = true;
    start.current = { turn: turnDeg(proxy.quaternion), size: proxy.scale.x };
  }, [proxy]);

  // whichever way the resize handle was dragged, a prop only ever changes size evenly
  const onDrag = useCallback(() => {
    if (useStudioStore.getState().transformMode !== 'size') return;
    const s = proxy.scale;
    const even = [s.x, s.y, s.z].reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);
    s.set(even, even, even);
  }, [proxy]);

  const onRelease = useCallback(() => {
    const st = useStudioStore.getState();
    const id = st.selectedPropId;
    if (id) {
      const t: PropTransform = {};
      if (st.transformMode === 'move') { t.x = proxy.position.x; t.y = proxy.position.y; }
      else if (st.transformMode === 'turn') t.rotDegDelta = turnDeg(proxy.quaternion) - start.current.turn;
      else t.scaleFactor = start.current.size === 0 ? 1 : proxy.scale.x / start.current.size;
      st.commitPropTransform(id, t);
    }
    // letting the handle go switches the turn-the-view controls back on, which the
    // top view does not want; that happens just after this, so undo it just after that
    window.setTimeout(() => {
      handleState.busy = false;
      if (controls) controls.enabled = useStudioStore.getState().viewMode === 'orbit';
    }, 0);
  }, [proxy, controls]);

  return (
    <>
      {/* the group has to be in the scene for its child (the highlight) to be drawn at all */}
      <primitive object={proxy} dispose={null} />
      {selected && (
        <TransformControls
          ref={handle}
          object={proxy}
          mode={mode === 'move' ? 'translate' : mode === 'turn' ? 'rotate' : 'scale'}
          space="world"
          size={viewMode === 'top' ? 0.6 : 0.8}
          showX={mode !== 'turn'}
          showY={mode !== 'turn'}
          showZ={mode !== 'move'}
          onMouseDown={onGrab}
          onObjectChange={onDrag}
          onMouseUp={onRelease}
        />
      )}
    </>
  );
}

function Cameras() {
  const mode = useStudioStore((s) => s.viewMode);
  const board = useStudioStore((s) => s.doc?.board);
  const { gl, invalidate } = useThree();
  const orthoRef = useRef<THREE.OrthographicCamera>(null);
  const perspRef = useRef<THREE.PerspectiveCamera>(null);
  const orbitRef = useRef<OrbitControlsImpl>(null);
  const framedKey = useRef('');

  useEffect(() => {
    if (!board) return;
    const key = `${board.shape.w}x${board.shape.d}x${board.margin ?? 0}|${mode}`;
    if (framedKey.current === key) return;
    framedKey.current = key;
    const m = board.margin ?? 0;
    const w = board.shape.w + 2 * m, d = board.shape.d + 2 * m;
    if (mode === 'top') {
      const cam = orthoRef.current;
      if (cam) {
        const cw = gl.domElement.clientWidth || 1, ch = gl.domElement.clientHeight || 1;
        cam.position.set(0, 0, 1000);
        cam.rotation.set(0, 0, 0);
        cam.zoom = Math.min(cw / (w * 1.2), ch / (d * 1.2));
        cam.updateProjectionMatrix();
      }
    } else {
      const cam = perspRef.current, controls = orbitRef.current;
      if (cam && controls) {
        const diag = Math.hypot(w, d, 20);
        const dir = new THREE.Vector3(0.7, -1.1, 0.8).normalize();
        cam.position.set(dir.x * diag * 1.3, dir.y * diag * 1.3, dir.z * diag * 1.3);
        controls.target.set(0, 0, 3);
        controls.update();
      }
    }
    invalidate();
  }, [board, mode, gl, invalidate]);

  return (
    <>
      <OrthographicCamera ref={orthoRef} makeDefault={mode === 'top'} near={1} far={5000} position={[0, 0, 1000]} zoom={4} />
      <PerspectiveCamera ref={perspRef} makeDefault={mode === 'orbit'} near={1} far={20000} fov={45} up={[0, 0, 1]} />
      <OrbitControls ref={orbitRef} makeDefault enabled={mode === 'orbit'} enableDamping={false} />
    </>
  );
}

function Scene() {
  const board = useStudioStore((s) => s.doc?.board);
  const size = board ? Math.max(board.shape.w, board.shape.d) : 150;
  return (
    <>
      <color attach="background" args={['#24262b']} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#ffffff', '#3a3d44', 0.8]} position={[0, 0, 1]} />
      <directionalLight position={[150, -220, 320]} intensity={1.15} />
      <directionalLight position={[-120, 150, 180]} intensity={0.35} />
      <Grid position={[0, 0, 0.001]} rotation={[-Math.PI / 2, 0, 0]} args={[size * 1.6, size * 1.6]} cellSize={1} cellThickness={0.5} cellColor="#4a4d55" sectionSize={10} sectionThickness={1} sectionColor="#6a6f78" fadeDistance={size * 5} fadeStrength={1} infiniteGrid={false} followCamera={false} />
      <PreviewMeshes />
      <SelectedProp />
      <Cameras />
    </>
  );
}

export function StudioViewport() {
  const previewing = useStudioStore((s) => s.previewing);
  const preview = useStudioStore((s) => s.preview);
  const error = useStudioStore((s) => s.error);
  const warnings = preview?.warnings ?? [];
  return (
    // Fills the .studio-viewport host absolutely, exactly like the cutter's ViewportSlot fills
    // .viewport-host. r3f measures this container, so it must have a definite size of its own:
    // a second .studio-viewport nested in the first one had no height (its parent is not a flex
    // container, so flex:1 did nothing) and the canvas fell back to its intrinsic 300 x 150.
    <div className="studio-canvas-host">
      <Canvas frameloop="demand" gl={{ antialias: true, powerPreference: 'high-performance' }} dpr={1} style={{ width: '100%', height: '100%', display: 'block' }}>
        <Scene />
      </Canvas>
      {(previewing || !preview) && (
        <div style={{ position: 'absolute', top: 8, right: 8, padding: '2px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.45)', color: '#e8e2d2', fontSize: 12, pointerEvents: 'none' }}>
          {previewing ? 'Updating…' : 'Building the preview…'}
        </div>
      )}
      {(error || warnings.length > 0) && (
        <div className="studio-warn">{error ?? warnings.slice(0, 3).join(' · ')}</div>
      )}
    </div>
  );
}
