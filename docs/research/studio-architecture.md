# Base Studio: software structure (research + design, 2026-09-16)

The digest of the research that drives the implementation; library links are in
`asset-licences.md` beside it.

## Principles carried over from the cutter

- Pure-TypeScript kernel in a worker; triangle soups; no CSG (sculpt shells stay overlapping
  closed shells and slicers union them); the prism cutter cuts any soup.
- Never pass typed arrays through React props; meshes travel by id via the store and refs.
- One tabbed left menu, plain language, help on every setting, no staging concepts.

## Hand-off: a scene becomes a `Source`

`buildPreparedSourceFromMesh()` (`src/kernel/source/fromMesh.ts`) builds the two-shell
`PreparedSource` directly from a known body outline plus generated sculpt shells (terrain
slab + props), welds and bins them with the existing `weld`/`buildBins`. From then on
`computePiece`, `cutPrism`, `buildBody`/`hollow`, `presupport` and the whole Scene / Bases /
Magnets / Export flow run unchanged. A studio scene therefore inherits magnets, hollow
underside, watermark and supports for free.

## Terrain

A heightfield (`src/kernel/terrain/heightfield.ts`): simplex fbm noise, stamps (procedural
maps in `stamps.ts`: cobbles, bricks, plating, grating, cracks, craters, ripples, pebbles,
rock noise; CC0 displacement maps later), brushes (raise/lower/smooth/flatten), foot-zone
flattening, rim taper. `mesh.ts` turns it into a closed slab (top surface, skirts, fan cap)
standing at `plateTop - 0.1`; non-rectangular boards are clipped with the cutter's own
`cutPrism`. Cell size 0.2-0.5 mm by board size, so a 2 x 2 ft board stays in the 3 M
triangle class the app already handles.

## Props

Parametric, licence-free elements (`src/kernel/props/parametric.ts`: rubble, boulders,
crates, pipes, cables, rebar, planks, grating, deck plate, broken columns, crystals,
cobbles) built with the same closed-shell discipline as the supports (overlap, never touch).
Bundled CC0 assets arrive as slim geometry-only `.glb` files built by
`scripts/build-assets.mjs` (Poly Haven API, meshoptimizer decimation) and read by
`src/assets/glb.ts` in the worker. Scatter (`src/kernel/props/scatter.ts`) is Poisson-disc
sampling with rim inset, foot zones, keep-outs, area-scaled density, a hero prop on pieces
>= 40 mm, a height cap, and seeded reproducibility; `settle` drops props onto the ground.

## Data model and UI

`src/kernel/studio/document.ts` holds the document (board, ground recipe, props with licence
tags, rules, seeds); `src/kernel/studio/bake.ts` builds ground, scatters, places props and
produces the `PreparedSource`. The worker exposes `scatterStudio`, `previewStudio` and
`bakeStudio`; the app keeps documents under `Project.studio` and a Base Studio surface with
Board / Ground / Props / Rules panels and a single "Use this scene" action that registers the
source and returns to the cutter.

## Printability strategy

Status quo (overlapping closed shells, per-shell `isWatertight`) for the MVP. Later, opt-in
`manifold-3d` union for clean props and a narrow-band per-piece voxel remesh; never default.

## Later milestones

Asset browser over Poly Haven / ambientCG APIs with OPFS or Electron-fs caches; imports
(glTF/OBJ/FBX/STL/3MF) with ingest-time decimation and licence tags enforced only on the
commercial export; splines for roads/walls/streams; planned-cut ghost grid; Kings of War vs
Old World multibase modes; display boards; `cannon-es` settle; manifold union / remesh.
