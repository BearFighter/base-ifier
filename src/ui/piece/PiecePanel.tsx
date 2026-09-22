/** Right-column panel: view/edit the selected piece. */
import React, { useEffect } from 'react';
import type { EdgeTreatment, Shape } from '@/kernel/types';
import { PROFILE_CHOICES, profileId, TRAY_FLOOR_MAX, TRAY_FLOOR_MIN } from '@/model/defaults';
import type { TraySettings } from '@/model/types';
import { pieceSize } from '@/model/tree';
import { useAppStore } from '@/state/project';
import { traySettingsFor } from '@/state/chain';
import { Details, Field } from '@/ui/common/Field';
import { Hint } from '@/ui/common/Hint';
import { TRAY_HELP, TrayFloorCallout, TrayMagnetCallout } from '@/ui/tray/TrayBits';
import type { TrayInfo } from '@/worker/api';
import { formatCm3, formatWD, positionPhrase } from '@/ui/common/copy';
import { formatMm } from '@/ui/util/format';

function edgeLabels(kind: Shape['kind']): string[] {
  return kind === 'rect' ? ['Front (bottom edge in the Top view)', 'Right', 'Back (top edge in the Top view)', 'Left'] : ['Edge'];
}

/** Full cut or plug: how much of the scene this base takes with it. */
function CutSection({
  piece,
  terrain,
  plugDefaults,
  workMode,
  parentName,
  onChange,
}: {
  piece: { cut?: 'full' | 'plug'; plugDepth?: number; plugClearance?: number };
  terrain: { thickness: number; minTop: number; maxTop: number; carved: boolean; covered: boolean; hollow: boolean } | undefined;
  plugDefaults: { depth: number; clearance: number };
  workMode: string;
  parentName: string;
  onChange: (patch: { cut?: 'full' | 'plug'; plugDepth?: number; plugClearance?: number }) => void;
}) {
  const cut = piece.cut ?? 'full';
  const depth = piece.plugDepth ?? plugDefaults.depth;
  const clearance = piece.plugClearance ?? plugDefaults.clearance;
  const tall = terrain && terrain.thickness > 5;
  const offer = cut === 'full' && tall && terrain.covered;
  return (
    <Details summary={cut === 'plug' ? `Cut: plug, ${depth} mm deep` : 'Cut: full base'} defaultOpen={offer}>
      <div className="button-group" role="group" aria-label="Cut style">
        <button type="button" className={cut === 'full' ? 'active' : ''} onClick={() => onChange({ cut: 'full' })} title="Take the whole column of the scene under this base">Full base</button>
        <button type="button" className={cut === 'plug' ? 'active' : ''} onClick={() => onChange({ cut: 'plug' })} title="Take only the top of the terrain; the scene keeps a socket the base drops back into">Plug</button>
      </div>
      {offer && (
        <div className="callout">
          The scene is {terrain!.thickness.toFixed(1)} mm thick under this base. Cut it as a plug so {parentName} keeps a socket and the base drops back in: a tank with a squad on top, a dragon fight that is also a legal troop.
          <div><button type="button" className="primary" onClick={() => onChange({ cut: 'plug' })}>Make it a plug</button></div>
        </div>
      )}
      {cut === 'full' && !offer && (
        <Hint>{terrain ? (terrain.carved ? `Carved straight out of the object (${terrain.thickness.toFixed(1)} mm thick here); no plate is added underneath.` : terrain.hollow ? 'The object is hollow under this base: at Base-ify a plate is added that reaches up to the material above it, so nothing floats.' : `A plate is added under this base at Base-ify.`) : 'The whole column under this base becomes the base.'}</Hint>
      )}
      {cut === 'plug' && (
        <>
          <Hint>The base takes the top of the terrain with it and the scene keeps a matching socket. Depth is measured from the lowest point of the terrain over the base, so the plug is at least that thick everywhere; the underside is hollowed like any other base.</Hint>
          <div className="field-row two">
            <label className="field">
              <span>Plug depth (mm)</span>
              <input type="number" step={0.5} min={2.8} max={30} value={depth} onChange={(e) => { const v = Number(e.target.value); if (v >= 2.8 && v <= 30) onChange({ plugDepth: v }); }} />
            </label>
            <label className="field">
              <span>Socket play per side (mm)</span>
              <input type="number" step={0.05} min={0} max={1} value={clearance} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 1) onChange({ plugClearance: v }); }} title="Resin prints need 0.15-0.3 mm of clearance for a drop-in fit" />
            </label>
          </div>
          {terrain && !terrain.covered && <Hint>This base overhangs the object. A plug needs solid material under its whole footprint, so it will be cut as a full base on a plate and the object keeps a hole instead of a socket. Move it fully onto the object for a plug.</Hint>}
          {terrain && terrain.covered && terrain.thickness < depth && <Hint>Only {terrain.thickness.toFixed(1)} mm of terrain here: the plug will be that deep instead.</Hint>}
          {terrain && terrain.covered && terrain.hollow && <Hint>The object is hollow under this base. Backing is added by default: the plug gets a plate that fills it up to the material above, and the socket gets a floor and walls so the plug has something to sit in.</Hint>}
          {workMode !== 'diorama' && <Hint>The socket is kept by the rest of the scene, which is only exported in Diorama mode. In other modes this base is still cut as a plug, but nothing keeps its socket.</Hint>}
        </>
      )}
    </Details>
  );
}

