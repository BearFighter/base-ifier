/**
 * Base Studio: the second surface of the app. One tabbed left menu (Board /
 * Ground / Props / Rules), the studio viewport, and one big button, "Use this
 * scene", which bakes the scene into a source and returns to the cutter.
 * Same rules as the cutter: no jargon, help on every setting, ids and numbers
 * in React state (meshes stay in the studio store and reach three.js by ref).
 */
import { useEffect } from 'react';
import { useAppStore } from '@/state/project';
import { useStudioStore } from '@/studio/store';
import type { StudioTab } from '@/studio/store';
import { Field, Section, Details } from '@/ui/common/Field';
import { Hint } from '@/ui/common/Hint';
import { BOARD_PRESETS, boardMargin, studioId } from '@/kernel/studio/document';
import type { StudioDocument, StudioProp } from '@/kernel/studio/document';
import { GENRE_PRESETS, genrePreset } from '@/kernel/terrain/presets';
import { effectiveHeightCap } from '@/kernel/studio/bake';
import { PARAMETRIC_CATALOG } from '@/kernel/props/parametric';
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
      <Field label="Scene name" help="Shows up in the Scene tab once the scene is handed to the cutter.">
        <input type="text" value={doc.name} onChange={(e) => update((d) => { d.name = e.target.value; }, { history: false })} />
      </Field>
      <Field label="Board" help="The slab you will cut bases from. Pick a single base to make one topper, a unit footprint for a multibase, or a slab or board to cut many bases from.">
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
        <Field label="Width" unit="mm">
          <input type="number" min={10} max={1000} step={1} value={shape.w} onChange={(e) => update((d) => { d.board.shape.w = Math.max(10, Math.min(1000, Number(e.target.value) || 10)); })} />
        </Field>
        <Field label="Depth" unit="mm">
          <input type="number" min={10} max={1000} step={1} value={shape.d} onChange={(e) => update((d) => { d.board.shape.d = Math.max(10, Math.min(1000, Number(e.target.value) || 10)); })} />
        </Field>
      </div>
      <Field label="Shape" help="Round boards are ovals; everything else is a rectangle with the usual slight bevel.">
        <select value={shape.kind} onChange={(e) => update((d) => { d.board.shape.kind = e.target.value as 'rect' | 'ellipse'; })}>
          <option value="rect">Rectangle</option>
          <option value="ellipse">Round / oval</option>
        </select>
      </Field>
      <Field label="Room around it" unit="mm" help="Single bases and unit footprints are cut OUT of the scene, so the board is built this much bigger on every side and nothing is scattered on that strip. Slabs you cut many bases from need none.">
        <input type="number" min={0} max={10} step={0.5} value={doc.board.margin ?? 0} onChange={(e) => update((d) => { d.board.margin = Math.max(0, Math.min(10, Number(e.target.value) || 0)); })} />
      </Field>
      <Hint>
        {(doc.board.margin ?? 0) > 0
          ? `The board is ${shape.w + 2 * (doc.board.margin ?? 0)} × ${shape.d + 2 * (doc.board.margin ?? 0)} mm: your ${shape.w} × ${shape.d} plus ${doc.board.margin} mm all round. Back in the cutter, place a ${shape.w} × ${shape.d} base or frame on it and Base-ify.`
          : `Bases are cut from inside this ${shape.w} × ${shape.d} mm slab. The plate under the ground is ${doc.board.plateTop} mm thick, and every cut base gets the same rim, hollow underside and magnets as one cut from an STL.`}
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
      <Section title="Ground" subtitle={preset.help}>
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
      <Field label="Roughness" help="How much the ground rises and falls. 1 is the preset's own look.">
        <RangeRow value={doc.ground.roughness} min={0.3} max={2} step={0.05} onChange={(v) => update((d) => { d.ground.roughness = v; })} format={(v) => v.toFixed(2) + '×'} />
      </Field>
      <Field label="Texture" help="Strength of the surface pattern (flagstones, plating, ripples). 0 turns it off.">
        <RangeRow value={doc.ground.texture} min={0} max={2} step={0.05} onChange={(v) => update((d) => { d.ground.texture = v; })} format={(v) => v.toFixed(2) + '×'} />
      </Field>
      <div className="button-row">
        <button type="button" onClick={() => update((d) => { d.ground.seed = (d.ground.seed * 1664525 + 1013904223) >>> 0; })} title="Keep the settings, draw new ground">
          New ground
        </button>
        <span className="muted">seed {doc.ground.seed}</span>
      </div>
      <Details summary={`Extra patterns (${doc.ground.stamps.length})`}>
        <Hint>Stamp a pattern onto one spot. Each one sits at the centre until you set its position.</Hint>
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
        <ul className="prop-list">
          {doc.ground.stamps.map((s) => (
            <li key={s.id}>
              <span>{STAMP_CHOICES.find((c) => c.id === s.stamp)?.label ?? s.stamp}</span>
              <input type="number" title="x, mm" step={1} value={s.x} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.x = Number(e.target.value) || 0; })} />
              <input type="number" title="y, mm" step={1} value={s.y} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.y = Number(e.target.value) || 0; })} />
              <input type="number" title="size, mm" step={1} min={2} value={s.size} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.size = Math.max(2, Number(e.target.value) || 2); })} />
              <input type="number" title="height, mm" step={0.1} min={0} max={5} value={s.strength} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.ground.stamps.find((q) => q.id === s.id); if (t) t.strength = Math.max(0, Number(e.target.value) || 0); })} />
              <button type="button" className="icon-button" title="Remove" onClick={() => update((d) => { d.ground.stamps = d.ground.stamps.filter((q) => q.id !== s.id); })}>×</button>
            </li>
          ))}
        </ul>
      </Details>
      {doc.ground.strokes.length > 0 && (
        <div className="button-row">
          <button type="button" onClick={() => update((d) => { d.ground.strokes = []; })}>Clear painted changes ({doc.ground.strokes.length})</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Props

function propLabel(p: StudioProp, assetNames: Map<string, string>): string {
  if (p.assetId.startsWith('param:')) {
    const kind = p.assetId.slice(6);
    return PARAMETRIC_CATALOG.find((c) => c.kind === kind)?.label ?? kind;
  }
  return assetNames.get(p.assetId) ?? p.assetId;
}

function PropsPanel() {
  const doc = useDoc();
  const update = useStudioStore((s) => s.update);
  const scatter = useStudioStore((s) => s.scatter);
  const clearScatter = useStudioStore((s) => s.clearScatter);
  const assets = useStudioStore((s) => s.assets);
  const assetsState = useStudioStore((s) => s.assetsState);
  const preview = useStudioStore((s) => s.preview);
  const assetNames = new Map(assets.map((a) => [a.id, a.id.replace(/[-_]/g, ' ')]));
  const scattered = doc.props.filter((p) => p.scattered).length;
  const placed = doc.props.filter((p) => !p.scattered);
  const preset = genrePreset(doc.ground.presetId);
  return (
    <div className="studio-panel">
      <Section title="Scatter" subtitle="Strews the preset's rocks, rubble and elements over the ground, keeping off the rim and any foot zones.">
        <Field label="How much" help="Light leaves room for models; heavy is a rubble field. Small boards get proportionally less.">
          <select value={doc.rules.density} onChange={(e) => update((d) => { d.rules.density = e.target.value as 'light' | 'medium' | 'heavy'; })}>
            <option value="light">Light</option>
            <option value="medium">Medium</option>
            <option value="heavy">Heavy</option>
          </select>
        </Field>
        <Field label="Centrepiece" help="One larger prop at a rule-of-thirds point on boards 40 mm and up.">
          <input type="checkbox" checked={doc.rules.heroProps} onChange={(e) => update((d) => { d.rules.heroProps = e.target.checked; })} />
        </Field>
        <div className="button-row">
          <button type="button" className="primary" onClick={() => void scatter(true)} disabled={assetsState === 'loading'}>
            {scattered ? 'Re-roll scatter' : 'Scatter props'}
          </button>
          {scattered > 0 && <button type="button" onClick={() => clearScatter()}>Clear ({scattered})</button>}
        </div>
        <Hint>
          This preset uses {preset.families.map((f) => f.family).join(', ')}{preset.parametric.length ? ` and ${preset.parametric.map((k) => k.kind.replace(/-/g, ' ')).join(', ')}` : ''}.
          {assetsState === 'loading' ? ' Loading the rock pack…' : assetsState === 'error' ? ' The rock pack could not be loaded; only built elements are used.' : ` ${assets.length} pack props ready (all CC0).`}
        </Hint>
      </Section>
      <Section title="Placed by hand" subtitle="Props you add yourself stay where they are when you re-roll the scatter.">
        <div className="button-row">
          <select id="studio-prop-pick" defaultValue={PARAMETRIC_CATALOG[0]?.kind ?? ''}>
            <optgroup label="Built elements">
              {PARAMETRIC_CATALOG.map((c) => <option key={c.kind} value={`param:${c.kind}`}>{c.label ?? c.kind}</option>)}
            </optgroup>
            {assets.length > 0 && (
              <optgroup label="Rock pack (CC0)">
                {assets.map((a) => <option key={a.id} value={a.id}>{assetNames.get(a.id)}</option>)}
              </optgroup>
            )}
          </select>
          <button type="button" onClick={() => {
            const pick = (document.getElementById('studio-prop-pick') as HTMLSelectElement | null)?.value;
            if (!pick) return;
            const assetId = pick.startsWith('param:') || assets.some((a) => a.id === pick) ? pick : `param:${pick}`;
            update((d) => {
              d.props.push({ id: studioId('pr'), assetId, x: 0, y: 0, rotDeg: 0, scale: 1, sink: 0, seed: (Math.random() * 1e9) >>> 0, licence: 'cc0', scattered: false });
            });
          }}>
            Add at centre
          </button>
        </div>
        <ul className="prop-list">
          {placed.map((p) => (
            <li key={p.id}>
              <span>{propLabel(p, assetNames)}</span>
              <input type="number" title="x, mm" step={1} value={p.x} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.props.find((q) => q.id === p.id); if (t) t.x = Number(e.target.value) || 0; })} />
              <input type="number" title="y, mm" step={1} value={p.y} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.props.find((q) => q.id === p.id); if (t) t.y = Number(e.target.value) || 0; })} />
              <input type="number" title="turn, degrees" step={15} value={p.rotDeg} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.props.find((q) => q.id === p.id); if (t) t.rotDeg = Number(e.target.value) || 0; })} />
              <input type="number" title="size, ×" step={0.1} min={0.1} value={p.scale} style={{ width: 52 }} onChange={(e) => update((d) => { const t = d.props.find((q) => q.id === p.id); if (t) t.scale = Math.max(0.1, Number(e.target.value) || 1); })} />
              <button type="button" className="icon-button" title="Remove" onClick={() => update((d) => { d.props = d.props.filter((q) => q.id !== p.id); })}>×</button>
            </li>
          ))}
        </ul>
        {placed.length === 0 && <div className="muted">Nothing placed by hand yet.</div>}
      </Section>
      <div className="muted">{doc.props.length} props on the board{preview ? ` · preview ${preview.ms} ms` : ''}</div>
    </div>
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
      <Field label="Keep clear of the edge" unit="mm" help="Nothing is scattered this close to the rim, so cut edges and the rim stay clean.">
        <input type="number" min={0} max={10} step={0.5} value={doc.rules.rimInset} onChange={(e) => update((dd) => { dd.rules.rimInset = Math.max(0, Number(e.target.value) || 0); })} />
      </Field>
      <Field label="Sink props into the ground" unit="mm" help="Props are pushed this far into the ground so nothing floats or balances on a point.">
        <input type="number" min={0} max={3} step={0.1} value={doc.rules.sink} onChange={(e) => update((dd) => { dd.rules.sink = Math.max(0, Number(e.target.value) || 0); })} />
      </Field>
      <Field label="Tallest prop" unit="mm" help={`Props are scaled down to fit under this height. Leave it on Auto to use the usual limit for this board size (${cap} mm).`}>
        <div className="button-row">
          <select value={doc.rules.heightCap === null ? 'auto' : 'custom'} onChange={(e) => update((dd) => { dd.rules.heightCap = e.target.value === 'auto' ? null : cap; })}>
            <option value="auto">Auto</option>
            <option value="custom">Set</option>
          </select>
          {doc.rules.heightCap !== null && (
            <input type="number" min={1} max={100} step={1} value={doc.rules.heightCap} onChange={(e) => update((dd) => { dd.rules.heightCap = Math.max(1, Number(e.target.value) || 1); })} />
          )}
        </div>
      </Field>
      <Section title="Foot zones" subtitle="Flat spots where models stand: the ground is levelled and nothing is scattered there.">
        <div className="button-row">
          <button type="button" onClick={() => update((dd) => { dd.rules.footZones.push({ x: 0, y: 0, r: 7 }); })}>Add one at the centre</button>
          <button type="button" title="A grid of 25 mm squares, one flat spot each" onClick={() => update((dd) => {
            const nx = Math.max(1, Math.floor(w / 25)), ny = Math.max(1, Math.floor(d / 25));
            const zones = [];
            for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) zones.push({ x: Math.round(((i + 0.5) * 25 - (nx * 25) / 2) * 10) / 10, y: Math.round(((j + 0.5) * 25 - (ny * 25) / 2) * 10) / 10, r: 7 });
            dd.rules.footZones = zones;
          })}>
            One per 25 mm base
          </button>
          {doc.rules.footZones.length > 0 && <button type="button" onClick={() => update((dd) => { dd.rules.footZones = []; })}>Clear</button>}
        </div>
        <ul className="prop-list">
          {doc.rules.footZones.map((z, i) => (
            <li key={i}>
              <span>Foot zone {i + 1}</span>
              <input type="number" title="x, mm" step={1} value={z.x} style={{ width: 52 }} onChange={(e) => update((dd) => { dd.rules.footZones[i].x = Number(e.target.value) || 0; })} />
              <input type="number" title="y, mm" step={1} value={z.y} style={{ width: 52 }} onChange={(e) => update((dd) => { dd.rules.footZones[i].y = Number(e.target.value) || 0; })} />
              <input type="number" title="radius, mm" step={0.5} min={3} value={z.r} style={{ width: 52 }} onChange={(e) => update((dd) => { dd.rules.footZones[i].r = Math.max(3, Number(e.target.value) || 3); })} />
              <button type="button" className="icon-button" title="Remove" onClick={() => update((dd) => { dd.rules.footZones.splice(i, 1); })}>×</button>
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
  const error = useStudioStore((s) => s.error);
  const useScene = useStudioStore((s) => s.useScene);
  const closeStudio = useAppStore((s) => s.closeStudio);
  const showHelp = useAppStore((s) => s.view.showHelp);
  const setView = useAppStore((s) => s.setView);
  const bodyRef = useMoreBelow(tab);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  if (!doc) return null;

  return (
    <div className="app-shell two-col studio-shell">
      <header className="app-header">
        <span className="app-name">Base-ifier</span>
        <span className="app-tagline">Base Studio · raise thine own ground and strew it with ruin</span>
        <div className="header-spacer" />
        <button type="button" className={showHelp ? 'active' : ''} title="Show or hide the explanations under each control" onClick={() => setView({ showHelp: !showHelp })}>
          ⓘ Help {showHelp ? 'on' : 'off'}
        </button>
        <button type="button" onClick={() => closeStudio()} title="Back to the cutter; the scene is kept in this project">
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
            <button type="button" className={viewMode === 'top' ? 'active' : ''} onClick={() => setViewMode('top')}>Top</button>
            <button type="button" className={viewMode === 'orbit' ? 'active' : ''} onClick={() => setViewMode('orbit')}>3D</button>
            <button type="button" disabled={!canUndo} onClick={() => undo()} title="Undo (Ctrl+Z)">↶</button>
            <button type="button" disabled={!canRedo} onClick={() => redo()} title="Redo (Ctrl+Y)">↷</button>
          </div>
        </div>
        <div className="action-bar studio-bar">
          <div className="status">
            {error ? <span className="error-text">{error}</span> : previewing ? 'Updating the preview…' : preview ? `${preview.propCount} props · ${doc.board.shape.w} × ${doc.board.shape.d} mm` : 'Building the preview…'}
          </div>
          <button type="button" className="baseify" disabled={baking} onClick={() => void useScene()} title="Build the scene and hand it to the cutter">
            {baking ? 'Building the scene…' : 'Use this scene'}
          </button>
        </div>
      </main>

      <footer className="app-status">
        <div className="status-left">
          <span className="muted">Scroll to zoom, drag to turn the 3D view. Every base cut from this scene keeps the same underside and magnets as an STL.</span>
        </div>
      </footer>
    </div>
  );
}
