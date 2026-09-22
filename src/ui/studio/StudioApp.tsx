/**
 * Base Studio: the second surface of the app. One tabbed left menu (Board /
 * Ground / Props / Rules), the studio viewport, and one big button, "Use this
 * scene", which bakes the scene into a source and returns to the cutter.
 * Same rules as the cutter: no jargon, help on every setting, ids and numbers
 * in React state (meshes stay in the studio store and reach three.js by ref).
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { useAppStore } from '@/state/project';
import { useStudioStore } from '@/studio/store';
import type { StudioTab, TransformMode } from '@/studio/store';
import { Field, Section, Details } from '@/ui/common/Field';
import { Hint } from '@/ui/common/Hint';
import { BOARD_PRESETS, boardMargin, studioId } from '@/kernel/studio/document';
import type { LicenceTag, StudioDocument, StudioLibraryItem } from '@/kernel/studio/document';
import type { PropFamily } from '@/kernel/terrain/presets';
import { GENRE_PRESETS, genrePreset } from '@/kernel/terrain/presets';
import { effectiveHeightCap } from '@/kernel/studio/bake';
import { useMoreBelow } from '@/ui/LeftTabs';
import { StudioViewport } from './StudioViewport';

const STAMP_CHOICES: { id: string; label: string }[] = [
  { id: 'cobbles', label: 'Cobbles' },
  { id: 'bricks', label: 'Bricks' },
  { id: 'plating', label: 'Deck plating' },
  { id: 'grating', label: 'Grating' },
  { id: 'cracks', label: 'Cracks' },
  { id: 'craters', label: 'Craters' },
  { id: 'ripples', label: 'Ripples' },
  { id: 'pebbles', label: 'Pebbles' },
  { id: 'rockNoise', label: 'Rocky ground' },
];

function RangeRow({ value, min, max, step, onChange, format }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="range-row">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{format ? format(value) : value}</output>
    </div>
  );
}

/** How a number is shown once the scene has taken it. */
const shownNumber = (v: number): string => String(Math.round(v * 1000) / 1000);

/**
 * A number box you can actually type in.
 *
 * The box is left alone (uncontrolled) while the cursor is in it. React writes
 * its value back into an `<input type="number">` on every render and the browser
 * throws away anything that is not a finished number, so with the old controlled
 * box "-" on the way to "-35" read back as "", became 0, wiped the minus sign,
 * and "-35" came out as **+35** — in three separate undo steps. Letting the
 * browser keep the half-typed text fixes that; the scene's own value is written
 * back the moment the box loses focus, so a clamped or rounded number still shows.
 *
 * `live` (the default) hands every finished number over as it is typed, so the
 * view follows along — the store folds the burst into one undo step. Turn it off
 * where half a number would rearrange things: the board size, where the "1" on
 * the way to "150" would shrink the board and drag every prop in with it.
 */
function DraftNumber({ value, min, max, step, live = true, title, style, onChange }: {
  value: number;
  min?: number;
  max?: number;
  step: number;
  live?: boolean;
  title?: string;
  style?: CSSProperties;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const text = shownNumber(value);
  // show what the scene took — but never while the box is being typed in
  useEffect(() => {
    const el = ref.current;
    if (el && !editing.current && el.value !== text) el.value = text;
  });
  const commit = (raw: string) => {
    const v = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(v)) onChange(v);
  };
  return (
    <input
      ref={ref}
      type="number"
      defaultValue={text}
      min={min}
      max={max}
      step={step}
      title={title}
      style={style}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => { if (live) commit(e.target.value); }}
      onBlur={(e) => { editing.current = false; commit(e.target.value); bump(); }}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(e.currentTarget.value); e.currentTarget.blur(); } }}
    />
  );
}

/**
 * One number with its own name, unit and explanation. Every number the user can
 * change says what it is: the old rows of bare boxes left people guessing.
 */
function NumberField({ label, unit, help, value, min, max, step, live, onChange }: {
  label: string;
  unit?: string;
  help: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  live?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} unit={unit} help={help}>
      <DraftNumber value={value} min={min} max={max} step={step} live={live} onChange={onChange} />
    </Field>
  );
}

function useDoc(): StudioDocument {
  const doc = useStudioStore((s) => s.doc);
  if (!doc) throw new Error('Base Studio opened without a scene');
  return doc;
}

// ---------------------------------------------------------------- Board