/**
 * The tray settings, shown on the frame that holds the bases and on the tray
 * itself. Edits go to that frame, so two frames on one scene can have different
 * trays; leaving the frame out would change every tray in the project.
 */
function TraySection({ frameId, tray, settings, onChange }: { frameId: string | undefined; tray: TrayInfo | undefined; settings: TraySettings; onChange: (patch: Partial<TraySettings>) => void }) {
  void frameId;
  const span = tray ? Math.max(tray.thinSpan.w, tray.thinSpan.d) : 0;
  return (
    <Details summary={`Tray: ${settings.floor} mm floor, ${settings.edge} mm rim`} defaultOpen>
      <Hint>{TRAY_HELP.intro}</Hint>
      <Field label="Tray floor" unit="mm" help={TRAY_HELP.floor}>
        <input type="number" step={0.1} min={TRAY_FLOOR_MIN} max={TRAY_FLOOR_MAX} value={settings.floor} onChange={(e) => { const v = Number(e.target.value); if (v >= TRAY_FLOOR_MIN && v <= TRAY_FLOOR_MAX) onChange({ floor: v }); }} />
      </Field>
      <TrayMagnetCallout tray={tray} onSetFloor={(v) => onChange({ floor: v })} />
      <TrayFloorCallout tray={tray} floor={settings.floor} onSetFloor={(v) => onChange({ floor: v })} />
      <Field label="Room around each base" unit="mm" help={TRAY_HELP.gap}>
        <input type="number" step={0.05} min={0} max={1} value={settings.gap} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 1) onChange({ gap: v }); }} />
      </Field>
      <Field label="Rim" unit="mm" help={TRAY_HELP.edge}>
        <input type="number" step={0.5} min={0} max={20} value={settings.edge} onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 20) onChange({ edge: v }); }} />
      </Field>
      <label className="radio-row" title={TRAY_HELP.magnets}>
        <input type="checkbox" checked={settings.magnets} onChange={(e) => onChange({ magnets: e.target.checked })} />
        <span>Magnets in the floor</span>
      </label>
      <Hint>{TRAY_HELP.magnets}</Hint>
      {tray && (
        <>
          <div className="field-row">
            <span>Magnets</span>
            <span>{tray.magnetMode === 'none' ? 'none' : tray.magnetMode === 'recess' ? 'sit fully inside the floor' : 'go right through the floor'}</span>
          </div>
          <div className="field-row">
            <span>Widest bare floor</span>
            <span>{Math.round(span)} mm</span>
          </div>
        </>
      )}
    </Details>
  );
}

function EdgeRow({
  label,
  treatment,
  disabled,
  onChange,
}: {
  label: string;
  treatment: EdgeTreatment;
  disabled: boolean;
  onChange: (t: EdgeTreatment) => void;
}) {
  return (
    <div className="edge-row">
      <span className="edge-label">{label}</span>
      <select
        disabled={disabled}
        value={treatment.kind}
        onChange={(e) => {
          const kind = e.target.value;
          if (kind === 'custom') onChange({ kind: 'custom', insetMm: treatment.kind === 'custom' ? treatment.insetMm : 1 });
          else if (kind === 'vertical') onChange({ kind: 'vertical' });
          else onChange({ kind: 'bevel' });
        }}
      >
        <option value="bevel">Sloped like the original</option>
        <option value="vertical">Straight</option>
        <option value="custom">Custom slope</option>
      </select>
      {treatment.kind === 'custom' && (
        <input
          type="number"
          className="edge-inset"
          disabled={disabled}
          step={0.1}
          title="How far the edge leans in, in mm"
          value={treatment.insetMm}
          onChange={(e) => onChange({ kind: 'custom', insetMm: Number(e.target.value) })}
        />
      )}
    </div>
  );
}

