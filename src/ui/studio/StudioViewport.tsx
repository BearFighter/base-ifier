/**
 * Base Studio's 3D view: the ground and props preview from the studio store,
 * rendered like the cutter's viewport (flat shading, demand frames, meshes
 * reach three.js through refs, never through React props).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useStudioStore } from '@/studio/store';
import type { MeshTransfer } from '@/worker/api';

const GROUND_MATERIAL = new THREE.MeshStandardMaterial({ color: '#c9bfa8', flatShading: true });
const PROP_MATERIAL = new THREE.MeshStandardMaterial({ color: '#8f8a80', flatShading: true });
const PLATE_MATERIAL = new THREE.MeshStandardMaterial({ color: '#6e6a63', flatShading: true });
const EMPTY = new THREE.BufferGeometry();

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
  const board = useStudioStore((s) => s.doc?.board);
  const invalidate = useThree((s) => s.invalidate);
  const groundGeom = useSoupGeometry(ground);
  const propGeom = useSoupGeometry(props);
  const groundMesh = useMemo(() => new THREE.Mesh(EMPTY, GROUND_MATERIAL), []);
  const propMesh = useMemo(() => new THREE.Mesh(EMPTY, PROP_MATERIAL), []);
  const plateMesh = useMemo(() => new THREE.Mesh(EMPTY, PLATE_MATERIAL), []);

  useLayoutEffect(() => {
    groundMesh.geometry = groundGeom ?? EMPTY;
    groundMesh.visible = !!groundGeom;
    propMesh.geometry = propGeom ?? EMPTY;
    propMesh.visible = !!propGeom;
    invalidate();
  }, [groundMesh, propMesh, groundGeom, propGeom, invalidate]);

  // the plate under the ground, so the board reads as a base
  useLayoutEffect(() => {
    if (!board) { plateMesh.visible = false; return; }
    const m = board.margin ?? 0;
    const w = board.shape.w + 2 * m, d = board.shape.d + 2 * m;
    const g = board.shape.kind === 'ellipse' ? new THREE.CylinderGeometry(0.5, 0.5, board.plateTop, 64) : new THREE.BoxGeometry(1, board.plateTop, 1);
    g.rotateX(Math.PI / 2);
    plateMesh.geometry.dispose();
    plateMesh.geometry = g;
    plateMesh.scale.set(w, d, 1);
    plateMesh.position.set(0, 0, board.plateTop / 2);
    plateMesh.visible = true;
    invalidate();
  }, [board, plateMesh, invalidate]);

  return (
    <>
      <primitive object={plateMesh} />
      <primitive object={groundMesh} />
      <primitive object={propMesh} />
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
      <OrbitControls ref={orbitRef} enabled={mode === 'orbit'} enableDamping={false} />
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