function BoardPanel() {
  const doc = useDoc();
  const update = useStudioStore((s) => s.update);
  const { shape } = doc.board;
  const groups = Array.from(new Set(BOARD_PRESETS.map((b) => b.group)));
  const current = BOARD_PRESETS.find((b) => b.shape.kind === shape.kind && b.shape.w === shape.w && b.shape.d === shape.d)?.id ?? 'custom';
  return (
    <div className="studio-panel">
      <Field label="Scene name" help="Shows up in the Scene tab once the scene is handed over to be cut into bases.">
        <input type="text" value={doc.name} onChange={(e) => update((d) => { d.name = e.target.value; }, { history: false })} />
      </Field>
      <Field label="Board" help="Pick the size of ground to build. A single base size cuts out one base; a unit size (the same unit frame you place on the Bases screen) cuts out a group; a bigger rectangle lets you cut several separate bases from one scene.">
        <select value={current} onChange={(e) => { const p = BOARD_PRESETS.find((b) => b.id === e.target.value); if (p) update((d) => { d.board.shape = { ...p.shape }; d.board.margin = boardMargin(p); }); }}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {BOARD_PRESETS.filter((b) => b.group === g).map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </optgroup>
          ))}
          {current === 'custom' && <option value="custom">Custom size</option>}
        </select>
      </Field>
      <div className="field-row">
        <Field label="Width" unit="mm" help="How wide the ground is, left to right. Press Enter or click away to use it.">
          <DraftNumber value={shape.w} min={10} max={1000} step={1} live={false} onChange={(v) => update((d) => { d.board.shape.w = Math.max(10, Math.min(1000, v)); })} />
        </Field>
        <Field label="Depth" unit="mm" help="How deep the ground is, front to back. Press Enter or click away to use it.">
          <DraftNumber value={shape.d} min={10} max={1000} step={1} live={false} onChange={(v) => update((d) => { d.board.shape.d = Math.max(10, Math.min(1000, v)); })} />
        </Field>
      </div>
      <Field label="Shape" help="Round boards come out as ovals; everything else is a rectangle whose sides lean in very slightly, like a shop-bought base.">
        <select value={shape.kind} onChange={(e) => update((d) => { d.board.shape.kind = e.target.value as 'rect' | 'ellipse'; })}>
          <option value="rect">Rectangle</option>
          <option value="ellipse">Round / oval</option>
        </select>
      </Field>
      <Field label="Room around it" unit="mm" help="Single bases and unit sizes get this much spare ground on every side, so the cut edge comes out clean. Leave it at 0 for a big board you are cutting many bases from.">
        <DraftNumber value={doc.board.margin ?? 0} min={0} max={10} step={0.5} live={false} onChange={(v) => update((d) => { d.board.margin = Math.max(0, Math.min(10, v)); })} />
      </Field>
      <Hint>
        {(doc.board.margin ?? 0) > 0
          ? `The board is ${shape.w + 2 * (doc.board.margin ?? 0)} × ${shape.d + 2 * (doc.board.margin ?? 0)} mm: your ${shape.w} × ${shape.d} plus ${doc.board.margin} mm all round. Back on the Bases screen, place a ${shape.w} × ${shape.d} base or frame on it and press Base-ify.`
          : `Bases are cut from inside this ${shape.w} × ${shape.d} mm board. The plate under the ground is ${doc.board.plateTop} mm thick, and every cut base gets the same edge, hollow underside and magnets as one cut from an STL.`}
        {' '}Change the size and your props are placed again to fit — Undo puts them back.
      </Hint>
    </div>
  );
}

// ---------------------------------------------------------------- Ground