export function PiecePanel() {
  const selectedId = useAppStore((s) => s.project.selectedId);
  const piece = useAppStore((s) => (selectedId ? (s.project.pieces[selectedId] ?? null) : null));
  const parent = useAppStore((s) => (piece?.parentId ? (s.project.pieces[piece.parentId] ?? null) : null));
  const geom = useAppStore((s) => (selectedId ? s.geometry[selectedId] : undefined));
  const updatePiece = useAppStore((s) => s.updatePiece);
  const defaultProfile = useAppStore((s) => s.project.defaultProfile);
  const plugDefaults = useAppStore((s) => s.project.plug);
  const workMode = useAppStore((s) => s.project.mode);
  const terrain = useAppStore((s) => (selectedId ? s.terrain[selectedId] : undefined));
  const fetchTerrainInfo = useAppStore((s) => s.fetchTerrainInfo);
  const setTraySettings = useAppStore((s) => s.setTraySettings);
  // the tray settings belong to the frame: shown on the frame itself and on its tray
  const trayFrameId = useAppStore((s) => {
    const p = selectedId ? s.project.pieces[selectedId] : null;
    if (!p) return undefined;
    if (p.role === 'tray') return p.trayOf;
    return p.role === 'frame' && s.project.mode === 'tray' ? p.id : undefined;
  });
  const traySettings = useAppStore((s) => traySettingsFor(s.project, trayFrameId ? s.project.pieces[trayFrameId] : undefined));
  const trayGeom = useAppStore((s) => {
    const t = Object.values(s.project.pieces).find((p) => p.role === 'tray' && p.trayOf === trayFrameId);
    return t ? s.geometry[t.id]?.data?.tray : undefined;
  });
  const sizeKey = piece ? `${piece.shape.kind}|${piece.shape.w}|${piece.shape.d}|${piece.xy[0]}|${piece.xy[1]}|${piece.rotDeg}` : '';
  useEffect(() => {
    if (piece && piece.parentId !== null && piece.role !== 'frame' && piece.role !== 'tray') void fetchTerrainInfo(piece.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id, sizeKey]);

  if (!piece) {
    return (
      <div className="panel piece-panel">
        <div className="panel-title">Base</div>
        <div className="panel-empty">Nothing selected. Click a base in the list on the left or on the view.</div>
      </div>
    );
  }

  const isRoot = piece.parentId === null;
  const isTray = piece.role === 'tray';
  const size = pieceSize(piece);
  const data = geom?.data;

  function setShape(patch: Partial<Shape>) {
    if (!piece) return;
    updatePiece(piece.id, { shape: { ...piece.shape, ...patch } as Shape });
  }

  const subtitle = isRoot
    ? `Whole base, ${formatWD(size.w, size.d)}`
    : isTray
      ? `${formatWD(size.w, size.d)} tray, made from the frame it holds`
      : `${formatWD(size.w, size.d)} base cut from ${parent?.name ?? 'the big base'}`;

  return (
    <div className="panel piece-panel">
      <div className="panel-title">{isTray ? 'Tray' : 'Base'}</div>

      <input
        className="piece-title-input"
        value={piece.name}
        onChange={(e) => updatePiece(piece.id, { name: e.target.value })}
        title="Rename this base"
      />
      <div className="piece-subtitle">{subtitle}</div>

      {!isRoot && <div className="piece-position">{positionPhrase(piece.xy)}</div>}

      {trayFrameId && (
        <TraySection frameId={trayFrameId} tray={trayGeom} settings={traySettings} onChange={(patch) => setTraySettings(patch, trayFrameId)} />
      )}

      <Details summary="Size & position">
        <div className="field-row two">
          <label className="field">
            <span>W (mm)</span>
            <input
              type="number"
              disabled={isRoot || isTray}
              step={0.5}
              value={piece.shape.w}
              min={1}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 1) setShape({ w: v }); else useAppStore.setState({ lastError: 'Bases must be at least 1 mm wide and deep.' }); }}
            />
          </label>
          <label className="field">
            <span>D (mm)</span>
            <input
              type="number"
              disabled={isRoot || isTray}
              step={0.5}
              value={piece.shape.d}
              min={1}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 1) setShape({ d: v }); else useAppStore.setState({ lastError: 'Bases must be at least 1 mm wide and deep.' }); }}
            />
          </label>
        </div>
        <div className="field-row two">
          <label className="field">
            <span>X (mm)</span>
            <input
              type="number"
              disabled={isRoot || isTray}
              step={0.5}
              value={piece.xy[0]}
              onChange={(e) => updatePiece(piece.id, { xy: [Number(e.target.value), piece.xy[1]] })}
            />
          </label>
          <label className="field">
            <span>Y (mm)</span>
            <input
              type="number"
              disabled={isRoot || isTray}
              step={0.5}
              value={piece.xy[1]}
              onChange={(e) => updatePiece(piece.id, { xy: [piece.xy[0], Number(e.target.value)] })}
            />
          </label>
        </div>
        <div className="field-row">
          <span>Rotation</span>
          <div className="button-group">
            {[0, 90, 180, 270].map((r) => (
              <button
                key={r}
                type="button"
                disabled={isRoot || isTray}
                className={piece.rotDeg === r ? 'active' : ''}
                onClick={() => updatePiece(piece.id, { rotDeg: r })}
              >
                {r}°
              </button>
            ))}
          </div>
        </div>
      </Details>

      {!isRoot && piece.role !== 'frame' && !isTray && (
        <CutSection piece={piece} terrain={terrain} plugDefaults={plugDefaults} workMode={workMode} parentName={parent?.name ?? 'the scene'} onChange={(patch) => updatePiece(piece.id, patch)} />
      )}

      {!isRoot && !isTray && (
        <Details summary="Edge shape">
          <Hint>How the sides of this base are shaped. Sizes picked from a game's list get that game's style automatically.</Hint>
          <div className="field-col">
            <select
              value={profileId(piece.profile ?? defaultProfile)}
              onChange={(e) => {
                const c = PROFILE_CHOICES.find((x) => x.id === e.target.value);
                if (c) updatePiece(piece.id, { profile: c.profile });
                else if (e.target.value === 'custom') updatePiece(piece.id, { profile: { kind: 'inset', inset: 0.7, height: 3 } });
              }}
              title="Edge shape of this base"
            >
              {PROFILE_CHOICES.map((c) => <option key={c.id} value={c.id} title={c.help}>{c.label}</option>)}
              <option value="custom">Custom…</option>
            </select>
            <Hint>{PROFILE_CHOICES.find((c) => c.id === profileId(piece.profile ?? defaultProfile))?.help ?? 'Set the slope (mm per side, 0 = straight) and the plate height yourself.'}</Hint>
            {(piece.profile ?? defaultProfile).kind === 'inset' && (
              <div className="field-row two">
                <label className="field">
                  <span>Sides lean in by (mm)</span>
                  <input type="number" step={0.1} min={0} max={5} value={(piece.profile ?? defaultProfile).kind === 'inset' ? ((piece.profile ?? defaultProfile) as { inset: number }).inset : 0}
                    onChange={(e) => { const v = Number(e.target.value); const cur = piece.profile ?? defaultProfile; if (cur.kind === 'inset' && v >= 0 && v <= 5) updatePiece(piece.id, { profile: { kind: 'inset', inset: v, height: cur.height } }); }} />
                </label>
                <label className="field">
                  <span>Plate height (mm)</span>
                  <input type="number" step={0.1} min={1.5} max={6} value={(piece.profile ?? defaultProfile).kind === 'inset' ? ((piece.profile ?? defaultProfile) as { height: number }).height : 3}
                    onChange={(e) => { const v = Number(e.target.value); const cur = piece.profile ?? defaultProfile; if (cur.kind === 'inset' && v >= 1.5 && v <= 6) updatePiece(piece.id, { profile: { kind: 'inset', inset: cur.inset, height: v } }); }} />
                </label>
              </div>
            )}
          </div>
        </Details>
      )}

      {geom?.status === 'pending' && <div className="panel-empty">Computing…</div>}
      {geom?.status === 'error' && <div className="error-text">{geom.error}</div>}

      {data && (
        <Details summary="Measurements">
          <div className="field-row">
            <span>Footprint</span>
            <span>{formatWD(data.size.w, data.size.d)}</span>
          </div>
          <div className="field-row">
            <span>Height</span>
            <span>{formatMm(data.bounds.max[2] - data.bounds.min[2])} mm</span>
          </div>
          <div className="field-row">
            <span>Body volume</span>
            <span>{formatCm3(data.bodyVolume)}</span>
          </div>
        </Details>
      )}

      {data && data.warnings.length > 0 && (
        <div className="warnings-plain">
          {data.warnings.map((w, i) => (
            <div key={i} className="warning-line">
              <span aria-hidden="true">⚠</span> {w}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
