/** Right-column panel: export sizing policy, plate gap, and export actions. */
import React from 'react';
import { useAppStore } from '@/state/project';
import { Field } from '@/ui/common/Field';
import { Hint } from '@/ui/common/Hint';
import { autoTiltDeg, estimatePrintHeight } from '@/kernel/pipeline/presupport';

export function ExportPanel() {
  const exportSettings = useAppStore((s) => s.project.export);
  const defaultProfile = useAppStore((s) => s.project.defaultProfile);
  const setExportSettings = useAppStore((s) => s.setExportSettings);
  const selectedId = useAppStore((s) => s.project.selectedId);
  const piece = useAppStore((s) => (selectedId ? (s.project.pieces[selectedId] ?? null) : null));
  const geom = useAppStore((s) => (selectedId ? s.geometry[selectedId] : undefined));
  const measuredScale = useAppStore((s) => (piece ? s.project.sources[piece.sourceId]?.normalization.measuredScale : undefined));
  const busy = useAppStore((s) => s.busy);
  const exportPieceStl = useAppStore((s) => s.exportPieceStl);
  const exportLeavesZip = useAppStore((s) => s.exportLeavesZip);
  const exportPlateStl = useAppStore((s) => s.exportPlateStl);

  const data = geom?.data;
  let predicted: string | null = null;
  if (data) {
    const scale = exportSettings.sizing === 'source' ? (measuredScale ?? 1) : 1;
    let w = data.size.w * scale;
    let d = data.size.d * scale;
    if (exportSettings.sizing === 'clearance') {
      w -= 2 * exportSettings.clearanceMm;
      d -= 2 * exportSettings.clearanceMm;
    }
    predicted = `${w.toFixed(2)} × ${d.toFixed(2)} mm`;
  }

  const ps = exportSettings.presupport;
  let printLine: string | null = null;
  if (data && piece && ps.enabled) {
    const kind = piece.shape.kind;
    const tilt = ps.tiltDeg ?? autoTiltDeg({ kind, w: data.size.w, d: data.size.d }, piece.parentId === null ? undefined : (piece.profile ?? defaultProfile));
    const partH = data.bounds.max[2] - data.bounds.min[2];
    const h = estimatePrintHeight(data.size, partH, tilt, ps.standoff);
    printLine = tilt === 0 ? `flat on its supports (flat-sided bases are not tilted), about ${Math.round(h)} mm tall, ${ps.standoff} mm above the plate` : `tilted ${tilt}°, about ${Math.round(h)} mm tall, standing ${ps.standoff} mm above the plate on supports`;
  }
  const setPs = (patch: Partial<typeof ps>) => setExportSettings({ presupport: { ...ps, ...patch } });

  const scalePct = measuredScale !== undefined ? measuredScale * 100 : null;
  const matchHelp =
    scalePct === null
      ? "Scales bases to match the rest of this set."
      : Math.abs(scalePct - 100) < 0.05
        ? "Same as the file's own scale."
        : `Scales bases to ${scalePct.toFixed(1)}% like the rest of this set, so a cut 25 mm base matches an uncut one.`;

  const disabled = !piece || busy > 0;

  return (
    <div className="panel export-panel">
      <div className="panel-title">4 · Export</div>

      <div className="field-col">
        <div className="field-col-title">Print-ready</div>
        <label className="radio-row" title="Tilts each base, lifts it off the plate and adds resin supports with small feet, so the file goes straight into the slicer">
          <input type="checkbox" checked={ps.enabled} onChange={(e) => setPs({ enabled: e.target.checked })} />
          <span>Tilt and support for resin printing</span>
        </label>
        <Hint>
          Flat bases stuck to the plate warp and lift. This tilts each base, lifts it 6 mm and adds supports the way the original set is supported: small feet, no raft, more supports along the edge, none touching the magnet slots. Level and clean your plate, since there is no raft.
        </Hint>
        {ps.enabled && (
          <>
            <Field label="How many supports" help="Medium is a good start. Heavy matches the original set's density (a lot of clean-up); Light suits a well-tuned printer. Bigger bases automatically get wider spacing in the middle than along the edge.">
              <select value={ps.density} onChange={(e) => setPs({ density: e.target.value as typeof ps.density })}>
                <option value="light">Light</option>
                <option value="medium">Medium</option>
                <option value="heavy">Heavy</option>
              </select>
            </Field>
            <Field label="Bracing" help="Light fuses the edge feet into a rail and ties supports taller than 8 mm together with one ring of bars. Full adds bars every 8 mm with diagonals, like a slicer's lattice. The original set uses none; light is plenty for these heights.">
              <select value={ps.bracing} onChange={(e) => setPs({ bracing: e.target.value as typeof ps.bracing })}>
                <option value="off">Off</option>
                <option value="light">Light</option>
                <option value="full">Full lattice</option>
              </select>
            </Field>
          </>
        )}
        {ps.enabled && printLine && (
          <div className="field-row">
            <span>Selected base prints</span>
            <span>{printLine}</span>
          </div>
        )}
        {ps.enabled && (
          <details className="details">
            <summary>Support settings</summary>
            <Field label="Tilt" unit="°" help="Blank = automatic: 35° for rounds, 45° for rectangles, 55° for the biggest rectangles. Steeper prints taller but peels less.">
              <input
                type="number"
                step={5}
                min={0}
                max={80}
                placeholder="auto"
                value={ps.tiltDeg ?? ''}
                onChange={(e) => setPs({ tiltDeg: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="Gap above the plate" unit="mm" help="Room for the supports under the lowest point. 6 mm matches the original set.">
              <input type="number" step={0.5} min={2} value={ps.standoff} onChange={(e) => setPs({ standoff: Number(e.target.value) })} />
            </Field>
            <Field label="Contact size" unit="mm" help="The spot where each support touches the underside. Tips meet the surface square-on with a short thin neck, so the mark is a round dot of this size. 0.4 mm snaps off by hand; go up to 0.5–0.6 if supports let go during the print.">
              <input type="number" step={0.05} min={0.2} value={ps.tipDiameter} onChange={(e) => setPs({ tipDiameter: Number(e.target.value) })} />
            </Field>
          </details>
        )}
        <Hint>Removing supports: do it after the wash and before curing, while the resin is still a little soft. Each support has a thin neck just under the base, so it snaps or flush-cuts there and leaves a tiny dome that sands off in a stroke. Cured resin tears instead of snapping.</Hint>
        <Hint>If magnets come out tight or loose, change the slot tolerance in the Magnets tab by 0.05 mm and reprint one base before printing the rest.</Hint>
      </div>

      <div className="field-col">
        <div className="field-col-title">Piece size when exported</div>
        <label className="radio-row" title={matchHelp}>
          <input
            type="radio"
            name="sizing"
            checked={exportSettings.sizing === 'source'}
            onChange={() => setExportSettings({ sizing: 'source' })}
          />
          <span>Match the original base set</span>
        </label>
        <Hint>{matchHelp}</Hint>

        <label className="radio-row" title="A 25 mm base measures exactly 25.00 mm. Snug in exact-size trays.">
          <input
            type="radio"
            name="sizing"
            checked={exportSettings.sizing === 'nominal'}
            onChange={() => setExportSettings({ sizing: 'nominal' })}
          />
          <span>Exact labelled size</span>
        </label>
        <Hint>A 25 mm base measures exactly 25.00 mm. Snug in exact-size trays.</Hint>

        <label
          className="radio-row"
          title="Shrinks each side by the amount below so bases drop into MDF or 3D-printed trays easily."
        >
          <input
            type="radio"
            name="sizing"
            checked={exportSettings.sizing === 'clearance'}
            onChange={() => setExportSettings({ sizing: 'clearance' })}
          />
          <span>Slightly smaller for trays</span>
        </label>
        <Hint>Shrinks each side by the amount below so bases drop into MDF or 3D-printed trays easily.</Hint>

        {exportSettings.sizing === 'clearance' && (
          <label className="field indent">
            <span>Shrink each side by (mm)</span>
            <input
              type="number"
              step={0.05}
              value={exportSettings.clearanceMm}
              onChange={(e) => setExportSettings({ clearanceMm: Number(e.target.value) })}
            />
          </label>
        )}
      </div>

      {predicted && (
        <div className="field-row">
          <span>Selected base will print at</span>
          <span>{predicted}</span>
        </div>
      )}

      {busy > 0 && <div className="panel-subtitle">Still computing…</div>}

      <div className="button-col">
        <button type="button" disabled={disabled} onClick={() => piece && exportPieceStl(piece.id)}>
          Download the selected base (STL)
        </button>
        <button type="button" disabled={disabled} onClick={() => piece && exportLeavesZip(piece.sourceId)}>
          Download every base (ZIP)
        </button>
        <Hint>Every base that has nothing cut out of it, i.e. the ones you will actually print.</Hint>

        <button type="button" disabled={disabled} onClick={() => piece && exportPlateStl(piece.sourceId)}>
          Download everything on one print plate (STL)
        </button>
        <Field label="Space between bases on the plate" unit="mm">
          <input
            type="number"
            step={0.5}
            value={exportSettings.plateGap}
            onChange={(e) => setExportSettings({ plateGap: Number(e.target.value) })}
          />
        </Field>
      </div>
    </div>
  );
}
