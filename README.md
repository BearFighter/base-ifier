# Base-ifier

Cut one big sculpted wargaming base into the base sizes you actually need
(Kings of War, The Old World, 40k, OPR), add magnet slots, and export STLs that
are ready for a resin printer: hollow underside with a brim, magnet locating
rings, and an optional tilted, pre-supported print-ready version.

Community and support: [Discord](https://discord.gg/7mhYNtdmQV).

## Run it

**Installed app (Windows):** download `Base-ifier-Setup-<version>.exe` from the
[Releases](https://github.com/BearFighter/base-ifier/releases) page. The app
checks GitHub for new versions when it starts and shows "Restart to update" in
the bottom bar when one has been downloaded.

**In a browser (developers):**

```bash
npm install
npm run dev
```

then open http://localhost:5173. In development the bundled One Page Rules
sample set is listed under "Bundled OPR bases" if the `S - Bases/STL` folder is
present next to the project (it is not part of the repository).

**Desktop in development:** `npm run electron:dev` starts Vite and opens the
Electron window against it.

## Build the installer

```bash
npm run electron:build
```

produces `release/Base-ifier-Setup-<version>.exe` (NSIS, per-user install,
x64). `npm run electron:smoke` builds and launches the packaged renderer once
to check it renders, then exits.

## Publish a release (and push an update to every installed copy)

1. Bump `version` in `package.json` (e.g. `0.1.1`).
2. Commit, tag and push: `git tag v0.1.1 && git push --tags`.
3. The `Release` GitHub Actions workflow builds the installer on Windows and
   attaches it, plus `latest.yml`, to a GitHub Release for that tag.
4. Installed apps pick the new version up automatically on their next start
   (electron-updater reads `latest.yml` from the latest GitHub Release); the web
   build shows a "Version x is out" chip that links to the release.

Releases must be public and tagged `v<version>`; the version in the tag and in
`package.json` must match. Installers are unsigned for now, so Windows
SmartScreen shows a warning on first install; auto-updates still work.

## Account sign-in

The "Sign in" button in the bottom bar is optional and intended for paid
features. It talks to `https://baseifier.bitdeathlabs.com` as described in
[docs/auth-api.md](docs/auth-api.md). Until that service exists the button
explains that the account service is not available yet; nothing else changes.

## Development

- `npm test` runs the geometry and UI helper tests (vitest).
- `npm run typecheck` checks the app; `npx tsc -p electron/tsconfig.json --noEmit` checks the shell.
- Architecture and the rules learned the hard way live in `CLAUDE.md`; research
  behind the printing decisions is in `docs/research/`.
- `http://localhost:5173/?autotest=1` runs a scripted performance pass in a
  real browser and writes a report to `perf-logs/`.
