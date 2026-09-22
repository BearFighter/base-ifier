/** Right-column panel: project-wide magnet settings + the selected piece's slots. */
import React, { useState } from 'react';
import { defaultMagnetSettings, newId } from '@/model/defaults';
import { magnetPresets } from '@/model/presets';
import type { MagnetSettings, MagnetSlot, Piece, PrinterProfile } from '@/model/types';
import { useAppStore } from '@/state/project';
import { Details, Field } from '@/ui/common/Field';
import { Hint } from '@/ui/common/Hint';
import { magnetPresetLabel } from '@/ui/common/copy';
import { formatMm } from '@/ui/util/format';

/** Hollow-or-solid underside, brim, magnet rings and the watermark (project-wide). */
function UndersideSection() {
  const u = useAppStore((s) => s.project.underside);
  const magnet = useAppStore((s) => s.project.magnet);
  const setUnderside = useAppStore((s) => s.setUndersideSettings);
  const flushNote = Math.abs(u.voidDepth - magnet.thick) < 0.05 ? 'A glued magnet ends flush with the brim.' : u.voidDepth > magnet.thick ? `A glued magnet sits ${(u.voidDepth - magnet.thick).toFixed(1)} mm inside the brim.` : `The void is shallower than the ${magnet.thick} mm magnet: it would stick out.`;
  return (
    <div className="field-col">
      <div className="field-col-title">Underside</div>
      <label className="radio-row" title="Hollow bases with a solid brim print flat on the plate, are lighter, and take magnets glued to the ceiling of the void">
        <input type="checkbox" checked={u.hollow} onChange={(e) => setUnderside({ hollow: e.target.checked })} />
        <span>Hollow underside with a brim</span>
      </label>
      <Hint>Only the brim touches the table, so the base sits flat even if a support mark ends up inside the void. Untick for a solid plate with the magnet slots bored into it.</Hint>
      {u.hollow && (
        <>
          <Field label="Void depth" unit="mm" help={`Space under the base inside the brim. ${flushNote}`}>
            <input type="number" step={0.1} min={0.5} value={u.voidDepth} onChange={(e) => setUnderside({ voidDepth: Number(e.target.value) })} />
          </Field>
          <Field label="Brim width" unit="mm" help="The solid ring around the edge that the base stands on. 2 mm is sturdy; supports for tilted printing land on it.">
            <input type="number" step={0.25} min={1} value={u.rimWidth} onChange={(e) => setUnderside({ rimWidth: Number(e.target.value) })} />
          </Field>
          <Field label="Watermark" help="Raised text on the ceiling of the void, mirrored so it reads from below. Skipped automatically when a base is too small for it. Leave empty for none.">
            <input type="text" maxLength={24} value={u.watermark} onChange={(e) => setUnderside({ watermark: e.target.value })} />
          </Field>
          <Details summary="Ring and watermark sizes">
            <Field label="Magnet ring height" unit="mm" help="How far the locating ring hangs from the ceiling. It centres the magnet while the glue sets.">
              <input type="number" step={0.1} min={0.2} value={u.ringHeight} onChange={(e) => setUnderside({ ringHeight: Number(e.target.value) })} />
            </Field>
            <Field label="Magnet ring wall" unit="mm">
              <input type="number" step={0.1} min={0.2} value={u.ringWidth} onChange={(e) => setUnderside({ ringWidth: Number(e.target.value) })} />
            </Field>
            <Field label="Watermark height" unit="mm">
              <input type="number" step={0.05} min={0.1} value={u.watermarkHeight} onChange={(e) => setUnderside({ watermarkHeight: Number(e.target.value) })} />
            </Field>
          </Details>
        </>
      )}
    </div>
  );
}