function GroundPanel() {
  const doc = useDoc();
  const update = useStudioStore((s) => s.update);
  const preset = genrePreset(doc.ground.presetId);
  const worlds: { id: 'fantasy' | 'scifi' | 'historical' | 'any'; label: string }[] = [
    { id: 'fantasy', label: 'Fantasy' },
    { id: 'scifi', label: 'Sci-fi' },
    { id: 'historical', label: 'Historical' },
    { id: 'any', label: 'Any setting' },
  ];
  return (
    <div className="studio-panel">
      <Section title="Ground style" subtitle={`Pick the look of the ground. Right now: ${preset.label} — ${preset.help.charAt(0).toLowerCase()}${preset.help.slice(1)}`}>
        {worlds.map((w) => {
          const items = GENRE_PRESETS.filter((p) => p.world === w.id);
          if (items.length === 0) return null;
          return (
            <div key={w.id}>
              <div className="panel-subtitle">{w.label}</div>
              <div className="preset-grid">
                {items.map((p) => (
                  <button key={p.id} type="button" className={p.id === doc.ground.presetId ? 'active' : ''} title={p.help} onClick={() => update((d) => { d.ground.presetId = p.id; })}>
                    {p.label}
                    <small>{p.help}</small>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </Section>
      <Field label="Roughness" help="How much the ground rises and falls. 1× is this style's own look; less is flatter, more is more rugged.">
        <RangeRow value={doc.ground.roughness} min={0.3} max={2} step={0.05} onChange={(v) => update((d) => { d.ground.roughness = v; })} format={(v) => v.toFixed(2) + '×'} />
      </Field>
      <Field label="Texture" help="Strength of the surface pattern (flagstones, plating, ripples). 0 turns it off.">
        <RangeRow value={doc.ground.texture} min={0} max={2} step={0.05} onChange={(v) => update((d) => { d.ground.texture = v; })} format={(v) => v.toFixed(2) + '×'} />
      </Field>
      <div className="button-row">
        <button type="button" onClick={() => update((d) => { d.ground.seed = (d.ground.seed * 1664525 + 1013904223) >>> 0; })} title="Keeps all your other settings and draws the ground again with a new random pattern.">
          Try a different layout
        </button>
      </div>
      <Hint>Keeps all your other settings and draws the ground again with a new random pattern.</Hint>
      <Details summary={`Extra patterns (${doc.ground.stamps.length})`}>
        <Hint>Presses one pattern into a single spot on the ground. Each one starts in the middle until you give it a position.</Hint>
        <div className="button-row">
          <select id="studio-stamp-pick" defaultValue="cobbles">
            {STAMP_CHOICES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button type="button" onClick={() => {
            const pick = (document.getElementById('studio-stamp-pick') as HTMLSelectElement | null)?.value ?? 'cobbles';
            const size = Math.min(doc.board.shape.w, doc.board.shape.d) * 0.5;
            update((d) => { d.ground.stamps.push({ id: studioId('sp'), stamp: pick, x: 0, y: 0, size, strength: 0.8, rotDeg: 0 }); });
          }}>
            Add
          </button>
        </div>
        <ul className="card-list">
          {doc.ground.stamps.map((s) => (
            <li key={s.id} className="card-item">
              <div className="card-head">
                <span className="card-name">{STAMP_CHOICES.find((c) => c.id === s.stamp)?.label ?? s.stamp}</span>
                <button type="button" className="icon-button" title="Take this pattern off the ground" onClick={() => update((d) => { d.ground.stamps = d.ground.stamps.filter((q) => q.id !== s.id); })}>×</button>
              </div>
              <div className="field-grid">
                <NumberField label="Left / right" unit="mm" step={1} value={s.x} help="Where it sits across the board. 0 is the middle; a bigger number moves it right."
                  onChange={(v) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.x = v; }, { coalesce: `${s.id}:x` })} />
                <NumberField label="Front / back" unit="mm" step={1} value={s.y} help="Where it sits up the board. 0 is the middle; a bigger number moves it towards the back."
                  onChange={(v) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.y = v; }, { coalesce: `${s.id}:y` })} />
                <NumberField label="Size" unit="mm" step={1} min={2} value={s.size} help="How wide a patch of ground the pattern covers."
                  onChange={(v) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.size = Math.max(2, v); }, { coalesce: `${s.id}:size` })} />
                <NumberField label="Height" unit="mm" step={0.1} min={0} max={5} value={s.strength} help="How far the pattern stands up out of the ground."
                  onChange={(v) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.strength = Math.max(0, Math.min(5, v)); }, { coalesce: `${s.id}:h` })} />
              </div>
            </li>
          ))}
        </ul>
      </Details>
      {doc.ground.strokes.length > 0 && (
        <div className="button-row">
          <button type="button" title="Undoes every change you painted on the ground by hand" onClick={() => update((d) => { d.ground.strokes = []; })}>Clear painted changes ({doc.ground.strokes.length})</button>
        </div>
      )}
      <Details summary="Technical details">
        <div className="field-row">
          <span>Pattern number</span>
          <span>{doc.ground.seed}</span>
        </div>
        <Hint>The number the random pattern is drawn from. Two scenes with the same number and the same settings come out identical. “Try a different layout” picks a new one.</Hint>
      </Details>
    </div>
  );
}

// ---------------------------------------------------------------- Props

const FAMILY_CHOICES: { id: PropFamily | 'any'; label: string }[] = [
  { id: 'rock', label: 'Rock' },
  { id: 'debris', label: 'Debris' },
  { id: 'scifi', label: 'Sci-fi' },
  { id: 'ruin', label: 'Ruin' },
  { id: 'alien', label: 'Alien' },
  { id: 'wood', label: 'Wood' },
  { id: 'bone', label: 'Bone' },
  { id: 'ground', label: 'Ground cover' },
  { id: 'any', label: 'Any' },
];

const LICENCE_CHOICES: { id: LicenceTag; label: string }[] = [
  { id: 'own-rights', label: 'Own work' },
  { id: 'cc0', label: 'CC0' },
  { id: 'attribution', label: 'Attribution' },
  { id: 'personal-only', label: 'Personal use only' },
  { id: 'no-derivatives', label: 'No derivatives' },
  { id: 'merchant-prints-only', label: 'Merchant prints only' },
  { id: 'unknown', label: 'Unknown' },
];

/** The Family select's own words, so a hint never shows the raw stored value. */
function familyLabel(f: PropFamily | 'any'): string {
  return (FAMILY_CHOICES.find((c) => c.id === f)?.label ?? f).toLowerCase();
}

const FAMILY_HELP = 'What kind of thing this is. Each ground style asks for certain kinds — rocks on snow, ruins in temple ruins, ground cover in a swamp — and anything marked Any can turn up on all of them';
const LICENCE_HELP = 'Only matters for the commercial, watermark-free export; ordinary exports are watermarked either way';
const WEIGHT_HELP = 'How often it is picked compared with the others';

