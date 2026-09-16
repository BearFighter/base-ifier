/**
 * "Is there a newer Base-ifier?" On the desktop the Electron shell asks
 * electron-updater (GitHub Releases) and can install the download; in a
 * browser we ask the GitHub API for the latest release tag and link to it.
 */
import { create } from 'zustand';
import { APP_VERSION, GITHUB_REPO, GITHUB_RELEASES_URL } from './config';
import { getDesktop } from './desktop';
import type { UpdateState } from './desktop';

/** semver-ish compare of "1.2.3" strings (a leading v is ignored): >0 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split(/[.-]/).map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0));
  const pb = b.replace(/^v/i, '').split(/[.-]/).map((x) => (Number.isFinite(Number(x)) ? Number(x) : 0));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface UpdateStore extends UpdateState {
  current: string;
  check(): Promise<void>;
  install(): Promise<void>;
  /** wire the desktop shell's push events; returns an unsubscribe */
  listen(): () => void;
}

export const useUpdateStore = create<UpdateStore>()((set) => ({
  state: 'idle',
  current: APP_VERSION,
  async check() {
    set({ state: 'checking', message: undefined });
    const d = getDesktop();
    if (d) {
      const s = await d.checkForUpdates();
      // a build that cannot self-update (unsigned macOS) still gets told about new releases
      if (s.state !== 'unsupported') {
        set({ ...s });
        return;
      }
    }
    try {
      const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
      if (r.status === 404) { set({ state: 'none' }); return; }
      if (!r.ok) { set({ state: 'error', message: `GitHub answered ${r.status}` }); return; }
      const j = (await r.json()) as { tag_name?: string; html_url?: string };
      const latest = j.tag_name ?? '';
      if (latest && compareVersions(latest, APP_VERSION) > 0) set({ state: 'available', version: latest.replace(/^v/i, ''), url: j.html_url ?? GITHUB_RELEASES_URL });
      else set({ state: 'none' });
    } catch (err) {
      set({ state: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  },
  async install() {
    const d = getDesktop();
    if (d) await d.installUpdate();
  },
  listen() {
    const d = getDesktop();
    if (!d) return () => {};
    return d.onUpdate((s) => set({ ...s }));
  },
}));
