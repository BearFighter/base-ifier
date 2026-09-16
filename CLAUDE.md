# Base-ifier

Browser tool that cuts large sculpted wargaming base STLs into smaller standard base
sizes (a recursive "cut tree"), adds magnet slots underneath, and exports STL.
Built for the One Page Rules "S - Bases" set in `S - Bases/STL` (not tracked by git;
1 GB of binaries) but works on any base whose file name encodes its size.

## Commands
- `npm run dev` — Vite dev server (http://localhost:5173). In dev the bundled OPR set is
  served from the project root and listed under "Bundled OPR bases" in the library panel.
- `npm test` — vitest (kernel + helpers, ~130 tests, includes real-file tests that skip
  when `S - Bases/STL` is missing).
- `npm run typecheck`, `npm run build`.

## Architecture (read `src/kernel/types.ts` first)
- `src/kernel/` — pure TypeScript geometry, no DOM. Units mm, Z up, triangle "soups"
  are flat Float32Arrays (9 floats per triangle, CCW outward). Never import ui/state/worker.
  - `source/prepareSource.ts` — welds the STL, finds the two shells every OPR base has
    (a tiny convex **body** plate: 28 tris for rects, 788 for ovals, z 0..2.984 with the
    top outline at 92.4% of the bottom; and the **sculpt** shell on top), normalises to
    nominal mm (OPR files are scaled 0.9947), trims the sculpt at plateTop-0.1, welds,
    bins it in 2mm XY cells. Falls back to a "generic" mode for single-shell files.
  - `pipeline/computePiece.ts` — a piece = clipped body outlines (2D convex clipping, bevel
    reproduced per new edge) + analytic watertight body (`body/buildBody.ts`: by default a
    HOLLOW underside, `body/hollow.ts`: a 2 mm void inside a 2 mm solid brim so only the brim
    is the seating surface, magnet locating rings hanging from the void ceiling instead of
    bored slots, and a raised 5x7-pixel-font watermark on the ceiling, mirrored to read from
    below, default text BITDEATHLABS, skipped when it would be under 0.22 mm pixels; or a
    solid plate with earcut magnet holes when `Project.underside.hollow` is off) + sculpt cut
    by a vertical convex prism
    (`sculpt/cutPrism.ts`). Outlines live in the SOURCE frame; output soups are in the
    piece's local frame (origin = footprint bbox centre). The sculpt is cut ONLY along the
    cutter's own edges (inset 0.1mm); edges inherited from the parent keep the parent's
    sculpt boundary. Cutting again along an inherited edge grazes the sculpt's vertical wall
    (which sits ~0.105mm inside the top outline) and explodes into thousands of slivers.
  - `pipeline/presupport.ts` — print-ready export: tilts a piece about its long footprint axis
    (auto 35° rounds / 45° rects / 55° large rects), lifts it 6 mm and generates closed
    support shells (flared foot on the plate, pillar, 0.5 mm tapered tip entering the
    underside 0.3 mm) on an edge ring plus a hex grid, never inside a magnet recess. Spacing
    comes from `densitySpacing(maxDim, 'light'|'medium'|'heavy')` (edge 1.5-6 mm, middle
    3-12 mm, wider for bigger bases); bracing 'light' (default) fuses the edge feet into a
    low rail and ties pillars over 8 mm with one ring of horizontal bars, 'full' is a lattice
    with diagonals. Each support is three closed shells: a vertical foot+pillar lathe, a joint
    sphere, and a cone+neck tip that runs along the underside's NORMAL (not vertical) so the
    contact is a small round dot; the neck keeps the cross-section at the surface equal to
    `tipDiameter`, and a 0.5 mm ball on the contact makes the support break at the neck and
    leave a sandable dome (docs/research/support-tips.md: 0.4 mm contact, 0.2 mm depth along
    the normal, remove supports green, i.e. after the wash and before curing). Adjacent shells must never share a ring: struts/rails start inside the
    pillars, the cone starts inside the pillar top, the sphere is 2% bigger and half a step out
    of phase (coincident float32 vertices weld into non-manifold edges; `isWatertight` catches it). `ExportSettings.presupport`
    (default ON) → `ExportItem.presupport` → the worker's `exportable()`; files get a
    `_supported` suffix. With a hollow underside the edge ring of contacts lands on the brim
    (the user accepted marks there) and the interior grid on the void ceiling, so those marks
    can never cross the seating plane. Based on docs/research/resin-printing-bases.md,
    support-patterns.md, support-tips.md and flat-underside.md.
  - `clip/` — the fragile part: `clipper.ts` clips triangles by planes with topology-keyed
    cut segments (no coordinate snapping), `loops.ts` chains them (parity cancellation of
    interior on-plane edges, corner-line closure for prisms), `cap.ts` triangulates caps,
    `earcutFull.ts` re-inserts points earcut drops so caps never leave T-junctions.
  - No CSG library: the sculpt shells are non-manifold, so anything requiring manifold
    input would reject them. Exported STLs contain two overlapping shells (body + sculpt),
    exactly like the originals; slicers union them.
- `src/worker/` — Comlink worker owning all heavy geometry (`kernel.worker.ts`); the API
  contract is `api.ts`. Function arguments to the worker must be top-level to be proxied.
  Sculpt meshes are sent without normals (flat shading) and only for the selected piece;
  meshes above ~600k triangles are sent as a vertex-clustered preview
  (`kernel/mesh/decimate.ts`), exports always use full detail. Never transfer a buffer that
  belongs to a cached result (it detaches it and the next reply hangs) — always slice.
- `src/model/` — project data model + preset catalog (`src/presets/bases.json`: 40k,
  The Old World, Kings of War, OPR sizes, KoW unit footprints, magnet sizes).
- `src/state/project.ts` — zustand + immer store (`src/state/types.ts` is the contract).
- `src/viewport/` — react-three-fiber viewport; publishes the top-down mm→px mapping in
  `mapping.ts` so `src/ui/cutter/*` can draw the cutter/magnet overlays as SVG.
- `src/ui/` — ONE tabbed left menu (`LeftTabs`: Scene / Bases / Magnets / Export) and the work
  area: `AddBar` (a compact dock: the Multibase / Diorama / Single base switch sits at the start
  of its first row, the frame row collapses to a summary once a frame exists; nothing is cut
  here), the view with `CutterOverlay` (`BaseOutlines` draws every item on the scene;
  drag/resize commit on release), and `ActionBar` (Top / 3D / Underside / Detail, the preview
  stepper, and the big wax-seal **Base-ify** button). Medieval-scroll look lives entirely in
  `src/ui/theme.css` (loaded last; parchment/ink/wax/brass variables, fonts from index.html). Mental model: the loaded file is the big base; in Multibase mode a *frame* (unit
  footprint, role 'frame', clips children to its footprint) holds *bases*; in Diorama/Single
  modes bases sit straight on the big base. NEVER deeper than frame → base (the store refuses).
  Geometry is only computed by `baseify()` (Diorama first turns leftover material into
  'leftover' bases), which then opens a preview (3D of each leaf, `previewStep`) and the Export
  tab. Edge profiles (`EdgeProfile`: GW slight bevel / flat / original) apply to every edge of
  a cut base and are chosen per game system automatically. Never say piece/frame/cutter in UI
  text except "frame" for the unit footprint. The UI's "usable" rectangles (`useBases.insetOf`)
  must match the kernel's usable outline PER AXIS (OPR tops are scaled per axis; USABLE_INSET
  0.3 mm on top), rounded inward, or bases placed at the front/back edge get clipped.
