/**
 * One left-hand menu with tabs instead of stacked panels on both sides.
 */
import { useEffect, useRef } from 'react';
import { useAppStore } from '@/state/project';
import { LibraryPanel } from '@/ui/library/LibraryPanel';
import { TreePanel } from '@/ui/tree/TreePanel';
import { PiecePanel } from '@/ui/piece/PiecePanel';
import { MagnetPanel } from '@/ui/magnets/MagnetPanel';
import { ExportPanel } from '@/ui/export/ExportPanel';
import type { ViewState } from '@/state/types';

type Tab = ViewState['leftTab'];
const TABS: { id: Tab; label: string; title: string }[] = [
  { id: 'base', label: 'Scene', title: 'The sculpted STL you loaded and are cutting from' },
  { id: 'bases', label: 'Bases', title: 'Everything you have placed on the scene, and the selected one' },
  { id: 'magnets', label: 'Magnets', title: 'Magnet slot size and fit (automatic by default)' },
  { id: 'export', label: 'Export', title: 'Download the finished bases' },
];

/**
 * Puts the `more-below` class on a menu's scrolling body while there is more
 * to read under the fold, which draws the shadow at its bottom edge (see
 * theme.css). Windows hides scrollbars until you actually scroll — Firefox
 * draws them as a fading overlay — so the bar on its own is no sign that the
 * list goes on. `watch` re-runs it when the tab, and so the content, changes;
 * everything else is caught by watching the body and its panels resize.
 */
export function useMoreBelow(watch: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => el.classList.toggle('more-below', el.scrollHeight - el.clientHeight - el.scrollTop > 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [watch]);
  return ref;
}

export function LeftTabs() {
  const tab = useAppStore((s) => s.view.leftTab);
  const setView = useAppStore((s) => s.setView);
  const baseified = useAppStore((s) => s.baseified);
  const bodyRef = useMoreBelow(tab);
  return (
    <div className="left-tabs">
      <div className="tab-strip" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' active' : ''}${t.id === 'export' && baseified ? ' ready' : ''}`} title={t.title} onClick={() => setView({ leftTab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-body" ref={bodyRef}>
        {tab === 'base' && <LibraryPanel />}
        {tab === 'bases' && (
          <>
            <TreePanel />
            <PiecePanel />
          </>
        )}
        {tab === 'magnets' && <MagnetPanel />}
        {tab === 'export' && <ExportPanel />}
      </div>
    </div>
  );
}