const mm = (v: number): string => (v >= 10 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());
const tris = (n: number): string => (n >= 1000 ? `${Math.round(n / 1000)}k triangles` : `${n} triangles`);

/** Open the library file picker (shared by the section button and any "file needed" row). */
function pickLibraryFiles() {
  (document.getElementById('studio-library-input') as HTMLInputElement | null)?.click();
}

/** One row of "Your props": the item's name, what it measures, and its three settings. */
function LibraryRow({ id }: { id: string }) {
  const item = useStudioStore((s) => s.doc?.library.find((it) => it.id === id));
  const info = useStudioStore((s) => s.assetInfo[id]);
  const used = useStudioStore((s) => s.doc?.props.filter((p) => p.assetId === id).length ?? 0);
  const updateItem = useStudioStore((s) => s.updateLibraryItem);
  const requestRemove = useStudioStore((s) => s.requestRemoveLibraryItem);
  if (!item) return null;
  return (
    <li className="lib-item">
      <div className="lib-head">
        <input
          type="text"
          className="lib-name"
          value={item.name}
          title="What this prop is called in the lists"
          onChange={(e) => updateItem(id, { name: e.target.value })}
        />
        {!info && <span className="lib-badge warn" title={`${item.fileName} is not loaded in this session`}>file needed</span>}
        {info && info.error && <span className="lib-badge warn" title={info.error}>unreadable</span>}
        {info && !info.error && !info.closed && <span className="lib-badge warn" title="This STL has holes in it, so it cannot be placed. Repair it in your sculpting tool.">open mesh</span>}
        {info && info.heavy && <span className="lib-badge" title="Shown simplified while you work; the exported STL keeps every triangle.">heavy</span>}
        <button type="button" className="icon-button" title="Remove this prop from the scene" onClick={() => requestRemove(id)}>×</button>
      </div>
      <div className="lib-meta">
        {info && info.closed
          ? `${mm(info.footprintRadius * 2)} mm across · ${mm(info.height)} mm tall · ${tris(info.tris)}`
          : `${item.fileName} · ${Math.max(1, Math.round(item.fileSize / 1024))} KB`}
        {used > 0 ? ` · ${used} on the board` : ''}
      </div>
      {!info && (
        <div className="button-row">
          <button type="button" onClick={pickLibraryFiles}>Add the file again…</button>
        </div>
      )}
      <div className="lib-controls">
        <label title={FAMILY_HELP}>
          Family
          <select value={item.family} onChange={(e) => updateItem(id, { family: e.target.value as PropFamily | 'any' })}>
            {FAMILY_CHOICES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label title={LICENCE_HELP}>
          Licence
          <select value={item.licence} onChange={(e) => updateItem(id, { licence: e.target.value as LicenceTag })}>
            {LICENCE_CHOICES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label title={WEIGHT_HELP}>
          How often
          <input
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={item.weight ?? 1}
            onChange={(e) => updateItem(id, { weight: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })}
          />
        </label>
      </div>
    </li>
  );
}

function RemoveLibraryDialog() {
  const id = useStudioStore((s) => s.confirmRemove);
  const name = useStudioStore((s) => (s.confirmRemove ? (s.doc?.library.find((it) => it.id === s.confirmRemove)?.name ?? 'this prop') : ''));
  const count = useStudioStore((s) => (s.confirmRemove ? (s.doc?.props.filter((p) => p.assetId === s.confirmRemove).length ?? 0) : 0));
  const cancel = useStudioStore((s) => s.cancelRemoveLibraryItem);
  const remove = useStudioStore((s) => s.removeLibraryItem);
  if (!id) return null;
  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Remove “{name}”?</h3>
        <p>{count > 0 ? `It is taken out of this scene’s props, and the ${count} ${count === 1 ? 'copy on the board is' : 'copies on the board are'} removed with it. The STL file on disk is not touched.` : 'It is taken out of this scene’s props. The STL file on disk is not touched.'}</p>
        <div className="modal-actions">
          <button type="button" onClick={cancel} autoFocus>Keep it</button>
          <button type="button" className="danger" onClick={() => void remove(id)}>Remove prop</button>
        </div>
      </div>
    </div>
  );
}

function PropsPanel() {
  const doc = useDoc();
  const update = useStudioStore((s) => s.update);
  const scatter = useStudioStore((s) => s.scatter);
  const clearScatter = useStudioStore((s) => s.clearScatter);
  const registerLibraryFiles = useStudioStore((s) => s.registerLibraryFiles);
  const libraryBusy = useStudioStore((s) => s.libraryBusy);
  const assetInfo = useStudioStore((s) => s.assetInfo);
  const select = useStudioStore((s) => s.select);
  const setTransformMode = useStudioStore((s) => s.setTransformMode);
  const removeProp = useStudioStore((s) => s.removeProp);
  const selectedId = useStudioStore((s) => s.selectedPropId);
  const scattered = doc.props.filter((p) => p.scattered).length;
  const placed = doc.props.filter((p) => !p.scattered);
  const preset = genrePreset(doc.ground.presetId);
  const usable = doc.library.filter((it) => assetInfo[it.id]?.closed);
  const names = new Map(doc.library.map((it) => [it.id, it.name]));
  return (
    <div className="studio-panel">
      <Section title="Your props" subtitle="The rocks, ruins and bits strewn over the ground are your own STLs. Nothing else is ever used.">
        <div className="button-row">
          <button type="button" className="primary" disabled={libraryBusy} onClick={pickLibraryFiles}>
            {libraryBusy ? 'Reading…' : 'Add STL props…'}
          </button>
          <span className="muted">{doc.library.length === 0 ? 'none yet' : `${doc.library.length} prop${doc.library.length === 1 ? '' : 's'}`}</span>
        </div>
        <input
          id="studio-library-input"
          type="file"
          accept=".stl"
          multiple
          className="visually-hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) void registerLibraryFiles(files);
          }}
        />
        <Hint>
          Drop STL files anywhere on this page to add them too. Each one keeps three settings:
          <strong> Family</strong> — {FAMILY_HELP}. <strong>Licence</strong> — {LICENCE_HELP}. <strong>How often</strong> — {WEIGHT_HELP}.
        </Hint>
        <ul className="lib-list">
          {doc.library.map((it) => <LibraryRow key={it.id} id={it.id} />)}
        </ul>
        {doc.library.length === 0 && <div className="muted">No props yet. Add your own STLs — a rock, a skull, a broken column — and they are scattered over the generated ground.</div>}
      </Section>

      <Section title="Scatter" subtitle="Strews your props over the ground, keeping clear of the edge and any flat spots you have marked for models.">
        <Field label="How much" help="Light leaves room for models; heavy is a rubble field. Small boards get proportionally less.">
          <select value={doc.rules.density} onChange={(e) => update((d) => { d.rules.density = e.target.value as 'light' | 'medium' | 'heavy'; })}>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="heavy">Heavy</option>
          </select>
        </Field>
        <Field label="Centrepiece" help="One larger prop placed off-centre so it draws the eye, on boards 40 mm and bigger.">
          <input type="checkbox" checked={doc.rules.heroProps} onChange={(e) => update((d) => { d.rules.heroProps = e.target.checked; })} />
        </Field>
        <div className="button-row">
          <button type="button" className="primary" title={scattered ? 'Throws the same props over the ground again in a new arrangement' : 'Spreads your props over the ground for you'} onClick={() => void scatter(true)} disabled={libraryBusy || usable.length === 0}>
            {scattered ? 'Place them again' : 'Scatter props'}
          </button>
          {scattered > 0 && <button type="button" title="Takes the scattered props off the ground; the ones you placed by hand stay" onClick={() => clearScatter()}>Take them off ({scattered})</button>}
        </div>
        {usable.length === 0 ? (
          <div className="muted">Add STL props above to scatter them. The ground is generated; props are yours.</div>
        ) : (
          <Hint>
            This style ({preset.label.toLowerCase()}) asks for {preset.families.map((f) => familyLabel(f.family)).join(', ')} props; anything marked Any is used as well.
            {usable.length < doc.library.length ? ` ${doc.library.length - usable.length} of your ${doc.library.length} props cannot be used yet.` : ''}
            {' '}Change the board, the ground style or how much, and your props are placed again to fit — Undo puts them back.
          </Hint>
        )}
      </Section>

      <SelectedPropSection />

      <Section title="Placed by hand" subtitle="Props you put down yourself never move when the board, the ground or the scatter settings change.">
        {usable.length === 0 ? (
          <div className="muted">Add your STL props above first.</div>
        ) : (
          <div className="button-row">
            <select id="studio-prop-pick" defaultValue={usable[0]?.id ?? ''}>
              {usable.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
            </select>
            <button type="button" title="Puts one down in the middle of the board and picks it up, ready to drag" onClick={() => {
              const pick = (document.getElementById('studio-prop-pick') as HTMLSelectElement | null)?.value;
              const item = usable.find((it) => it.id === pick) ?? usable[0];
              if (!item) return;
              const id = studioId('pr');
              update((d) => {
                d.props.push({ id, assetId: item.id, x: 0, y: 0, rotDeg: 0, scale: 1, sink: 0, seed: (Date.now() % 1e9) >>> 0, licence: item.licence, scattered: false });
              });
              select(id);
              setTransformMode('move');
            }}>
              Add at centre
            </button>
          </div>
        )}
        <ul className="card-list">
          {placed.map((p) => (
            <li key={p.id} className={`card-item card-row${p.id === selectedId ? ' selected' : ''}`}>
              <span className="card-name">{names.get(p.assetId) ?? 'missing prop'}</span>
              <span className="muted">{Math.round(p.x)}, {Math.round(p.y)} mm</span>
              <button type="button" title="Picks this one up in the view so you can drag it or set its numbers" onClick={() => select(p.id)}>
                {p.id === selectedId ? 'Picked up' : 'Select'}
              </button>
              <button type="button" className="icon-button" title="Take this prop off the board" onClick={() => removeProp(p.id)}>×</button>
            </li>
          ))}
        </ul>
        {placed.length === 0 && usable.length > 0 && <div className="muted">Nothing placed by hand yet. Click a prop in the view to pick it up, or add one here.</div>}
      </Section>
      <div className="muted">{doc.props.length} props on the board</div>
    </div>
  );
}

