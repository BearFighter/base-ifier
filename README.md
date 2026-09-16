# Base-ifier

Cut one big sculpted wargaming base into the base sizes you actually need
(Kings of War, The Old World, 40k, OPR), add magnet slots, and export STLs that
are ready for a resin printer: hollow underside with a brim, magnet locating
rings, and an optional tilted, pre-supported print-ready version.

Community and support: [Discord](https://discord.gg/7mhYNtdmQV).

## Run it

**Installed app:** download from the
[Releases](https://github.com/BearFighter/base-ifier/releases) page:

- Windows: `Base-ifier-Setup-<version>.exe` (installer). Updates itself: the app
  checks GitHub when it starts and shows "Restart to update" in the bottom bar.
- Linux: `Base-ifier-<version>-x64.AppImage` (`chmod +x`, then run). Updates itself
  the same way.
- macOS: `Base-ifier-<version>-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel).
  The build is not signed yet, so the first launch needs right-click → Open (or
  `xattr -cr /Applications/Base-ifier.app`), and it cannot update itself: it
  shows "Version x is out" in the bottom bar linking to the release instead.

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

builds the installer for the OS you are on into `release/` (Windows: NSIS
`.exe`; macOS: `.dmg` + `.zip` for x64 and arm64; Linux: `.AppImage`).
`npm run electron:smoke` builds and launches the packaged renderer once to
check it renders, then exits.

## Publish a release (and push an update to every installed copy)

1. Bump `version` in `package.json` (e.g. `0.1.1`).
2. Commit, tag and push: `git tag v0.1.1 && git push --tags`.
3. The `Release` GitHub Actions workflow builds on Windows, macOS and Linux
   runners (one after another) and attaches every installer, plus the
   `latest*.yml` update manifests, to one GitHub Release for that tag.
4. Windows and Linux apps pick the new version up automatically on their next
   start (electron-updater reads the manifests from the latest GitHub Release);
   the mac build and the web build show a "Version x is out" chip that links to
   the release.

Releases must be public and tagged `v<version>`; the version in the tag and in
`package.json` must match. Installers are unsigned for now: Windows SmartScreen
warns on first install (auto-updates still work) and macOS needs the
right-click → Open dance and cannot self-update until the app is signed and
notarised with an Apple Developer ID.

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
