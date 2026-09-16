import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

/** Dev only: `?autotest=1` runs a scripted performance pass in the app and POSTs its report here (see src/dev/autotest.ts). */
function perfLogPlugin(): Plugin {
  return {
    name: 'perf-log',
    configureServer(server) {
      server.middlewares.use('/__perf', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', () => {
          const dir = path.resolve('perf-logs');
          fs.mkdirSync(dir, { recursive: true });
          const file = path.join(dir, `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
          fs.writeFileSync(file, body);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ file }));
        });
      });
    },
  };
}

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  // relative asset paths so the built app also loads from the Electron shell's app:// origin
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), perfLogPlugin()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  server: {
    headers: { 'Document-Policy': 'js-profiling' },
    port: 5173,
    strictPort: false,
    // the dev server must not hold handles on build output (electron-builder renames folders there)
    watch: { ignored: ['**/release/**', '**/dist/**', '**/dist-electron/**', '**/perf-logs/**', '**/S - Bases/**'] },
  },
});
