/**
 * One left-hand menu with tabs instead of stacked panels on both sides.
 */
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

export function LeftTabs() {
  const tab = useAppStore((s) => s.view.leftTab);
  const setView = useAppStore((s) => s.setView);
  const baseified = useAppStore((s) => s.baseified);
  return (
    <div className="left-tabs">
      <div className="tab-strip" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' active' : ''}${t.id === 'export' && baseified ? ' ready' : ''}`} title={t.title} onClick={() => setView({ leftTab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-body">
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
