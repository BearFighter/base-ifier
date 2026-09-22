import type { StudioDocument } from '@/kernel/studio/document';
/**
 * Shape of the zustand app store. UI components and the cutter overlay code
 * against this interface; `src/state/project.ts` implements it.
 */
import type { EdgeProfile, Shape, Vec2 } from '@/kernel/types';
import type { MagnetSettings, ExportSettings, MagnetSlot, Piece, PieceRole, Project, WorkMode, UndersideSettings, PlugSettings, TraySettings } from '@/model/types';
import type { PieceGeometryTransfer, SourceSummary, ColumnInfo } from '@/worker/api';

export type ViewMode = 'top' | 'orbit' | 'underside';
/** 'layout' = place pieces on the selected base/piece (default); 'magnets' = edit magnet slots. */
export type Tool = 'layout' | 'magnets';

export interface SourceState {
  summary: SourceSummary | null;
  status: 'loading' | 'ready' | 'error';
  progress?: { stage: string; fraction: number };
  error?: string;
  /** original file name and size, for re-identification */
  fileName: string;
  fileSize: number;
  /** the File object, kept so the geometry engine can be reloaded after a restart */
  file?: File;
  /** where the scene came from: an STL file (default) or a Base Studio bake */
  origin?: 'file' | 'studio';
  studioId?: string;
}

export interface GeometryState {
  status: 'pending' | 'ready' | 'error';
  data?: PieceGeometryTransfer;
  error?: string;
}

/** A piece frame being placed on the SELECTED piece (its local frame, mm). */
export interface DraftCutter {
  id: string;
  shape: Shape;
  xy: Vec2;
  rotDeg: number;
  name?: string;
}

export interface ViewState {
  mode: ViewMode;
  showSculpt: boolean;
  tool: Tool;
  /** frames being placed on the selected piece; become pieces on "Create pieces" */
  drafts: DraftCutter[];
  activeDraftId: string | null;
  /** show inline explanations under settings and the getting-started guide */
  showHelp: boolean;
  /** piece awaiting delete confirmation (it has pieces inside it) */
  confirmDelete: string | null;
  /** the optional account sign-in dialog */
  showSignIn?: boolean;
  /** which side of the app is on screen: the cutter or Base Studio */
  surface?: 'cutter' | 'studio';
  /** base (source) awaiting removal confirmation */
  confirmRemoveSource: string | null;
  /** which left-hand tab is open */
  leftTab: 'base' | 'bases' | 'magnets' | 'export';
}

export interface AppState {
  project: Project;
  sources: Record<string, SourceState>;
  geometry: Record<string, GeometryState>;
  /** what lies under each placed base (terrain thickness), fetched before Base-ify so the app can offer plug cuts */
  terrain: Record<string, ColumnInfo>;
  view: ViewState;
  /** number of geometry computations currently running or queued */
  busy: number;
  /** true once "Base-ify" has been pressed and no base has changed since */
  baseified: boolean;
  /** leaf bases being previewed after Base-ify, in order */
  previewIds: string[];
  /** last error to show in a toast */
  lastError: string | null;
}

export interface AppActions {
  // sources
  loadSourceFile(file: File): Promise<string | null>;
  removeSource(id: string): void;

  // pieces
  selectPiece(id: string | null): void;
  /** select the parent of the current piece (no-op on a root) */
  goToParent(): void;
  /** create a child piece; returns its id (or null if the mode does not allow it). No geometry is computed until Base-ify. */
  addPiece(parentId: string, draft: Omit<DraftCutter, 'id'> & { profile?: EdgeProfile; role?: PieceRole }): string | null;
  /** create several children at once */
  addPieces(parentId: string, drafts: (Omit<DraftCutter, 'id'> & { profile?: EdgeProfile; role?: PieceRole })[]): string[];
  setMode(mode: WorkMode): void;
  /** process every base: in Diorama mode first turns the remaining material into bases, then computes all cuts and opens the preview */
  baseify(): Promise<void>;
  /** step through the previewed bases */
  previewStep(delta: number): void;
  updatePiece(id: string, patch: Partial<Pick<Piece, 'name' | 'shape' | 'xy' | 'rotDeg' | 'edges' | 'profile' | 'cut' | 'plugDepth' | 'plugClearance'>>): void;
  /** edge profile for bases added from now on (also applied when a size preset implies none) */
  setDefaultProfile(profile: EdgeProfile): void;
  /** delete immediately when the piece has no children, otherwise ask for confirmation */
  requestDeletePiece(id: string): void;
  confirmDeletePiece(): void;
  /** ask before removing a base and every piece cut from it */
  requestRemoveSource(id: string): void;
  confirmRemoveSource(): void;
  cancelDelete(): void;
  removePiece(id: string): void;
  /** restart the geometry engine (after a hang) and reload every source that still has its File */
  restartKernel(reason?: string): Promise<void>;
  setPieceMagnets(id: string, magnets: { mode: 'auto' | 'manual'; slots: MagnetSlot[] }): void;

  // settings
  setMagnetSettings(patch: Partial<MagnetSettings>): void;
  /** hollow/solid underside, brim, rings, watermark; recomputes every base when Base-ified */
  setUndersideSettings(patch: Partial<UndersideSettings>): void;
  /** project defaults for plug cuts */
  setPlugSettings(patch: Partial<PlugSettings>): void;
  /** movement tray settings; with `frameId` they apply to that frame's tray only */
  setTraySettings(patch: Partial<TraySettings>, frameId?: string): void;
  /** measure the terrain under a base (cheap; cached per piece geometry) */
  fetchTerrainInfo(id: string): Promise<void>;
  setExportSettings(patch: Partial<ExportSettings>): void;

  // view / tools
  setView(patch: Partial<ViewState>): void;
  setDrafts(drafts: DraftCutter[], activeId?: string | null): void;
  updateDraft(id: string, patch: Partial<DraftCutter>): void;

  // geometry
  /** (re)compute geometry for a piece and all its descendants */
  recomputeSubtree(id: string): Promise<void>;
  /** ensure geometry exists for a piece (compute if missing) */
  ensureGeometry(id: string): Promise<void>;

  // export
  exportPieceStl(id: string): Promise<void>;
  exportLeavesZip(sourceId: string): Promise<void>;
  exportPlateStl(sourceId: string): Promise<void>;

  // persistence
  saveProjectFile(): void;
  loadProjectFile(file: File): Promise<void>;

  // Base Studio
  /** register a source the worker already holds (studio bakes); updates an existing one in place */
  registerPreparedSource(id: string, name: string, summary: SourceSummary, opts: { origin: 'file' | 'studio'; studioId?: string; file?: File }): Promise<void>;
  /** keep a studio document in the project (saved with it) */
  saveStudioDocument(doc: StudioDocument): void;
  /** open Base Studio on an existing document, the scene behind a studio source, or a new scene */
  openStudio(opts?: { docId?: string; sourceId?: string }): void;
  closeStudio(): void;
  clearError(): void;
}

export type AppStore = AppState & AppActions;
