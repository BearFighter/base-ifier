/**
 * Electron main process for the installable Base-ifier.
 *
 * - Serves the built web app from dist/ over the privileged `app://` scheme
 *   (module scripts and workers do not load from file:// origins).
 * - Opens every external link (Discord, GitHub, the account site) in the
 *   system browser and turns STL/ZIP downloads into Save As dialogs.
 * - Checks GitHub Releases for updates with electron-updater: on start and on
 *   demand from the renderer; the renderer shows the state in its bottom bar.
 * - `--smoke`: load the app, report whether it rendered, and exit (used by CI).
 *
 * In development run `npm run electron:dev`: VITE_DEV_SERVER_URL points the
 * window at the Vite dev server instead of dist/.
 */
import { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } from 'electron';
import electronUpdater from 'electron-updater';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { autoUpdater } = electronUpdater;
const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(here, '..', 'dist');
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const APP_ORIGIN = 'app://base-ifier';
const SMOKE = process.argv.includes('--smoke');

let win: BrowserWindow | null = null;

export interface UpdateState {
  state: 'dev' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

function sendUpdate(s: UpdateState): void {
  win?.webContents.send('updates:state', s);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveDist(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url) && !url.startsWith(APP_ORIGIN) && !(DEV_URL && url.startsWith(DEV_URL));
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Base-ifier',
    backgroundColor: '#efe6d3',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // links to the outside world open in the user's browser, never in the app window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isExternal(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  // exports become Save As dialogs
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'Save', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });

  if (SMOKE) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const ok = await win!.webContents.executeJavaScript('document.title + "|" + (document.querySelector("#root > *") ? "rendered" : "empty")');
          console.log('SMOKE ' + ok);
          app.exit(String(ok).endsWith('rendered') ? 0 : 1);
        } catch (err) {
          console.log('SMOKE error ' + String(err));
          app.exit(1);
        }
      }, 1500);
    });
  }

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadURL(`${APP_ORIGIN}/index.html`);
  win.on('closed', () => { win = null; });
}

function setupUpdates(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ state: 'error', message: err?.message ?? String(err) }));
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => { /* reported through the error event */ }); }, 4000);
}

ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('shell:openExternal', (_e, url: unknown) => {
  if (typeof url === 'string' && isExternal(url)) return shell.openExternal(url);
  return Promise.resolve();
});
ipcMain.handle('updates:check', async (): Promise<UpdateState> => {
  if (!app.isPackaged) return { state: 'dev' };
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r?.updateInfo?.version;
    const newer = !!v && v !== app.getVersion();
    return newer ? { state: 'available', version: v } : { state: 'none' };
  } catch (err) {
    return { state: 'error', message: err instanceof Error ? err.message : String(err) };
  }
});
ipcMain.handle('updates:install', () => {
  if (app.isPackaged) autoUpdater.quitAndInstall();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'View', submenu: [{ role: 'toggleDevTools' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ]));
  serveDist();
  createWindow();
  setupUpdates();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
