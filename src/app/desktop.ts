/**
 * Bridge to the Electron shell when the app runs as the installed .exe
 * (see electron/preload.cjs). In a plain browser every call has a fallback.
 */
export interface UpdateState {
  state: 'idle' | 'dev' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  message?: string;
  /** browser builds: where to get the new version */
  url?: string;
}

interface DesktopBridge {
  version(): Promise<string>;
  checkForUpdates(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  openExternal(url: string): Promise<void>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
}

export function getDesktop(): DesktopBridge | null {
  const w = window as unknown as { baseifierDesktop?: DesktopBridge };
  return w.baseifierDesktop ?? null;
}

export function isDesktop(): boolean {
  return getDesktop() !== null;
}

/** Open a link outside the app: the system browser on desktop, a new tab on the web. */
export function openExternal(url: string): void {
  const d = getDesktop();
  if (d) void d.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