- PERFORMANCE RULE (found 2026-09-15 with the Edge CPU profile): never pass geometry, or any
  object holding typed arrays, as a React prop, in the r3f tree or the DOM tree. React's dev
  build deep-diffs every changed prop in its commit instrumentation and enumerates typed
  arrays element by element; a 300k-triangle mesh in a prop cost 1-2 s per selection change
  in Chromium and 5-10 s in Firefox (the whole "runs like dog ass" complaint). Components take
  an id and read meshes from the store with hooks (`Viewport.tsx` PieceMeshes/PieceOutlines/
  Cameras, `MagnetOverlay` takes the outline only) and hand geometry to three.js through refs.
  To measure: open `http://localhost:5173/?autotest=1` in a real browser (the embedded pane is
  hidden and cannot render); `src/dev/autotest.ts` runs the whole flow and POSTs a per-phase
  report (blocks, frame gaps, WebGL times, hot functions in Chromium) to `perf-logs/`.
- UX rules learned the hard way: no unexplained jargon in the default view, every setting has
  a help line, never use `window.confirm` (inert in the embedded browser; use the in-app
  dialog), worker calls are wrapped in `withTimeout` + `restartKernel`, controls must never
  overlap the view, and no staging concepts (frames-as-drafts, create steps) — the user wants a
  tool "for paste eaters".