/**
 * The prop the user has picked up, with every number named. Shown for a prop
 * picked in the view as well as one placed by hand: touching any of these makes
 * it the user's, so placing the others again leaves it alone.
 */
function SelectedPropSection() {
  const doc = useDoc();
  const id = useStudioStore((s) => s.selectedPropId);
  const editProp = useStudioStore((s) => s.editProp);
  const removeProp = useStudioStore((s) => s.removeProp);
  const sceneSink = doc.rules.sink;
  const prop = id ? doc.props.find((p) => p.id === id) : undefined;
  if (!id || !prop) return null;
  const name = doc.library.find((it) => it.id === prop.assetId)?.name ?? 'This prop';
  return (
    <Section title="Selected prop" subtitle={`${name} — drag it in the view, or set its numbers here.`}>
      <div className="field-grid">
        <NumberField label="Left / right" unit="mm" step={1} value={prop.x} help="Where it sits across the board. 0 is the middle; a bigger number moves it to the right."
          onChange={(v) => editProp(id, { x: v }, { coalesce: `${id}:x` })} />
        <NumberField label="Front / back" unit="mm" step={1} value={prop.y} help="Where it sits up the board. 0 is the middle; a bigger number moves it towards the back."
          onChange={(v) => editProp(id, { y: v }, { coalesce: `${id}:y` })} />
        <NumberField label="Turn" unit="degrees" step={15} value={prop.rotDeg} help="How far it is turned on the spot. 90 is a quarter turn anticlockwise."
          onChange={(v) => editProp(id, { rotDeg: v }, { coalesce: `${id}:rot` })} />
        <NumberField label="Size" unit="×" step={0.05} min={0.1} max={10} value={prop.scale} help="1 is the STL's own size, 2 is twice as big, 0.5 is half."
          onChange={(v) => editProp(id, { scale: v }, { coalesce: `${id}:scale` })} />
        <NumberField label="Bury" unit="mm" step={0.1} min={0} max={20} value={prop.sink} help={`How much deeper this one goes into the ground than the rest (the scene buries everything ${sceneSink} mm on the Rules tab).`}
          onChange={(v) => editProp(id, { sink: v }, { coalesce: `${id}:sink` })} />
      </div>
      <Hint>
        {prop.scattered
          ? 'Placed for you: it moves when the props are placed again. Drag it or change a number and it stays where you left it.'
          : 'This prop is yours: placing the others again never moves it.'}
        {' '}It always sits on the ground — its height is worked out from the ground under it.
      </Hint>
      <div className="button-row">
        <button type="button" title="Take this prop off the board" onClick={() => removeProp(id)}>Remove this prop</button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Rules

function RulesPanel() {
  const doc = useDoc();
  const update = useStudioStore((s) => s.update);
  const cap = effectiveHeightCap(doc);
  const { w, d } = doc.board.shape;
  return (
    <div className="studio-panel">
      <Field label="Keep clear of the edge" unit="mm" help="Nothing is scattered this close to the edge, so the edge of the board and the cut lines stay clean.">
        <DraftNumber value={doc.rules.rimInset} min={0} max={10} step={0.5} live={false} onChange={(v) => update((dd) => { dd.rules.rimInset = Math.max(0, Math.min(10, v)); })} />
      </Field>
      <Field label="Sink props into the ground" unit="mm" help="Props are pushed this far into the ground so nothing floats or balances on a point.">
        <DraftNumber value={doc.rules.sink} min={0} max={3} step={0.1} live={false} onChange={(v) => update((dd) => { dd.rules.sink = Math.max(0, Math.min(3, v)); })} />
      </Field>
      <Field label="Tallest prop" unit="mm" help={`Props are shrunk until they fit under this height. Leave it on Auto to use the usual limit for a board this size (${cap} mm).`}>
        <div className="button-row">
          <select value={doc.rules.heightCap === null ? 'auto' : 'custom'} onChange={(e) => update((dd) => { dd.rules.heightCap = e.target.value === 'auto' ? null : cap; })}>
            <option value="auto">Auto</option>
            <option value="custom">Set</option>
          </select>
          {doc.rules.heightCap !== null && (
            <DraftNumber value={doc.rules.heightCap} min={1} max={100} step={1} live={false} onChange={(v) => update((dd) => { dd.rules.heightCap = Math.max(1, Math.min(100, v)); })} />
          )}
        </div>
      </Field>
      <Section title="Flat spots for models" subtitle="The ground is levelled inside each spot and nothing is scattered on it, so a model can stand flat.">
        <div className="button-row">
          <button type="button" title="Levels one 14 mm circle in the middle of the board" onClick={() => update((dd) => { dd.rules.footZones.push({ x: 0, y: 0, r: 7 }); })}>Add one at the centre</button>
          <button type="button" title="A grid of 25 mm squares, one flat spot each" onClick={() => update((dd) => {
            const nx = Math.max(1, Math.floor(w / 25)), ny = Math.max(1, Math.floor(d / 25));
            const zones = [];
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) zones.push({ x: Math.round(((i + 0.5) * 25 - (nx * 25) / 2) * 10) / 10, y: Math.round(((j + 0.5) * 25 - (ny * 25) / 2) * 10) / 10, r: 7 });
            dd.rules.footZones = zones;
          })}>
            One per 25 mm base
          </button>
          {doc.rules.footZones.length > 0 && <button type="button" title="Removes every flat spot; the ground goes back to its normal shape" onClick={() => update((dd) => { dd.rules.footZones = []; })}>Clear</button>}
        </div>
        <ul className="card-list">
          {doc.rules.footZones.map((z, i) => (
            <li key={i} className="card-item">
              <div className="card-head">
                <span className="card-name">Flat spot {i + 1}</span>
                <button type="button" className="icon-button" title="Take this flat spot off the ground" onClick={() => update((dd) => { dd.rules.footZones.splice(i, 1); })}>×</button>
              </div>
              <div className="field-grid">
                <NumberField label="Left / right" unit="mm" step={1} live={false} value={z.x} help="Where the flat spot sits across the board. 0 is the middle; a bigger number moves it right."
                  onChange={(v) => update((dd) => { dd.rules.footZones[i].x = v; })} />
                <NumberField label="Front / back" unit="mm" step={1} live={false} value={z.y} help="Where the flat spot sits up the board. 0 is the middle; a bigger number moves it towards the back."
                  onChange={(v) => update((dd) => { dd.rules.footZones[i].y = v; })} />
                <NumberField label="Size across" unit="mm" step={1} min={6} live={false} value={Math.round(z.r * 20) / 10} help="How wide the levelled circle is — a 25 mm base wants about 14 mm."
                  onChange={(v) => update((dd) => { dd.rules.footZones[i].r = Math.max(3, v / 2); })} />
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- Shell

const TABS: { id: StudioTab; label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'ground', label: 'Ground' },
  { id: 'props', label: 'Props' },
  { id: 'rules', label: 'Rules' },
];

/** What the handle on the selected prop does, and the key that switches to it. */
const HANDLE_MODES: { id: TransformMode; label: string; key: string; help: string }[] = [
  { id: 'move', label: 'Move', key: 'g', help: 'Drag the arrows to slide the selected prop over the ground' },
  { id: 'turn', label: 'Turn', key: 'r', help: 'Drag the ring to turn the selected prop' },
  { id: 'size', label: 'Size', key: 's', help: 'Drag the handle to make the selected prop bigger or smaller' },
];

export function StudioApp() {
  const doc = useStudioStore((s) => s.doc);
  const tab = useStudioStore((s) => s.tab);
  const setTab = useStudioStore((s) => s.setTab);
  const viewMode = useStudioStore((s) => s.viewMode);
  const setViewMode = useStudioStore((s) => s.setViewMode);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const canUndo = useStudioStore((s) => s.history.length > 0);
  const canRedo = useStudioStore((s) => s.future.length > 0);
  const baking = useStudioStore((s) => s.baking);
  const previewing = useStudioStore((s) => s.previewing);
  const preview = useStudioStore((s) => s.preview);
  const notice = useStudioStore((s) => s.notice);
  const error = useStudioStore((s) => s.error);
  const useScene = useStudioStore((s) => s.useScene);
  const selectedId = useStudioStore((s) => s.selectedPropId);
  const selectedName = useStudioStore((s) => {
    const p = s.doc?.props.find((q) => q.id === s.selectedPropId);
    return p ? s.doc?.library.find((it) => it.id === p.assetId)?.name ?? 'a prop' : null;
  });
  const transformMode = useStudioStore((s) => s.transformMode);
  const setTransformMode = useStudioStore((s) => s.setTransformMode);
  const select = useStudioStore((s) => s.select);
  const removeProp = useStudioStore((s) => s.removeProp);
  const closeStudio = useAppStore((s) => s.closeStudio);
  const showHelp = useAppStore((s) => s.view.showHelp);
  const setView = useAppStore((s) => s.setView);
  const bodyRef = useMoreBelow(tab);
  const registerLibraryFiles = useStudioStore((s) => s.registerLibraryFiles);
  const [dragging, setDragging] = useState(false);

  // dropped STLs go to this scene's prop library (in the cutter they would load as a base)
  function handleDragOver(e: DragEvent) { e.preventDefault(); setDragging(true); }
  function handleDragLeave(e: DragEvent) { e.preventDefault(); setDragging(false); }
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []).filter((f) => /\.stl$/i.test(f.name));
    if (files.length === 0) return;
    setTab('props');
    await registerLibraryFiles(files);
  }

  useEffect(() => {
    function typing(t: EventTarget | null): boolean {
      return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    }
    function onKey(e: KeyboardEvent) {
      if (typing(e.target)) return;
      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
        if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
        return;
      }
      if (e.altKey) return;
      const id = useStudioStore.getState().selectedPropId;
      if (e.key === 'Escape') { e.preventDefault(); select(null); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && id) { e.preventDefault(); removeProp(id); return; }
      const mode = HANDLE_MODES.find((m) => m.key === e.key.toLowerCase());
      if (mode) { e.preventDefault(); setTransformMode(mode.id); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, select, removeProp, setTransformMode]);

  if (!doc) return null;

  return (
    <div className={`app-shell two-col studio-shell${dragging ? ' dragging' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <header className="app-header">
        <span className="app-name">Base-ifier</span>
        <span className="app-tagline">Base Studio · raise thine own ground and strew it with ruin</span>
        <div className="header-spacer" />
        <button type="button" className={showHelp ? 'active' : ''} title="Show or hide the explanations under each control" onClick={() => setView({ showHelp: !showHelp })}>
          ⓘ Help {showHelp ? 'on' : 'off'}
        </button>
        <button type="button" onClick={() => closeStudio()} title="Back to the Bases screen; the scene is kept in this project">
          ← Back to bases
        </button>
      </header>

      <aside className="app-left">
        <div className="left-tabs">
          <div className="tab-strip" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="tab-body" ref={bodyRef}>
            {tab === 'board' && <BoardPanel />}
            {tab === 'ground' && <GroundPanel />}
            {tab === 'props' && <PropsPanel />}
            {tab === 'rules' && <RulesPanel />}
          </div>
        </div>
      </aside>

      <main className="app-center">
        <div className="studio-viewport">
          <StudioViewport />
          <div className="studio-hud">
            <button type="button" className={viewMode === 'top' ? 'active' : ''} title="Look straight down at the board" onClick={() => setViewMode('top')}>Top</button>
            <button type="button" className={viewMode === 'orbit' ? 'active' : ''} title="Turn the board around to look at it from the side" onClick={() => setViewMode('orbit')}>3D</button>
            <span className="hud-gap" />
            {HANDLE_MODES.map((m) => (
              <button key={m.id} type="button" className={transformMode === m.id ? 'active' : ''} title={`${m.help} (${m.key.toUpperCase()})`} onClick={() => setTransformMode(m.id)}>
                {m.label}
              </button>
            ))}
            <button type="button" disabled={!selectedId} title="Take the selected prop off the board (Delete)" onClick={() => { if (selectedId) removeProp(selectedId); }}>Remove</button>
            <span className="hud-gap" />
            <button type="button" disabled={!canUndo} onClick={() => undo()} title="Take back the last change (Ctrl+Z)">↶ Undo</button>
            <button type="button" disabled={!canRedo} onClick={() => redo()} title="Put back the change you just took back (Ctrl+Y)">↷ Redo</button>
          </div>
        </div>
        <div className="action-bar studio-bar">
          <div className="status">
            {error ? (
              <span className="error-text">{error}</span>
            ) : notice ? (
              <span className="studio-notice">
                {notice.text}
                {notice.undoable && (
                  <button type="button" className="notice-undo" title="Puts the props back the way they were and takes back the change" onClick={() => undo()}>Undo</button>
                )}
              </span>
            ) : selectedId && selectedName ? (
              <span>Selected: {selectedName} · drag it in the view, or use the numbers on the Props tab</span>
            ) : previewing ? 'Updating the preview…' : preview ? `${preview.propCount} props · ${doc.board.shape.w} × ${doc.board.shape.d} mm` : 'Building the preview…'}
          </div>
          <button type="button" className="baseify" disabled={baking} onClick={() => void useScene()} title="Turns the ground and props into a base you can cut from, and takes you to the Bases screen">
            {baking ? 'Building the scene…' : 'Use this scene'}
          </button>
        </div>
      </main>

      <footer className="app-status">
        <div className="status-left">
          <span className="muted">Scroll to zoom, drag to turn the 3D view. Click a prop to pick it up, then drag its handle — G slides it, R turns it, S resizes it, Delete takes it off, Esc puts it down.</span>
        </div>
      </footer>

      <RemoveLibraryDialog />

      {dragging && (
        <div className="drop-overlay">
          <span>Drop STL files to add them to your props</span>
        </div>
      )}
    </div>
  );
}
