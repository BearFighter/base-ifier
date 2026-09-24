/**
 * The control strip above the view. What it offers depends on the mode:
 *  - Single base: place one base on the big base.
 *  - Diorama: add bases straight onto the big base; leftovers are kept at Base-ify.
 *  - Multibase: place a unit frame on the big base, then add bases inside the frame.
 *  - Movement tray: the same, and every base also leaves a slot in a tray.
 * Nothing is cut here; that happens when you press Base-ify.
 */
import { useMemo, useState } from 'react';
import type { Shape } from '@/kernel/types';
import { SYSTEMS, allPresets, presetLabel, type BasePreset } from '@/model/presets';
import { profileForSystem, TRAY_FLOOR_MAX, TRAY_FLOOR_MIN } from '@/model/defaults';
import { usesFrames } from '@/model/rules';
import { largestEmptyRect } from '@/kernel/geom2d/maxEmptyRect';
import { useAppStore } from '@/state/project';
import { TRAY_HELP } from '@/ui/tray/TrayBits';
import { useBases, type BaseBox } from './useBases';
import type { Rect } from './snap';
import './cutter.css';

const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function AddBar() {
  const B = useBases();
  const presets = useMemo(() => allPresets(), []);
  const [baseKey, setBaseKey] = useState('');
  const [frameKey, setFrameKey] = useState('');
  const [baseShape, setBaseShape] = useState<Shape>({ kind: 'rect', w: 25, d: 25 });
  const [frameShape, setFrameShape] = useState<Shape>({ kind: 'rect', w: 125, d: 50 });
  const [note, setNote] = useState<string | null>(null);
  const [frameRowOpen, setFrameRowOpen] = useState(false);
  const [baseSpacing, setBaseSpacing] = useState(0);
  // the tray of the frame in hand, once it has been made, so its measurements can be reported
  // the tray of the frame in hand, once it has been made, so its measurements are reported
  const frameInHandId = useAppStore((s) => {
    const sel = s.project.selectedId ? s.project.pieces[s.project.selectedId] : undefined;
    if (!sel) return undefined;
    if (sel.role === 'frame') return sel.id;
    if (sel.role === 'tray') return sel.trayOf;
    const parent = sel.parentId ? s.project.pieces[sel.parentId] : undefined;
    return parent?.role === 'frame' ? parent.id : undefined;
  });
  const trayPiece = useAppStore((s) => Object.values(s.project.pieces).find((p) => p.role === 'tray' && (!frameInHandId || p.trayOf === frameInHandId)));
  const trayInfo = useAppStore((s) => (trayPiece ? s.geometry[trayPiece.id]?.data?.tray : undefined));

  if (!B.root || !B.selected || !B.selectedBox) return null;
  const mode = B.workMode;
  const tray = B.trayDefaults;
  const rootBox = B.boxes.find((b) => b.depth === 0)!;
  const selBox = B.selectedBox;
  // the frame that bases go into (multibase): the selected frame, or the frame of the selected base
  const frameBox: BaseBox | undefined =
    selBox.piece.role === 'frame' ? selBox : selBox.depth === 2 && selBox.piece.parentId ? B.boxes.find((b) => b.id === selBox.piece.parentId) : undefined;
  // movement tray mode without any frame: bases go straight on the scene, and the whole scene is the tray
  const baseTarget: BaseBox | undefined = frameBox ?? (mode === 'tray' && !B.boxes.some((b) => b.piece.role === 'frame') ? rootBox : undefined);
  // ...and then the rim is the wall kept between the bases and the scene's edge, so no slot opens at the side
  const sceneWall = baseTarget === rootBox ? r2(tray.edge + tray.gap) : 0;
  const framePresets = presets.filter((p) => p.kind === 'footprint');
  const basePresets = presets.filter((p) => p.kind === 'base');
  const keyOf = (p: BasePreset) => `${p.system}|${p.kind}|${p.name}`;
  const byKey = (k: string) => presets.find((p) => keyOf(p) === k);

  const setBase = (k: string) => { setBaseKey(k); const p = byKey(k); if (p) setBaseShape({ kind: p.shape.kind, w: p.w, d: p.d }); };
  const setFrame = (k: string) => { setFrameKey(k); const p = byKey(k); if (p) setFrameShape({ kind: p.shape.kind, w: p.w, d: p.d }); };
  // the edge shape follows the game system of the picked size, else the project's default (tray slots are sized from the base's bottom outline, so any edge shape fits)
  const profileFor = (k: string) => (byKey(k) && profileForSystem(byKey(k)!.system)) ?? B.defaultProfile;

  /** place `shape` inside `target`'s usable area; auto-turn to fit */
  const place = (target: BaseBox, shape: Shape, opts: { role: 'base' | 'frame'; name?: string; key: string; fillGrid?: boolean; margin?: number }) => {
    // In tray mode a frame needs room for its rim as well, or the scene clips the tray short
    const margin = opts.margin ?? 0;
    const area = { w: r2(target.usable.w - 2 * margin), d: r2(target.usable.h - 2 * margin) };
    const cx = target.usable.x + target.usable.w / 2, cy = target.usable.y + target.usable.h / 2;
    const children = B.boxes.filter((b) => b.piece.parentId === target.id).map((b) => ({ x: b.rect.x - cx + area.w / 2, y: b.rect.y - cy + area.d / 2, w: b.rect.w, h: b.rect.h }));
    let s = shape;
    const fits = (q: Shape) => q.w <= area.w + 1e-6 && q.d <= area.d + 1e-6;
    if (!fits(s) && fits({ ...s, w: s.d, d: s.w })) s = { ...s, w: s.d, d: s.w };
    if (!fits(s)) { setNote(`${num(shape.w)} × ${num(shape.d)} mm does not fit in the ${num(area.w)} × ${num(area.d)} mm area${margin > 0 ? `, which is what is left once the tray's rim is allowed for` : ''}.`); return; }
    const turned = s !== shape;
    if (opts.fillGrid) {
      // n bases with (n - 1) gaps between them have to fit the area
      const gap = mode === 'tray' ? Math.max(0, baseSpacing) : 0;
      const cols = Math.max(1, Math.floor((area.w + gap + 1e-6) / (s.w + gap))), rows = Math.max(1, Math.floor((area.d + gap + 1e-6) / (s.d + gap)));
      const drafts = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = c * (s.w + gap), y = r * (s.d + gap);
        const rect: Rect = { x, y, w: s.w, h: s.d };
        if (children.some((o) => overlaps(o, rect))) continue;
        drafts.push({ shape: s, xy: [r2(x + s.w / 2 - area.w / 2), r2(y + s.d / 2 - area.d / 2)] as [number, number], rotDeg: 0, profile: profileFor(opts.key), role: opts.role });
      }
      if (!drafts.length) { setNote('No room left for bases of that size.'); return; }
      const ids = B.addPieces(target.id, drafts);
      const leftW = area.w - (cols * s.w + (cols - 1) * gap), leftD = area.d - (rows * s.d + (rows - 1) * gap);
      setNote(`Added ${ids.length} × ${num(s.w)} × ${num(s.d)} mm${turned ? ' (turned to fit)' : ''}${gap > 0 ? ` with ${num(gap)} mm between them` : ''}.` + (leftW > 0.5 || leftD > 0.5 ? ` ${num(Math.max(leftW, leftD))} mm strip left — “Use leftover” keeps it as a base.` : ''));
      return;
    }
    const free = largestEmptyRect({ w: area.w, h: area.d }, children, 0.5);
    let x = area.w / 2 - s.w / 2, y = area.d / 2 - s.d / 2;
    let placedInGap = true;
    if (free && free.w >= s.w - 1e-6 && free.h >= s.d - 1e-6) { x = free.x; y = free.y; }
    else if (children.length) placedInGap = false;
    const id = B.addPiece(target.id, { shape: s, xy: [r2(x + s.w / 2 - area.w / 2), r2(y + s.d / 2 - area.d / 2)], rotDeg: 0, name: opts.name, profile: profileFor(opts.key), role: opts.role });
    if (!id) return;
    B.selectPiece(id);
    setNote(!placedInGap ? 'No empty spot big enough; it was placed in the middle — drag it where you want.' : turned ? 'Turned 90° so it fits.' : null);
  };

  const useLeftover = (target: BaseBox) => {
    const area = { w: r2(target.usable.w), d: r2(target.usable.h) };
    const cx = target.usable.x + target.usable.w / 2, cy = target.usable.y + target.usable.h / 2;
    const children = B.boxes.filter((b) => b.piece.parentId === target.id).map((b) => ({ x: b.rect.x - cx + area.w / 2, y: b.rect.y - cy + area.d / 2, w: b.rect.w, h: b.rect.h }));
    const free = largestEmptyRect({ w: area.w, h: area.d }, children, 0.5);
    if (!free || free.w < 2 || free.h < 2) { setNote('No leftover space here.'); return; }
    const id = B.addPiece(target.id, { shape: { kind: 'rect', w: r2(free.w), d: r2(free.h) }, xy: [r2(free.x + free.w / 2 - area.w / 2), r2(free.y + free.h / 2 - area.d / 2)], rotDeg: 0, name: 'Leftover strip', role: 'base' });
    if (id) { B.selectPiece(id); setNote(null); }
  };

  const sizeInputs = (shape: Shape, set: (s: Shape) => void, wTitle: string) => (
    <>
      <select value={shape.kind} onChange={(e) => set({ ...shape, kind: e.target.value as Shape['kind'] })} title="Square/rectangle or round/oval">
        <option value="rect">Rectangle</option>
        <option value="ellipse">Round / oval</option>
      </select>
      <label title={wTitle}>W <input type="number" step={0.5} min={1} value={num(shape.w)} onChange={(e) => set({ ...shape, w: clampNum(e.target.value, 1, 1000) })} /></label>
      <label title="Depth, front to back (mm)">D <input type="number" step={0.5} min={1} value={num(shape.d)} onChange={(e) => set({ ...shape, d: clampNum(e.target.value, 1, 1000) })} /></label>
      <button type="button" title="Turn 90° (swap width and depth)" onClick={() => set({ ...shape, w: shape.d, d: shape.w })}>⟳</button>
    </>
  );
  const presetSelect = (value: string, onChange: (k: string) => void, list: BasePreset[], placeholder: string, title: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} title={title}>
      <option value="">{placeholder}</option>
      {SYSTEMS.map((sys) => {
        const items = list.filter((x) => x.system === sys.id);
        return items.length ? (
          <optgroup key={sys.id} label={sys.name}>
            {items.map((x) => <option key={keyOf(x)} value={keyOf(x)}>{presetLabel(x)}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
  const MODES: { id: 'multibase' | 'diorama' | 'single' | 'tray'; label: string; blurb: string }[] = [
    { id: 'multibase', label: 'Multibase', blurb: 'Place a unit frame (Kings of War, The Old World…) and cut the bases you want inside it.' },
    { id: 'diorama', label: 'Diorama', blurb: 'Cut the bases you need and keep every scrap of leftover material as extra bases.' },
    { id: 'single', label: 'Single base', blurb: 'Cut one base out of the scene. Nothing else.' },
    { id: 'tray', label: 'Movement tray', blurb: 'Place a unit frame and fill it with bases, and get a tray they slot into as well.' },
  ];
  const modeSeg = (
    <span className="mode-seg" role="radiogroup" aria-label="What are you making?" title={MODES.find((m) => m.id === mode)?.blurb}>
      {MODES.map((m) => (
        <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'active' : ''} title={m.blurb} onClick={() => B.setMode(m.id)}>
          {m.label}
        </button>
      ))}
    </span>
  );
  const deleteBtn = selBox.depth > 0 && (
    <button type="button" className="danger-text" onClick={() => B.requestDeletePiece(selBox.id)} title="Delete the selected item (and anything inside it)">Delete “{selBox.piece.name}”</button>
  );
  const usable = `${num(rootBox.usable.w)} × ${num(rootBox.usable.h)} mm — the flat part you can actually cut from`;
  const usableTitle = 'The sculpted area inside the sloped edge of the scene — the part you can actually cut bases from';
  const frames = B.boxes.filter((b) => b.piece.role === 'frame');

  return (
    <div className="layout-dock">
      <div className="cutter-toolbar">
        {mode === 'single' && (
          <div className="row">
            {modeSeg}
            <span className="lbl" title={usableTitle}><strong>Base to cut out</strong> <span className="muted">({usable})</span></span>
            {presetSelect(baseKey, setBase, basePresets, 'Pick a base size…', 'Standard base sizes by game; or type a size in W and D')}
            {sizeInputs(baseShape, setBaseShape, 'Width, left to right (mm)')}
            <button type="button" className="primary" disabled={rootBox.piece.children.length > 0} onClick={() => place(rootBox, baseShape, { role: 'base', key: baseKey })} title={rootBox.piece.children.length > 0 ? 'One base is already placed — delete it first, or switch to Diorama to keep several' : 'Place this base on the scene'}>Place base</button>
            {deleteBtn}
          </div>
        )}
        {mode === 'diorama' && (
          <div className="row">
            {modeSeg}
            <span className="lbl" title={usableTitle}><strong>Bases to cut out</strong> <span className="muted">({usable})</span></span>
            {presetSelect(baseKey, setBase, basePresets, 'Pick a base size…', 'Standard base sizes by game; or type a size in W and D')}
            {sizeInputs(baseShape, setBaseShape, 'Width, left to right (mm)')}
            <button type="button" className="primary" onClick={() => place(rootBox, baseShape, { role: 'base', key: baseKey })} title="Add one base in the largest free spot">+ Add one</button>
            <button type="button" onClick={() => place(rootBox, baseShape, { role: 'base', key: baseKey, fillGrid: true })} title="Fill the big base with as many of these as fit">Fill</button>
            {deleteBtn}
          </div>
        )}
        {usesFrames(mode) && (
          <>
            {frames.length > 0 && !frameRowOpen ? (
              <div className="row">
                {modeSeg}
                <span className="lbl"><strong>1 · Unit frame</strong> <span className="muted">{frames.map((f) => `${f.piece.name} ${num(f.rect.w)} × ${num(f.rect.h)} mm`).join(', ')}</span></span>
                <button type="button" onClick={() => setFrameRowOpen(true)} title="Show the frame controls to add another frame">Add another frame…</button>
              </div>
            ) : (
              <div className="row">
                {modeSeg}
                <span className="lbl" title={usableTitle}><strong>1 · Unit frame</strong> <span className="muted">({usable})</span></span>
                {presetSelect(frameKey, setFrame, framePresets, 'Pick a unit frame…', 'Whole-unit frame sizes for Kings of War and The Old World; or type a size')}
                {sizeInputs(frameShape, setFrameShape, 'Frontage, left to right (mm)')}
                <button type="button" className="primary" onClick={() => { place(rootBox, frameShape, { role: 'frame', key: frameKey, name: byKey(frameKey)?.name, margin: mode === 'tray' ? tray.edge + 0.05 : 0 }); setFrameRowOpen(false); }} title={mode === 'tray' ? 'Place a frame of this size on the scene, leaving room for the tray rim around it; bases go inside it' : 'Place a frame of this size on the scene; bases go inside it'}>Place frame</button>
                {frames.length > 0 && <button type="button" onClick={() => setFrameRowOpen(false)} title="Hide the frame controls">Done</button>}
              </div>
            )}
            <div className="row">
              <span className="lbl"><strong>2 · Bases {baseTarget === rootBox ? 'on the scene' : <>inside {frameBox ? `“${frameBox.piece.name}”` : 'the frame'}</>}</strong>{baseTarget && <span className="muted"> ({num(baseTarget.usable.w)} × {num(baseTarget.usable.h)} mm)</span>}</span>
              {presetSelect(baseKey, setBase, basePresets, 'Pick a base size…', 'Individual base sizes by game; or type a size')}
              {sizeInputs(baseShape, setBaseShape, 'Width, left to right (mm)')}
              <button type="button" className="primary" disabled={!baseTarget} onClick={() => baseTarget && place(baseTarget, baseShape, { role: 'base', key: baseKey, margin: sceneWall })} title={baseTarget === rootBox ? 'Add one base in the largest free spot of the scene' : baseTarget ? 'Add one base in the largest free spot of the frame' : 'Place a frame first'}>+ Add one</button>
              <button type="button" disabled={!baseTarget} onClick={() => baseTarget && place(baseTarget, baseShape, { role: 'base', key: baseKey, fillGrid: true, margin: sceneWall })} title={baseTarget === rootBox ? 'Fill the scene with as many of these as fit' : baseTarget ? 'Fill the frame with as many of these as fit' : 'Place a frame first'}>{baseTarget === rootBox ? 'Fill scene' : 'Fill frame'}</button>
              {mode === 'tray' && (
                <label title={TRAY_HELP.spacing}>Space between bases <input type="number" step={0.5} min={0} max={10} value={num(baseSpacing)} onChange={(e) => setBaseSpacing(clampNum(e.target.value, 0, 10))} /> mm</label>
              )}
              {baseTarget !== rootBox && <button type="button" disabled={!frameBox} onClick={() => frameBox && useLeftover(frameBox)} title="Turn the largest empty part of the frame into a base (e.g. the back strip)">Use leftover</button>}
              {deleteBtn}
            </div>
            {mode === 'tray' && (
              <div className="row">
                <span className="lbl"><strong>3 · The tray</strong></span>
                <label title={TRAY_HELP.floor}>Floor <input type="number" step={0.1} min={TRAY_FLOOR_MIN} max={TRAY_FLOOR_MAX} value={num(tray.floor)} onChange={(e) => B.setTraySettings({ floor: clampNum(e.target.value, TRAY_FLOOR_MIN, TRAY_FLOOR_MAX) })} /> mm</label>
                <label title={TRAY_HELP.gap}>Room around each base <input type="number" step={0.05} min={0} max={1} value={num(tray.gap)} onChange={(e) => B.setTraySettings({ gap: clampNum(e.target.value, 0, 1) })} /> mm</label>
                <label title={TRAY_HELP.edge}>Rim <input type="number" step={0.5} min={0} max={20} value={num(tray.edge)} onChange={(e) => B.setTraySettings({ edge: clampNum(e.target.value, 0, 20) })} /> mm</label>
                <label title={TRAY_HELP.magnets}><input type="checkbox" checked={tray.magnets} onChange={(e) => B.setTraySettings({ magnets: e.target.checked })} /> Magnets in the floor</label>
              </div>
            )}
          </>
        )}
        {(note || B.showHelp) && (
          <div className="row">
            <span className={note ? 'warn' : 'hint'}>
              {note ?? (mode === 'tray'
                ? (frameBox ? TRAY_HELP.intro : 'Place a unit frame for a tray the size of one unit, or skip the frame and put bases straight on the scene: then the whole scene becomes the tray. When you press Base-ify you get the bases and a tray they drop into.')
                : mode === 'multibase'
                ? (frameBox
                  ? 'Add the removable row first if you want one (e.g. a 25 × 125 strip), then “Fill frame” with the small bases. Drag things to move them; corners resize. Press Base-ify when the layout looks right.'
                  : 'Pick a unit frame and press “Place frame”, then fill it with bases. A frame with nothing inside is printed as one solid multibase.')
                : mode === 'diorama'
                  ? 'The size in brackets is the flat part inside the sloped edge of the scene — the part you can cut from. Add the bases you need anywhere on it; when you press Base-ify, all the material left over becomes extra bases automatically.'
                  : rootBox.piece.children.length > 1
                    ? `Single base mode shows one base, but ${rootBox.piece.children.length} are placed. Delete the extras (Bases tab) or switch to Diorama to keep them.`
                    : 'Pick the size of the base you want and press “Place base”. Drag it to the part of the scene you like, then press Base-ify.')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function overlaps(a: Rect, b: Rect): boolean {
  const eps = 1e-6;
  return a.x + a.w > b.x + eps && b.x + b.w > a.x + eps && a.y + a.h > b.y + eps && b.y + b.h > a.y + eps;
}

function clampNum(v: string, lo: number, hi: number): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