## Desktop app, updates, accounts (2026-09-16)
- `electron/main.ts` (ESM, compiled to `dist-electron/` by `npm run electron:compile`) serves
  `dist/` over the privileged `app://base-ifier` scheme (module workers do not load from
  file://), opens external links in the system browser, turns downloads into Save As dialogs,
  and runs electron-updater against GitHub Releases (`build.publish` in package.json:
  owner `BearFighter`, repo `base-ifier`; tag `v<version>` = package.json version, CI in
  `.github/workflows/release.yml` builds Windows NSIS, macOS dmg+zip (x64+arm64, unsigned:
  `mac.identity: null`, cannot self-update so the mac app shows a release link) and Linux
  AppImage one platform after another into one GitHub Release with the `latest*.yml`
  manifests; Linux targets cannot be built from Windows, so CI is the only check). `--smoke`
  loads the app and exits 0 when it rendered (CI uses it). `electron/preload.cjs` exposes
  `window.baseifierDesktop` (version, checkForUpdates, installUpdate, openExternal, onUpdate).
- Renderer side: `src/app/config.ts` (Discord invite, GitHub repo, account URL, APP_VERSION
  injected by Vite), `src/app/desktop.ts` (bridge + browser fallbacks), `src/app/updates.ts`
  (desktop: IPC; browser: GitHub releases API), `src/app/auth.ts` (optional email/password
  sign-in against `https://baseifier.bitdeathlabs.com`, contract in `docs/auth-api.md`;
  nothing is gated on it), `src/ui/StatusLinks.tsx` (Discord logo, Sign in, version/update
  chip at the end of the ActionBar), `src/ui/auth/SignInDialog.tsx`.
- Vite: `base: './'` (needed for app://), `server.watch.ignored` keeps the dev server's
  file handles out of `release/` (electron-builder renames folders there; otherwise EPERM).
- Never commit `S - Bases/` (commercial OPR set), `release/`, `dist*/`, `perf-logs/`.

## Research notes
- `docs/research/resin-printing-bases.md` (2026-09-15): resin best practice for these bases and
  measurements of the OPR "Supported STL" files (tilted 45-77°, no raft, 6 mm standoff, feet
  not rafts, ~80% of support contacts near the footprint edge). Basis for any pre-supported
  export feature; recommended defaults are in its last section.
- `docs/research/flat-underside.md` (2026-09-16): how to get a residue-free seating face. No
  documented technique exists; flat-on-plate (the plain export) is the only truly flat option
  for small bases; recessed seating is sound but unproven. Led to the hollow underside + brim.
- `docs/research/support-tips.md` (2026-09-16): support interface points; the oblique contact
  of a vertical tip on a 45-55° underside (1.4-1.7x wider ellipse) explained the nubs the user
  had to sand; basis for the normal-aligned neck + ball tip.
- `docs/research/support-patterns.md` (2026-09-15): density, bracing and foot patterns. OPR's
  own files are dense (16-25 feet/cm²) and unbraced; the community only braces supports over
  ~10 mm; feet merge into shared pads at high density. The user found OPR-like density far
  too dense (though it printed flawlessly), hence the 'medium' default and light bracing.

## Conventions
- Piece `xy` is the cutter centre in the PARENT's local frame; `edges` order for rects is
  front (y-), right, back (y+), left. Rotation is expressed by swapping w/d (rotDeg 0).
- Export sizing: 'source' (× measuredScale, default), 'nominal', or 'clearance' (per-side
  inset). Magnet slots are always true size.
- Keep the kernel dependency-free apart from `earcut`. Tests must stay deterministic;
  real-file tests use `loadOprSoup` and skip when files are absent.
- Bash heredocs over ~8 KB get truncated in this environment; write big files with the
  Write tool and run patch scripts from a file.
