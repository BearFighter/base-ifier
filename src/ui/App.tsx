import React, { useRef, useState } from 'react';
import { SignInDialog } from '@/ui/auth/SignInDialog';
import { useAppStore } from '@/state/project';
import { ViewportSlot } from '@/ui/ViewportSlot';
import { CutterOverlay } from '@/ui/cutter/CutterOverlay';
import { AddBar } from '@/ui/cutter/AddBar';
import { ActionBar } from '@/ui/ActionBar';
import { LeftTabs } from '@/ui/LeftTabs';
import { HowItWorks } from '@/ui/help/GettingStarted';
import { StudioApp } from '@/ui/studio/StudioApp';

function Header() {
  const showHelp = useAppStore((s) => s.view.showHelp);
  const setView = useAppStore((s) => s.setView);
  const saveProjectFile = useAppStore((s) => s.saveProjectFile);
  const loadProjectFile = useAppStore((s) => s.loadProjectFile);
  const loadInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="app-header">
      <span className="app-name">Base-ifier</span>
      <span className="app-tagline">Hew the bases thou needest from one great slab of sculpted ground</span>
      <div className="header-spacer" />
      <button type="button" className={showHelp ? 'active' : ''} title="Show or hide the explanations under each control" onClick={() => setView({ showHelp: !showHelp })}>
        ⓘ Help {showHelp ? 'on' : 'off'}
      </button>
      <div className="button-group">
        <button type="button" onClick={() => saveProjectFile()} title="Save this layout (bases, magnets, settings) as a file">
          Save project
        </button>
        <button type="button" onClick={() => loadInputRef.current?.click()} title="Open a saved project file (you will be asked for the STL again)">
          Open project
        </button>
        <input
          ref={loadInputRef}
          type="file"
          accept=".json,.baseifier.json"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void loadProjectFile(file);
          }}
        />
      </div>
    </header>
  );
}

function ConfirmDeleteDialog() {
  const id = useAppStore((s) => s.view.confirmDelete);
  const piece = useAppStore((s) => (s.view.confirmDelete ? s.project.pieces[s.view.confirmDelete] : undefined));
  const confirm = useAppStore((s) => s.confirmDeletePiece);
  const cancel = useAppStore((s) => s.cancelDelete);
  const sourceId = useAppStore((s) => s.view.confirmRemoveSource);
  const sourceName = useAppStore((s) => (s.view.confirmRemoveSource ? (s.sources[s.view.confirmRemoveSource]?.fileName ?? 'this base') : ''));
  const pieceCount = useAppStore((s) => (s.view.confirmRemoveSource ? Object.values(s.project.pieces).filter((p) => p.sourceId === s.view.confirmRemoveSource && p.parentId !== null).length : 0));
  const confirmSource = useAppStore((s) => s.confirmRemoveSource);
  if (sourceId) {
    return (
      <div className="modal-backdrop" onClick={cancel}>
        <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          <h3>Remove “{sourceName.replace(/\.stl$/i, '')}”?</h3>
          <p>{pieceCount > 0 ? `The base and the ${pieceCount} item${pieceCount === 1 ? '' : 's'} placed on it are removed from this project. The STL file on disk is not touched.` : 'The base is removed from this project. The STL file on disk is not touched.'}</p>
          <div className="modal-actions">
            <button type="button" onClick={cancel} autoFocus>Keep it</button>
            <button type="button" className="danger" onClick={confirmSource}>Remove base</button>
          </div>
        </div>
      </div>
    );
  }
  if (!id || !piece) return null;
  const n = piece.children.length;
  return (
    <div className="modal-backdrop" onClick={cancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Delete “{piece.name}”?</h3>
        <p>{n > 0 ? `It has ${n} base${n === 1 ? '' : 's'} inside it; deleting it removes all of them.` : 'It is removed from the layout.'} Nothing is lost from the scene itself.</p>
        <div className="modal-actions">
          <button type="button" onClick={cancel} autoFocus>Keep it</button>
          <button type="button" className="danger" onClick={confirm}>{n > 0 ? `Delete ${n + 1} items` : 'Delete'}</button>
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  const lastError = useAppStore((s) => s.lastError);
  const clearError = useAppStore((s) => s.clearError);
  return (
    <footer className="app-status">
      <div className="status-left">
        {lastError ? null : <span className="muted">Scroll to zoom the view, right-drag or shift-drag to pan.</span>}
      </div>
      {lastError && (
        <div className="status-error">
          <span>{lastError}</span>
          <button type="button" className="icon-button" onClick={() => clearError()} title="Dismiss">×</button>
        </div>
      )}
    </footer>
  );
}

export function App() {
  const surface = useAppStore((s) => s.view.surface ?? 'cutter');
  const loadSourceFile = useAppStore((s) => s.loadSourceFile);
  const hasSelection = useAppStore((s) => s.project.selectedId !== null);
  const anyLoading = useAppStore((s) => Object.values(s.sources).some((x) => x.status === 'loading'));
  const [dragging, setDragging] = useState(false);

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); setDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); setDragging(false); }
  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const f of files) {
      if (/\.stl$/i.test(f.name)) await loadSourceFile(f);
    }
  }

  if (surface === 'studio') return <StudioApp />;

  return (
    <div className={`app-shell two-col${dragging ? ' dragging' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <Header />

      <aside className="app-left">
        <LeftTabs />
      </aside>

      <main className="app-center">
        <AddBar />
        <div className="viewport-host">
          <ViewportSlot />
          <div id="viewport-overlay" className="viewport-overlay">
            <CutterOverlay />
          </div>
          {!hasSelection && !anyLoading && (
            <div className="viewport-empty">
              <HowItWorks />
            </div>
          )}
        </div>
        <ActionBar />
      </main>

      <StatusBar />
      <ConfirmDeleteDialog />
      <SignInDialog />

      {dragging && (
        <div className="drop-overlay">
          <span>Drop STL files to load them</span>
        </div>
      )}
    </div>
  );
}
