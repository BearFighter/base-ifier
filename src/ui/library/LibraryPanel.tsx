/** Left-column panel: load STL sources (files or a folder) and list them. */
import React, { useRef, useState } from 'react';
import { Details, Field } from '@/ui/common/Field';
import { edgeSlopeMm, formatDuration, formatTriangleCount, formatWD, shapeNoun } from '@/ui/common/copy';
import { GettingStarted } from '@/ui/help/GettingStarted';
import { useAppStore } from '@/state/project';
import { formatMm } from '@/ui/util/format';
import { SampleLibrary } from './SampleLibrary';
import { StudioEntry } from '@/ui/studio/StudioEntry';
import { DefaultEdges } from './DefaultEdges';
import type { UpAxis } from '@/kernel/source/orient';

// The File System Access API's directory picker isn't in TS's bundled DOM
// lib yet; declare just enough of it to use `window.showDirectoryPicker`.
interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}
interface FsDirHandle {
  kind: 'directory';
  name: string;
  entries(): AsyncIterableIterator<[string, FsFileHandle | FsDirHandle]>;
}
declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FsDirHandle>;
  }
}

/** "Which way is up?" choices, in the order the select lists them. */
const UP_CHOICES: { id: UpAxis | 'auto'; label: string }[] = [
  { id: 'auto', label: 'Auto (recommended)' },
  { id: 'z+', label: 'Z up (as saved)' },
  { id: 'y+', label: 'Y up' },
  { id: 'x+', label: 'X up' },
  { id: 'z-', label: 'Z down' },
  { id: 'y-', label: 'Y down' },
  { id: 'x-', label: 'X down' },
];

/** What the automatic turn did, in a few plain words. */
function turnedNote(up: UpAxis): string {
  if (up === 'z-') return 'Turned over: the file was saved upside down.';
  return `Stood up: the file was saved ${up[0].toUpperCase()} ${up[1] === '+' ? 'up' : 'down'}.`;
}