function PieceMagnetEditor({
  piece,
  magnet,
  onChange,
}: {
  piece: Piece;
  magnet: MagnetSettings;
  onChange: (id: string, magnets: Piece['magnets']) => void;
}) {
  function setMode(mode: 'auto' | 'manual') {
    onChange(piece.id, { mode, slots: piece.magnets.slots });
  }
  function placeAuto() {
    onChange(piece.id, { mode: 'auto', slots: [] });
  }
  function addSlot() {
    onChange(piece.id, { mode: 'manual', slots: [...piece.magnets.slots, { id: newId('mg'), xy: [0, 0] }] });
  }
  function removeSlot(id: string) {
    onChange(piece.id, { mode: piece.magnets.mode, slots: piece.magnets.slots.filter((s) => s.id !== id) });
  }
  function updateSlot(id: string, patch: Partial<MagnetSlot>) {
    onChange(piece.id, {
      mode: piece.magnets.mode,
      slots: piece.magnets.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    });
  }

  return (
    <div className="piece-magnets">
      <Field
        label="Magnets on this base"
        help='Auto places 1–4 magnets depending on the size of the base. Switch to Manual to drag them yourself in the Underside view.'
      >
        <div className="button-group">
          <button type="button" className={piece.magnets.mode === 'auto' ? 'active' : ''} onClick={() => setMode('auto')}>
            Auto
          </button>
          <button
            type="button"
            className={piece.magnets.mode === 'manual' ? 'active' : ''}
            onClick={() => setMode('manual')}
          >
            Manual
          </button>
        </div>
      </Field>

      {piece.magnets.slots.length === 0 ? (
        <div className="panel-empty">No magnet slots yet.</div>
      ) : (
        <div className="slot-list">
          {piece.magnets.slots.map((slot, i) => (
            <Details key={slot.id} summary={`Magnet ${i + 1} at ${formatMm(slot.xy[0])}, ${formatMm(slot.xy[1])} mm`}>
              <div className="field-row two">
                <label className="field">
                  <span>X (mm)</span>
                  <input
                    type="number"
                    step={0.5}
                    value={slot.xy[0]}
                    onChange={(e) => updateSlot(slot.id, { xy: [Number(e.target.value), slot.xy[1]] })}
                  />
                </label>
                <label className="field">
                  <span>Y (mm)</span>
                  <input
                    type="number"
                    step={0.5}
                    value={slot.xy[1]}
                    onChange={(e) => updateSlot(slot.id, { xy: [slot.xy[0], Number(e.target.value)] })}
                  />
                </label>
              </div>
              <div className="field-row two">
                <label className="field">
                  <span>Diameter override (mm)</span>
                  <input
                    type="number"
                    step={0.1}
                    placeholder={String(magnet.dia)}
                    title="Leave blank to use the project's magnet size"
                    value={slot.dia ?? ''}
                    onChange={(e) => updateSlot(slot.id, { dia: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Thickness override (mm)</span>
                  <input
                    type="number"
                    step={0.1}
                    placeholder={String(magnet.thick)}
                    title="Leave blank to use the project's magnet size"
                    value={slot.thick ?? ''}
                    onChange={(e) => updateSlot(slot.id, { thick: e.target.value === '' ? undefined : Number(e.target.value) })}
                  />
                </label>
              </div>
              <button type="button" onClick={() => removeSlot(slot.id)}>
                Remove this magnet
              </button>
            </Details>
          ))}
        </div>
      )}

      <div className="button-row">
        <button type="button" onClick={addSlot}>
          + Add a magnet
        </button>
        <button type="button" onClick={placeAuto}>
          Place automatically again
        </button>
      </div>
    </div>
  );
}

export function MagnetPanel() {
  const magnet = useAppStore((s) => s.project.magnet);
  const setMagnetSettings = useAppStore((s) => s.setMagnetSettings);
  const selectedId = useAppStore((s) => s.project.selectedId);
  const piece = useAppStore((s) => (selectedId ? (s.project.pieces[selectedId] ?? null) : null));
  const setPieceMagnets = useAppStore((s) => s.setPieceMagnets);
  const presets = magnetPresets();
  const matchingPreset = presets.find((p) => p.dia === magnet.dia && p.thick === magnet.thick);

  // Selecting "Custom size..." must be sticky even if the current dia/thick
  // happen to equal a preset — otherwise picking Custom on e.g. 3x2mm looked
  // like it did nothing, because the dropdown just snapped back to "3x2mm".
  const [customOverride, setCustomOverride] = useState(false);
  const isCustomSize = customOverride || !matchingPreset;

  function handleProfile(profile: PrinterProfile) {
    if (profile === 'custom') {
      setMagnetSettings({ printer: 'custom' });
      return;
    }
    // Only change the fit/tolerance numbers, not the magnet size the user picked.
    const defaults = defaultMagnetSettings(profile);
    setMagnetSettings({
      printer: profile,
      radialTol: defaults.radialTol,
      depthTol: defaults.depthTol,
      floorMin: defaults.floorMin,
      minWall: defaults.minWall,
      sides: defaults.sides,
    });
  }

  function handlePresetChange(value: string) {
    if (value === 'custom') {
      setCustomOverride(true);
      return;
    }
    setCustomOverride(false);
    const [dia, thick] = value.split('x').map(Number);
    setMagnetSettings({ dia, thick });
  }

  return (
    <div className="panel magnet-panel">
      <div className="panel-title">3 · Magnets (optional)</div>
      <div className="panel-subtitle">Settings for every base. Bases with slots that no longer fit show a ⚠ in the list on the left.</div>
      <UndersideSection />

      <Hint>Magnets sit under every base so it sticks to a steel sheet or movement tray. Placed automatically; you rarely need to touch this. In Movement tray mode the tray gets a matching hole under every base, so the magnets have to be thinner than the tray floor to stay inside it.</Hint>

      <Field label="Magnet size" help="Measure your magnets; disc magnets are sold as diameter × thickness.">
        <select value={isCustomSize ? 'custom' : `${magnet.dia}x${magnet.thick}`} onChange={(e) => handlePresetChange(e.target.value)}>
          {presets.map((p) => (
            <option key={p.label} value={`${p.dia}x${p.thick}`}>
              {magnetPresetLabel(p)}
            </option>
          ))}
          <option value="custom">Custom size…</option>
        </select>
      </Field>
      {isCustomSize && (
        <div className="field-row two indent">
          <label className="field">
            <span>Diameter (mm)</span>
            <input
              type="number"
              step={0.1}
              min={0.1}
              value={magnet.dia}
              onChange={(e) => setMagnetSettings({ dia: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Thickness (mm)</span>
            <input
              type="number"
              step={0.1}
              min={0.1}
              value={magnet.thick}
              onChange={(e) => setMagnetSettings({ thick: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      <Field
        label="Printer"
        help="Sets how much extra room the slot gets so the magnet press-fits. Resin printers are precise (+0.1 mm), FDM needs more (+0.2 mm). Pick Custom to set your own."
      >
        <select value={magnet.printer} onChange={(e) => handleProfile(e.target.value as PrinterProfile)}>
          <option value="resin">Resin</option>
          <option value="fdm">FDM</option>
          <option value="custom">Custom</option>
        </select>
      </Field>

      <Details summary="Fit and safety settings" defaultOpen={magnet.printer === 'custom'}>
        <Field
          label="Slot extra width"
          unit="mm"
          help="Added to the magnet diameter so it slides in. Too small: the magnet won't fit. Too large: it falls out."
        >
          <input
            type="number"
            step={0.05}
            value={magnet.radialTol}
            onChange={(e) => setMagnetSettings({ radialTol: Number(e.target.value) })}
          />
        </Field>
          <Hint>Resin holes print 0.1–0.3 mm small. Tight magnet? Add 0.05 mm here and reprint one base. Loose? Take 0.05 mm off.</Hint>
        <Field label="Slot extra depth" unit="mm" help="Added to the depth so the magnet sits fully inside.">
          <input
            type="number"
            step={0.05}
            value={magnet.depthTol}
            onChange={(e) => setMagnetSettings({ depthTol: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Minimum material above the slot"
          unit="mm"
          help="How much solid plate must remain between the slot and the sculpted top. Below ~0.5 mm the top can break through."
        >
          <input
            type="number"
            step={0.05}
            value={magnet.floorMin}
            onChange={(e) => setMagnetSettings({ floorMin: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Minimum material beside the slot"
          unit="mm"
          help="Distance kept between a slot and the edge of the base."
        >
          <input
            type="number"
            step={0.05}
            value={magnet.minWall}
            onChange={(e) => setMagnetSettings({ minWall: Number(e.target.value) })}
          />
        </Field>
        <Field label="Roundness (sides)" help="How many flat facets make up the round slot; 48 is smooth enough.">
          <input
            type="number"
            step={1}
            min={8}
            value={magnet.sides}
            onChange={(e) => setMagnetSettings({ sides: Number(e.target.value) })}
          />
        </Field>
      </Details>

      <div className="panel-divider" />
      {!piece ? (
        <div className="panel-empty">Select a base to edit its magnets.</div>
      ) : piece.role === 'tray' ? (
        <Hint>This tray gets a magnet hole under each base automatically, lined up with that base&rsquo;s own magnet. Turn them off in the tray settings on the Bases tab. Check which way round the magnets go before you glue them: the tray and the base have to attract, not push apart.</Hint>
      ) : (
        <PieceMagnetEditor piece={piece} magnet={magnet} onChange={setPieceMagnets} />
      )}
    </div>
  );
}
