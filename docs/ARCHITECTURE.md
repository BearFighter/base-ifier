# Base-ifier architecture

Browser tool that cuts large sculpted wargaming base STLs into smaller standard
base sizes, hollows and magnet-readies the underside, and exports plain or
tilted, pre-supported STLs. Built for the One Page Rules "S - Bases" set (not in
the repository) but works on any base whose file name encodes its size.

## Layout

- `src/kernel/` — pure TypeScript geometry, no DOM. Units mm, Z up, triangle
  "soups" are flat Float32Arrays (9 floats per triangle, CCW outward). Never
  imports ui/state/worker. Read `src/kernel/types.ts` first.
  - `source/prepareSource.ts` — welds the STL, finds the two shells every OPR
    base has (a small convex **body** plate with its top outline at 92.4% of the
    bottom, and the **sculpt** shell on top), normalises to nominal mm (OPR files
    are scaled 0.9947), trims the sculpt at the plate top, bins it in 2 mm XY
    cells. Falls back to a "generic" mode for single-shell files.
  - `pipeline/computePiece.ts` — a piece = clipped body outlines (2D convex
    clipping, bevel reproduced per new edge) + an analytic watertight body +
    the sculpt cut by a vertical convex prism (`sculpt/cutPrism.ts`). Outlines
    live in the source frame; output soups are in the piece's local frame. The
    sculpt is cut only along the cutter's own edges; edges inherited from the
    parent keep the parent's sculpt boundary (cutting again along an inherited
    edge grazes the sculpt's wall and explodes into slivers).
  - `pipeline/plug.ts` + `sculpt/height.ts` — single-shell files are treated as solid
    objects (no plate invented, and nothing is cut until Base-ify). A base cut from one is
    carved out of the object itself when the material is thick enough and flat underneath,
    with the hollow underside built into its floor; anything else gets a plate under the
    slice. A plug cut takes only the top few millimetres and the object keeps a socket
    (pocket) the plug drops back into; a plug needs solid material under its whole
    footprint, otherwise it becomes a full base on a plate and the object keeps a hole.
    In Diorama mode an object scene leaves ONE remainder piece — the object with a pocket
    per plug and a hole per full base — instead of rectangular leftovers. Where the object
    is hollow under the footprint (a shell), the plug is backed by a plate that reaches up
    to the material and the socket gets a 1.2 mm cup (floor slab plus walls) to sit in;
    a full cut over the same spot gets a plate tall enough to reach the floating material,
    with nothing lifted. Flat-sided (Kings of War) bases export print-ready without a tilt.
  - `body/buildBody.ts` + `body/hollow.ts` — by default a hollow underside: a
    2 mm void inside a 2 mm solid brim (only the brim is the seating surface),
    magnet locating rings hanging from the void ceiling, and a raised 5x7-pixel
    watermark on the ceiling, mirrored to read from below. Or a solid plate with
    bored magnet slots when hollowing is off.
  - `pipeline/presupport.ts` — print-ready export: tilts a piece about its long
    footprint axis (35° rounds, 45° rectangles, 55° large rectangles), lifts it
    6 mm and generates closed support shells: flared foot, vertical pillar,
    joint sphere, and a cone + neck tip that meets the underside along its
    normal with a 0.4 mm contact and a small ball. Density presets scale the
    edge ring and middle grid with base size; bracing fuses the edge feet into
    a rail and ties tall pillars together. Contacts land on the brim and on the
    void ceiling, never inside a magnet ring.
  - `clip/` — plane clipping with topology-keyed cut segments, loop chaining,
    capping; `earcutFull.ts` re-inserts points earcut drops so caps never leave
    T-junctions. No CSG library: the sculpt shells are non-manifold. Exported
    STLs contain overlapping shells (body, sculpt, supports); slicers union them.
- `src/worker/` — Comlink worker owning all heavy geometry; `api.ts` is the
  contract. Function arguments to the worker must be top-level to be proxied.
  Sculpt meshes are sent without normals and only for the selected piece;
  meshes above ~600k triangles are sent as a decimated preview. Never transfer a
  buffer that belongs to a cached result; always slice.
- `src/model/` — project data model and the preset catalogue
  (`src/presets/bases.json`: 40k, The Old World, Kings of War, OPR sizes, KoW
  unit footprints, magnet sizes).
- `src/state/project.ts` — zustand + immer store (`src/state/types.ts` is the
  contract). Geometry is only computed by `baseify()`.
- `src/viewport/` — react-three-fiber viewport; publishes the top-down mm→px
  mapping so the cutter and magnet overlays can be drawn as SVG.
- `src/ui/` — one tabbed left menu (Scene / Bases / Magnets / Export), the dock
  with the Multibase / Diorama / Single base / Movement tray switch, the view
  with its overlays, and the action bar with the Base-ify button. Mental model:
  the loaded file is the scene; in Multibase and Movement tray modes a *frame*
  (unit footprint) holds *bases*; in the other modes bases sit straight on the
  scene. Never deeper than frame → base (`src/model/rules.ts` holds the rule).
  Movement tray mode adds one derived tray per frame at Base-ify: a thin floor
  with a raised surround and an opening for every base, generated by
  `src/kernel/tray/` and hung off the scene so its rim can reach past the frame.
- `src/app/` — desktop bridge, update checks (GitHub Releases), optional account
  sign-in (`docs/auth-api.md`). `electron/` — the desktop shell.

## Rules learned the hard way

- Never pass geometry (anything holding typed arrays) as a React prop. React's
  development build deep-diffs changed props and walks typed arrays element by
  element; a 300k-triangle mesh in a prop cost seconds per selection change.
  Components take an id and read meshes from the store with hooks.
- Adjacent generated shells must never share exact vertices: struts and rails
  start inside the pillars they join, the tip cone starts inside the pillar
  top, spheres are slightly larger and out of phase. Coincident float32
  vertices weld into non-manifold edges; `isWatertight` catches it.
- The UI's "usable" rectangles must match the kernel's usable outline per axis
  (OPR tops are scaled per axis) or bases at the front/back edge get clipped.
- Worker calls are wrapped in a timeout with a kernel restart; `window.confirm`
  is never used (an in-app dialog is); controls never overlap the view.

## Conventions

- Piece `xy` is the cutter centre in the parent's local frame; rectangle edge
  order is front, right, back, left. Rotation is expressed by swapping w/d.
- Export sizing: 'source' (× measured scale, default), 'nominal', or
  'clearance' (per-side inset). Magnet slots and rings are always true size.
- Keep the kernel dependency-free apart from `earcut`. Tests must stay
  deterministic; real-file tests skip when the OPR set is absent.

## Research

`docs/research/` holds the notes behind the printing decisions: orientation
and standoff, support density and bracing, contact tips, and residue-free
seating faces.
