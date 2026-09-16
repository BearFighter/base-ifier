/** Right-column panel: view/edit the selected piece. */
import React from 'react';
import type { EdgeTreatment, Shape } from '@/kernel/types';
import { PROFILE_CHOICES, profileId } from '@/model/defaults';
import { pieceSize } from '@/model/tree';
import { useAppStore } from '@/state/project';
import { Details } from '@/ui/common/Field';
import { Hint } from '@/ui/common/Hint';
import { formatCm3, formatWD, positionPhrase } from '@/ui/common/copy';
import { formatMm } from '@/ui/util/format';

function edgeLabels(kind: Shape['kind']): string[] {
  return kind === 'rect' ? ['Front (bottom edge in the Top view)', 'Right', 'Back (top edge in the Top view)', 'Left'] : ['Edge'];
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

  if (!piece) {
    return (
      <div className="panel piece-panel">
        <div className="panel-title">Piece</div>
        <div className="panel-empty">Nothing selected. Click a base in the list on the left or on the view.</div>
      </div>
    );
  }

  const isRoot = piece.parentId === null;
  const size = pieceSize(piece);
  const data = geom?.data;

  function setShape(patch: Partial<Shape>) {
    if (!piece) return;
    updatePiece(piece.id, { shape: { ...piece.shape, ...patch } as Shape });
  }

  const subtitle = isRoot
    ? `Whole base, ${formatWD(size.w, size.d)}`
    : `${formatWD(size.w, size.d)} base cut from ${parent?.name ?? 'the big base'}`;

  return (
    <div className="panel piece-panel">
      <div className="panel-title">Piece</div>

      <input
        className="piece-title-input"
        value={piece.name}
        onChange={(e) => updatePiece(piece.id, { name: e.target.value })}
        title="Rename this base"
      />
      <div className="piece-subtitle">{subtitle}</div>

      {!isRoot && <div className="piece-position">{positionPhrase(piece.xy)}</div>}

      <Details summary="Size & position">
        <div className="field-row two">
          <label className="field">
            <span>W (mm)</span>
            <input
              type="number"
              disabled={isRoot}
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
              disabled={isRoot}
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
              disabled={isRoot}
              step={0.5}
              value={piece.xy[0]}
              onChange={(e) => updatePiece(piece.id, { xy: [Number(e.target.value), piece.xy[1]] })}
            />
          </label>
          <label className="field">
            <span>Y (mm)</span>
            <input
              type="number"
              disabled={isRoot}
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
                disabled={isRoot}
                className={piece.rotDeg === r ? 'active' : ''}
                onClick={() => updatePiece(piece.id, { rotDeg: r })}
              >
                {r}°
              </button>
            ))}
          </div>
        </div>
      </Details>

      {!isRoot && (
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
