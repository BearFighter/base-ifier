/**
 * Bottom strip under the view: how to look at things (top / 3D / underside),
 * what is selected, the preview stepper, and the big Base-ify button.
 */
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/state/project';
import { pieceSize } from '@/model/tree';
import type { ViewMode } from '@/state/types';
import { StatusLinks } from '@/ui/StatusLinks';

const VIEWS: { id: ViewMode; label: string; title: string }[] = [
  { id: 'top', label: 'Top', title: 'The whole scene from above: place and arrange bases here (scroll to zoom, right-drag to pan)' },
  { id: 'orbit', label: '3D', title: 'Turn the selected base around to inspect it (left-drag to rotate)' },
  { id: 'underside', label: 'Underside', title: 'The bottom of the selected base, where the magnet slots are' },
];

export function ActionBar() {
  const { baseified, busy, previewIds, selectedId, hasBase, count, mode, showSculpt } = useAppStore(
    useShallow((s) => ({
      baseified: s.baseified,
      busy: s.busy,
      previewIds: s.previewIds,
      selectedId: s.project.selectedId,
      hasBase: Object.keys(s.project.sources).length > 0,
      // the tray is made for you at Base-ify, so it must not make the count jump afterwards
      count: Object.values(s.project.pieces).filter((p) => p.parentId !== null && p.children.length === 0 && p.role !== 'tray').length,
      mode: s.view.mode,
      showSculpt: s.view.showSculpt,
    })),
  );
  const baseify = useAppStore((s) => s.baseify);
  const previewStep = useAppStore((s) => s.previewStep);
  const setView = useAppStore((s) => s.setView);
  const selected = useAppStore((s) => (s.project.selectedId ? s.project.pieces[s.project.selectedId] : undefined));
  const previewFull = useAppStore((s) => {
    const g = s.project.selectedId ? s.geometry[s.project.selectedId] : undefined;
    const m = g?.data?.sculpt;
    return m?.simplified ? (m.fullTriCount ?? 0) : 0;
  });
  const idx = previewIds.indexOf(selectedId ?? '');
  const size = selected ? pieceSize(selected) : null;
  const isRoot = selected?.parentId === null;

  return (
    <div className="action-bar">
      <div className="button-group" role="group" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" className={mode === v.id ? 'active' : ''} title={v.title} disabled={!selected} onClick={() => setView({ mode: v.id })}>
            {v.label}
          </button>
        ))}
        <button
          type="button"
          className={showSculpt ? 'active' : ''}
          disabled={!selected}
          title={previewFull > 0 ? `Show or hide the sculpted surface. This one is very detailed (${(previewFull / 1e6).toFixed(1)} million triangles) so the view shows a lighter preview; downloads keep full detail.` : 'Show or hide the sculpted surface (hide it if the view feels slow)'}
          onClick={() => setView({ showSculpt: !showSculpt })}
        >
          {previewFull > 0 ? 'Detail (preview)' : 'Detail'}
        </button>
      </div>

      <div className="action-status">
        {baseified && previewIds.length > 0 ? (
          <>
            <button type="button" onClick={() => previewStep(-1)} title="Previous base">‹</button>
            <span>Previewing {idx < 0 ? '–' : idx + 1} of {previewIds.length}: <strong>{selected?.name}</strong></span>
            <button type="button" onClick={() => previewStep(1)} title="Next base">›</button>
            <button type="button" onClick={() => setView({ mode: 'top', leftTab: 'bases' })} title="Back to arranging bases">Back to layout</button>
            <span className="muted">Downloads live in the Export tab.</span>
          </>
        ) : selected && size ? (
          <span className="muted">
            Selected: <strong>{selected.name}</strong> · {Number.isInteger(size.w) ? size.w : size.w.toFixed(1)} × {Number.isInteger(size.d) ? size.d : size.d.toFixed(1)} mm{isRoot ? ' (the scene)' : ''}
            {count > 0 ? ' · nothing is cut until you press Base-ify' : ''}
          </span>
        ) : (
          <span className="muted">Load a scene to begin.</span>
        )}
      </div>

      <button
        type="button"
        className="baseify"
        disabled={!hasBase || busy > 0 || count === 0}
        onClick={() => void baseify()}
        title={!hasBase ? 'Load a scene first' : count === 0 ? 'Place at least one base first' : baseified ? 'Nothing changed since the last Base-ify; press again to re-forge anyway' : 'Cut every base out of the scene, add the magnet slots, and open the preview'}
      >
        {busy > 0 ? `Forging… ${busy} to go` : baseified ? '✓ Base-ified' : `⚒ Base-ify ${count} base${count === 1 ? '' : 's'}`}
      </button>
      <StatusLinks />
    </div>
  );
}