/** The Scene card's "Which way is up?" field (file scenes only; a Base Studio scene is always built Z up). */
function OrientationField({ id }: { id: string }) {
  const setSourceOrientation = useAppStore((s) => s.setSourceOrientation);
  const o = useAppStore((s) => s.sources[id]?.orientation ?? s.sources[id]?.summary?.orientation);
  const value: UpAxis | 'auto' = useAppStore((s) => s.project.sources[id]?.orientation ?? 'auto');
  const loading = useAppStore((s) => s.sources[id]?.status === 'loading');
  return (
    <>
      <Field label="Which way is up?" help="Auto stands the scene on its biggest flat face. If it still lies on its edge, pick the axis that should point up.">
        <select
          value={value}
          disabled={loading}
          onChange={(e) => { void setSourceOrientation(id, e.target.value as UpAxis | 'auto'); }}
        >
          {UP_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </Field>
      {!loading && o && o.auto && o.applied !== 'z+' && <div className="source-note">{turnedNote(o.applied)}</div>}
      {!loading && o && o.auto && o.applied === 'z+' && o.detected !== 'z+' && (
        <div className="source-note source-warning">This scene may be {o.detected === 'z-' ? 'upside down' : 'lying on its side'}. If it looks wrong, pick the axis that should point up.</div>
      )}
    </>
  );
}

interface FolderEntry {
  path: string;
  handle: FsFileHandle;
}

/** Strips a trailing `.ext` from a file name, for display. */
function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

async function collectStlHandles(dir: FsDirHandle, prefix = ''): Promise<FolderEntry[]> {
  const out: FolderEntry[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') {
      if (/\.stl$/i.test(name)) out.push({ path: prefix + name, handle });
    } else {
      out.push(...(await collectStlHandles(handle, `${prefix}${name}/`)));
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function LibraryPanel() {
  const sources = useAppStore((s) => s.sources);
  const projectSources = useAppStore((s) => s.project.sources);
  const loadSourceFile = useAppStore((s) => s.loadSourceFile);
  const requestRemoveSource = useAppStore((s) => s.requestRemoveSource);
  const openStudio = useAppStore((s) => s.openStudio);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [folderEntries, setFolderEntries] = useState<FolderEntry[] | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const f of files) {
      if (/\.stl$/i.test(f.name)) await loadSourceFile(f);
    }
  }

  async function handleOpenFolder() {
    if (!window.showDirectoryPicker) return;
    setFolderBusy(true);
    try {
      const dir = await window.showDirectoryPicker();
      const entries = await collectStlHandles(dir);
      setFolderEntries(entries);
    } catch {
      // user cancelled the picker, or permission was denied — nothing to do
    } finally {
      setFolderBusy(false);
    }
  }

  async function handleFolderEntryClick(entry: FolderEntry) {
    const file = await entry.handle.getFile();
    await loadSourceFile(file);
  }

  function handleRemove(id: string, name: string) {
    void name;
    requestRemoveSource(id);
  }

  const supportsFolderPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const hasSources = Object.keys(sources).length > 0;

  return (
    <div className="panel library-panel">
      <div className="panel-title">Scene</div>

      <div className="dropzone">
        <div className="dropzone-text">Drop an STL here, or</div>
        <div className="button-row">
          <button type="button" onClick={() => fileInputRef.current?.click()}>
            Choose STL files…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".stl"
            className="visually-hidden"
            onChange={handleFiles}
          />
          {supportsFolderPicker && (
            <button type="button" onClick={handleOpenFolder} disabled={folderBusy}>
              {folderBusy ? 'Scanning…' : 'Choose a folder…'}
            </button>
          )}
        </div>
      </div>

      <SampleLibrary />
      <StudioEntry />
      <DefaultEdges />

      {folderEntries && (
        <div className="folder-list">
          <div className="panel-subtitle">
            Folder ({folderEntries.length} STL{folderEntries.length === 1 ? '' : 's'})
          </div>
          <ul>
            {folderEntries.map((entry) => (
              <li key={entry.path}>
                <button type="button" className="link-button" onClick={() => handleFolderEntryClick(entry)}>
                  {entry.path}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasSources && <GettingStarted />}

      <div className="source-list">
        {Object.entries(sources).map(([id, src]) => {
          const project = projectSources[id];
          const summary = src.summary;
          const displayName = stripExt(src.fileName);
          return (
            <div key={id} className="source-card">
              <div className="source-card-header">
                <span className="source-name" title={src.fileName}>
                  {displayName}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  title="Remove this base"
                  onClick={() => handleRemove(id, displayName)}
                >
                  ×
                </button>
              </div>

              {src.status === 'loading' && (
                <div className="progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${Math.round((src.progress?.fraction ?? 0) * 100)}%` }}
                  />
                  <span className="progress-label">{src.progress?.stage ?? 'loading'}</span>
                </div>
              )}
              {src.status === 'error' && <div className="error-text">Couldn't load this file: {src.error}</div>}

              {src.status === 'ready' && summary && project && (
                <div className="source-card-body">
                  <div className="source-line">
                    {formatWD(project.nominal.w, project.nominal.d)} {shapeNoun(project.nominal)} ·{' '}
                    {formatTriangleCount(project.stats.tris)}
                  </div>
                  {project.origin === 'studio' && (
                    <div className="button-row">
                      <button type="button" onClick={() => openStudio({ sourceId: id })} title="Change the ground or props, then use the scene again">
                        Edit in Base Studio
                      </button>
                    </div>
                  )}

                  {Math.abs(project.normalization.measuredScale - 1) > 0.002 && (
                    <div className="source-note">
                      This file is printed at {(project.normalization.measuredScale * 100).toFixed(1)}% of its
                      labelled size (common for pre-shrunk base sets). Sizes below are the labelled sizes.
                    </div>
                  )}

                  {summary.mode === 'generic' && (
                    <div className="source-note source-warning">
                      This file doesn't have the usual separate base plate; bases will get a plain flat plate
                      under the sculpted surface.
                    </div>
                  )}

                  <Details summary="Details">
                    <div className="field-row">
                      <span>Triangles</span>
                      <span>{project.stats.tris.toLocaleString()}</span>
                    </div>
                    <div className="field-row">
                      <span>Separate surfaces found</span>
                      <span>{project.stats.components}</span>
                    </div>
                    <div className="field-row">
                      <span>Base plate height</span>
                      <span>{formatMm(project.normalization.plateTop)} mm</span>
                    </div>
                    <div className="field-row">
                      <span>Edge slope</span>
                      <span>
                        the sides lean in by{' '}
                        {formatMm(edgeSlopeMm(project.normalization.topScale[0], project.nominal.w))} mm from
                        bottom to top
                      </span>
                    </div>
                    <div className="field-row">
                      <span>Loading time</span>
                      <span>
                        {formatDuration(
                          Object.values(summary.timings ?? {}).reduce((a, b) => a + b, 0),
                        )}
                      </span>
                    </div>
                    {summary.warnings.length > 0 && (
                      <>
                        <div className="panel-subtitle">Warnings</div>
                        <ul>
                          {summary.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Details>
                </div>
              )}

              {/* outside the ready block so it stays on the card (disabled) while the file is read again */}
              {project && project.origin !== 'studio' && src.origin !== 'studio' && src.file && (src.status === 'ready' || src.status === 'loading') && (
                <OrientationField id={id} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
