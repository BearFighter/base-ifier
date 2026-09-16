/** Left-column panel: recursive tree of pieces, grouped by source. */
import React, { useState } from 'react';
import { pieceSize } from '@/model/tree';
import { useAppStore } from '@/state/project';
import { Hint } from '@/ui/common/Hint';
import { formatWD } from '@/ui/common/copy';

export function TreePanel() {
  const sources = useAppStore((s) => s.project.sources);
  const hasSources = Object.keys(sources).length > 0;

  return (
    <div className="panel tree-panel">
      <div className="panel-title">Bases</div>
      {hasSources && (
        <Hint>
          The file you loaded is the big base at the top; every base you cut from it is listed under it. Click one to select it.
          Double-click a name to rename.
        </Hint>
      )}
      {!hasSources && <div className="panel-empty">Load an STL to see its bases here.</div>}
      {Object.values(sources).map((source) => (
        <div key={source.id} className="tree-source">
          <div className="tree-source-name">{source.name}</div>
          <PieceNode id={source.rootPieceId} depth={0} />
        </div>
      ))}
    </div>
  );
}

function PieceNode({ id, depth }: { id: string; depth: number }) {
  const piece = useAppStore((s) => s.project.pieces[id]);
  const selectedId = useAppStore((s) => s.project.selectedId);
  const geom = useAppStore((s) => s.geometry[id]);
  const selectPiece = useAppStore((s) => s.selectPiece);
  const updatePiece = useAppStore((s) => s.updatePiece);
  const requestDeletePiece = useAppStore((s) => s.requestDeletePiece);
  const addPiece = useAppStore((s) => s.addPiece);

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState('');

  if (!piece) return null;

  const size = pieceSize(piece);
  const status = geom?.status ?? 'pending';
  const statusTitle = status === 'ready' ? 'Ready' : status === 'error' ? (geom?.error ?? 'Something went wrong') : 'Computing…';
  const warnCount = geom?.data?.warnings.length ?? 0;
  const isRoot = piece.parentId === null;
  const childCount = piece.children.length;

  function startRename() {
    setDraftName(piece.name);
    setEditing(true);
  }

  function commitRename() {
    setEditing(false);
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== piece.name) updatePiece(id, { name: trimmed });
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    requestDeletePiece(id);
  }

  function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    if (!piece.parentId) return;
    addPiece(piece.parentId, {
      shape: piece.shape,
      xy: [piece.xy[0] + 5, piece.xy[1] + 5],
      rotDeg: piece.rotDeg,
      name: `${piece.name} copy`,
    });
  }

  return (
    <div className="tree-node">
      <div
        className={`tree-row${selectedId === id ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => selectPiece(id)}
        onDoubleClick={startRename}
      >
        <span className={`status-dot status-${status}`} title={statusTitle} />
        {editing ? (
          <input
            className="tree-rename-input"
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <span className="tree-name">
            {piece.name}
            {isRoot && <span className="tree-name-suffix"> (whole base)</span>}
          </span>
        )}
        <span className="tree-size">{formatWD(size.w, size.d)}</span>
        {childCount > 0 && (
          <span className="tree-count" title={`${childCount} base${childCount === 1 ? '' : 's'} inside`}>
            {childCount} inside
          </span>
        )}
        {warnCount > 0 && (
          <span className="tree-warn" title={`${warnCount} warning(s)`}>
            {warnCount}
          </span>
        )}
        <span className="tree-actions">
          <button type="button" className="icon-button" title="Duplicate" disabled={isRoot} onClick={handleDuplicate}>
            ⧉
          </button>
          <button type="button" className="icon-button" title="Delete" disabled={isRoot} onClick={handleDelete}>
            ×
          </button>
        </span>
      </div>
      {piece.children.map((childId) => (
        <PieceNode key={childId} id={childId} depth={depth + 1} />
      ))}
    </div>
  );
}
