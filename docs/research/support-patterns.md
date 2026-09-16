# Resin support patterns: density, bracing, feet

Research for fixing `src/kernel/pipeline/presupport.ts`, which the user printed and found
**far too dense with no cross-bracing** (current scheme: 1.2mm pillars, 0.5mm tips, 3mm
flared feet, edge contacts every 1.5mm + a 3mm hex grid in the middle -> ~100 supports on a
25mm base, ~1,700 on a 150x100mm base, all independent). This is a follow-up to
`docs/research/resin-printing-bases.md` (orientation/standoff/elephant's-foot); this note
covers density, bracing, and foot patterns specifically, with fresh direct measurement of the
OPR "Supported STL" files (`S - Bases/Supported STL/`). No source code was changed.

## Summary

- **Raw support count is not obviously the problem** — the OPR references themselves are
  comparably dense (24.5/cm² on a 25mm round, 16.5/cm² on the 150x100mm plate; our generator
  is ~14/cm² flat everywhere). The likely real complaint is **uniform density**: our 3mm grid
  never relaxes toward the middle of large plates the way OPR's spacing and every community
  source's "heavy edge, light middle" rule do.
- **No source, and no OPR file, uses cross-bracing on bases this short.** Every rod-like,
  plate-grounded member found across all three measured OPR files was within a few degrees of
  vertical (medians 0-4°); nothing resembling a diagonal strut pattern was found. Bracing is a
  slicer feature (Lychee "Bracing", Chitubox "Triangular/Global Reinforcement") aimed at
  **10mm+ tall** supports; ours are mostly 3-7mm, i.e. below where most guidance says bracing
  matters — but the user's own print says otherwise, so we should still add a light version.
- Community numbers for tip diameter (0.3-0.6mm) and spacing (1.5-2.5mm) are already close to
  what we use; the divergence is upstream of pillar size, in the middle-vs-edge density curve.
- **Feet are not individual in practice.** Both community advice ("bridge supports together
  instead of placing them individually," AmeraLabs) and our own file measurements show heavy
  *emergent* merging of neighboring feet at high density (merged-pad area up to 100-1,400x a
  single foot's area) — not a deliberate raft, but not isolated pads either.
- PrusaSlicer SLA specifically documents pillar-to-pillar interconnection ("stability improved
  by interconnecting pillars... not only those connected to the platform") as a stability
  feature independent of any single-pillar diameter setting.
- Tree/branching supports are a poor fit here: every source recommends grid/individual
  supports (not trees) specifically for **flat undersides** — trees are for sculptural
  overhangs. This matches OPR's own approach: straight, uniform-diameter pillars, no branching.
- Pillar diameter did **not** show a clear scaling trend with height in our own measurements
  (per-file correlation -0.85 to +0.30, small samples) — several community sources claim
  height-scaling (PrusaSlicer growing pillar diameter with unsupported height; one blog's
  "height/30mm" formula) but it isn't consistent enough across sources or our data to treat as
  settled; a fixed diameter with a floor is defensible.

## Findings per question

### 1. Density

Lychee and Chitubox both ship **Light/Medium/Heavy presets** rather than a single number
([Lychee support components](https://sites.google.com/mango3d.io/lycheesliceredu/support-components),
[Chitubox parameters](https://docs.chitubox.com/en-US/chitubox-basic/latest/ui-and-features/configure-support-parameters)).
Concrete spacing numbers found: **2.0-2.5mm for large prints, 1.5-2.0mm for detailed small
prints** ([Instructables](https://www.instructables.com/Best-Support-Settings-for-ResinSLADLPLCD-3D-Printi/),
via our earlier research), and a size-scaled formula from one guide, **spacing ≈ model
height/50mm**, giving 1.5-2.0mm for heavy/large and 2.5-3.0mm for light/small
([Dreaming3D](https://dreaming3d.net/blogs/news/ultimate-resin-support-settings-guide-stop-failed-prints-2026)).
Tip diameter: **0.3mm** (Lychee "Miniature Light"; Chitubox fine-detail) up to **0.5-0.8mm**
for structural supports
([Chitubox academy](https://www.chitubox.com/en/academy/tutorials/chitubox-basic/manual/best-support-settings-for-resin-3d-printingsladlplcd),
[AmeraLabs](https://ameralabs.com/blog/6-tips-3d-printing-supports/)); one troubleshooting
guide recommends **1.3-1.6mm pillar columns** specifically to cut breakage
([Dreaming3D](https://dreaming3d.net/blogs/news/ultimate-resin-support-settings-guide-stop-failed-prints-2026)).
None of the sources give supports-per-cm² directly (we derived that ourselves — see Empirical
below); the one quantitative area-based rule found, from SFF patent literature, is that
**total support cross-section should be ~1-2% of the largest part cross-section**, a
sanity-check ratio rather than a spacing rule. Every source agrees density should fall off
away from the edge; none quantify the falloff curve precisely.

### 2. Cross bracing

Lychee's "Bracing" links two nearby support tips with a horizontal mid-section
([support components doc](https://sites.google.com/mango3d.io/lycheesliceredu/support-components));
its trigger and geometry are configurable — **max distance between two supports to braced
together** and **max bracing diameter** are both user-set fields with no fixed default exposed
in the docs ([configuration/algorithms](https://docs.mango3d.io/doc/resin-documentation/resin-preferences/configuration-algorithms/)).
Lychee ships **four size/height-scaled bracing presets** — Small Object, Tall Objects, Strong,
and Default — confirming bracing aggressiveness is meant to scale with support height, not be
constant ([bracing presets doc](https://doc.mango3d.io/doc/technical-documentation/genral-questions/support-bracing-default-presets/)).
Chitubox Pro's **Triangular Reinforcement (TR)** links 3 nearby columns into a triangle;
**Global Reinforcement (GR)** extends that into a mesh of triangles across all adjacent
columns, both applied automatically to "isolated" columns during auto-support
([Chitubox support configuration](https://docs.chitubox.com/en-US/chitubox-pro/latest/support/support-configuration)).
PrusaSlicer SLA documents pillar interconnection as a general stability feature — "smarter
interconnecting of support pillars... pillars now interconnected everywhere, not only those
connected directly to the build platform" — plus adding 1-2 extra pillars to reinforce single
tall self-standing ones ([PrusaSlicer SLA slicing](https://help.prusa3d.com/product/prusaslicer/sla-slicing_214)).
No source gives an exact height threshold in mm; the Lychee preset split (Small/Tall/Strong)
implies it scales with support height rather than firing at one fixed number. A resin
troubleshooting guide frames the payoff directly: interconnected supports "give greater
stability and drastically reduce the risk of failure," specifically calling out shifting and
snapping as the failure modes bracing addresses.

### 3. Bottom/foot patterns

No source treats a full raft as standard for pre-supported bases — same conclusion as our
earlier research. AmeraLabs explicitly recommends **against** placing supports independently:
"bridge supports together instead of placing them individually" for "a stiffer set of base and
secondary supports that are less prone to breakage"
([AmeraLabs](https://ameralabs.com/blog/6-tips-3d-printing-supports/)). Our own file inspection
(below) shows this happening *organically* in the OPR files at high density: most feet are
small individual pads (~0.2-0.5mm² footprint) but a minority fuse into much larger shared pad
clusters (up to ~285mm² on the big plate) simply because neighboring pads are close enough to
touch — not a deliberately modeled rail, but functionally similar to one. We could not find a
named recipe from a commercial pre-supported wargaming vendor (Loot Studios, Artisan Guild,
Medusa Miniatures, TPGEO all sell pre-supported bases but publish results, not their generator
settings) — OPR's own files remain the best concrete reference for this content.

### 4. Tree/branching supports

Every source that distinguishes tree vs. grid supports puts **grid/individual for flat
undersides, tree for sculptural overhangs** — e.g. "use grid supports for flat undersides,
large horizontal shelves... tree supports work well for sculptural models... geometry where
normal supports would waste material" ([Wevolver](https://www.wevolver.com/article/3d-print-supports-a-guide-for-engineers),
[Siraya Tech](https://siraya.tech/blogs/news/3d-printing-types-of-supports)). Nothing
recommends trees as the default for a flat plate underside, and no OPR file shows branching
(every plate-grounded member we measured runs straight from foot to tip). Tree supports are
not a fit for this geometry; skip them.

## Empirical: OPR "Supported STL" files

**Method.** Wrote a one-off Python/numpy+scipy script (not checked into the repo) that: reads
each binary STL directly; finds the body/sculpt shell via vertex-welded (0.02mm) connected
components (coarser than the earlier 1μm pass, which over-fragmented supports into thousands
of shells from float seams); clusters the triangles whose min-z sits at the build plate
(z<0.08mm) **by XY position on a rasterized grid** (not by mesh shell) to count distinct feet,
per the task brief; and, for support shells that are grounded at the plate and reach close to
the known standoff height (standoff values reused from the prior research's direct
measurement of these same files, since at this foot density enough neighboring feet weld into
the body shell that neither a shell-min-z nor a normal-histogram re-derivation of standoff
stays uncontaminated), estimates each member's axis via **top-slice-vs-bottom-slice centroid
drift** rather than raw PCA — PCA's largest-eigenvalue axis is unreliable for a tapered/flared
profile (every pillar has one) because a symmetric flare's widest spread is often lateral, not
along its true (vertical) axis; centroid drift cancels a symmetric taper while still catching
a real tilt or a weld-merge artifact. Shells not grounded at the plate were excluded as likely
detached decorative sculpt islands (loose rope/rubble bits common on OPR bases), not supports.

**Coverage caveat**: only a small fraction of feet per file (6-20) survive as a single cleanly
welded foot-to-tip shell; most fragment into 2+ pieces even at 0.02mm, consistent with the
prior research's fragmentation warning. Treat height/diameter/angle numbers as directional; the
**feet count and density are exact** (grid-clustered by position, immune to fragmentation).

| Base | Distinct feet (plate contacts) | Feet / cm² (nominal footprint) | Grounded rod-members analyzed | Height median (mm) | Diameter median (mm) | Angle-from-vertical median | >15° (bracing-like) |
|---|---|---|---|---|---|---|---|
| Round 25mm #1 | 153 | 24.5 | 6 | 6.46 | 0.96 | 3.8° | 2/6 (33%, n small) |
| Square 60x40mm #1 | 208 | 8.7 | 10 | 1.15 (bimodal, p90 5.3) | 2.24 | 0.0° | 2/10 (20%) |
| Square 150x100mm #1 | 2,480 | 16.5 | 16 | 5.28 | 0.96 | 3.6° | 2/16 (12.5%) |

No file showed a consistent diagonal-member pattern (which real bracing would produce as many
members at similar, complementary angles); the small counts of >15° outliers look like
individual placement noise or residual weld-merge artifacts, not deliberate struts. Foot
contact area: median ~0.2-0.36mm² (individual pads, ~0.5-0.7mm effective diameter measured
from vertex clustering, which undercounts a filled disc somewhat), but **max/median ratio of
18x-1,429x** across the three files confirms a real minority of feet fuse into much larger
shared pads at high local density — most pronounced on the big plate.

## Recommended generator parameters

1. **Split middle-vs-edge density more aggressively by plate size**, instead of one constant
   3mm grid. Edge ring: 1.5mm (≤40mm bases), 2.0mm (40-100mm), 2.5mm (100mm+) — inside the
   community 1.5-2.5mm band. Middle grid: keep ~3mm for small bases but relax to 4-4.5mm
   (40-100mm) and 5-6mm (100mm+) — this is the main lever for cutting the 150x100mm plate's
   count, since OPR's own middle coverage is visibly sparser than its edge (matches the
   "heavy edge, light middle" rule cited by every source and our own count: 16.5/cm² overall
   on the big plate vs. 24.5/cm² on the small round, i.e. OPR itself relaxes density as plates
   grow).
2. **Thicken pillars modestly, don't just thin them**: raise `pillarDiameter` default from
   1.2mm toward 1.3-1.5mm (matches the "1.3-1.6mm cuts breakage" guidance and sits close to our
   measured OPR pillar diameters, 0.96-2.24mm median across files). Keep `tipDiameter` at
   0.5mm (already in the 0.3-0.6mm community band and close to measured OPR values).
3. **Add light bracing, scaled to our short supports** (~3-7mm typical, per the empirical
   table — well under the 10mm+ height most slicer bracing targets, so go light):
   - Fuse the **edge-ring feet into a shared low rail/fillet** (widen and merge adjacent
     `footDiameter` pads along the edge ring into one continuous strip a few tenths of a mm
     tall) instead of isolated 3mm round pads. This both matches the emergent "shared/merged
     pad" pattern measured in every OPR file and is the single most direct way to add bracing,
     since a continuous foot rail ties every edge pillar together at its weakest point (the
     plate joint) for free.
   - For pillars taller than ~8mm (the large/steep-tilt bases), add **one horizontal
     connecting strut (~0.6-0.8mm diameter) between adjacent same-ring neighbors at
     ~50% height** — a single ring of bracing, not a full lattice, matching Lychee's own
     "Small Object" vs "Tall Object" preset split rather than a one-size scheme.
   - Skip diagonal X-struts and skip bracing in the sparse interior grid entirely; nothing in
     the community guidance or the OPR files suggests it's needed there, and it would add
     clutter for no measured benefit.
4. **Keep individual round feet in the interior grid** (current `footDiameter: 3` is
   reasonable there) but **do not scale foot diameter down for the edge ring** once it becomes
   a rail per (3) — the rail's footprint naturally replaces per-pillar foot sizing.
5. **Do not add tree/branching supports** — every source and the OPR files themselves use
   straight grid/individual supports for this exact geometry (flat tilted underside).
6. **Leave pillar diameter height-scaling as-is** (`Math.max(pillarDiameter/2, 0.006*height)`);
   our measured data doesn't show a strong live scaling trend, and at the height range these
   bases actually print at (3-13mm) that formula is already dominated by the floor, so it's a
   no-op worth keeping simple rather than tuning against noisy small-sample data.

Sources: [Lychee support components](https://sites.google.com/mango3d.io/lycheesliceredu/support-components) ·
[Lychee preferences](https://sites.google.com/mango3d.io/lycheesliceredu/preferences) ·
[Lychee bracing presets](https://doc.mango3d.io/doc/technical-documentation/genral-questions/support-bracing-default-presets/) ·
[Lychee algorithm config](https://docs.mango3d.io/doc/resin-documentation/resin-preferences/configuration-algorithms/) ·
[Chitubox support parameters](https://docs.chitubox.com/en-US/chitubox-basic/latest/ui-and-features/configure-support-parameters) ·
[Chitubox Pro reinforcement](https://docs.chitubox.com/en-US/chitubox-pro/latest/support/support-configuration) ·
[Chitubox academy support settings](https://www.chitubox.com/en/academy/tutorials/chitubox-basic/manual/best-support-settings-for-resin-3d-printingsladlplcd) ·
[PrusaSlicer SLA slicing](https://help.prusa3d.com/product/prusaslicer/sla-slicing_214) ·
[AmeraLabs 6 tips](https://ameralabs.com/blog/6-tips-3d-printing-supports/) ·
[Dreaming3D support settings guide](https://dreaming3d.net/blogs/news/ultimate-resin-support-settings-guide-stop-failed-prints-2026) ·
[Instructables best support settings](https://www.instructables.com/Best-Support-Settings-for-ResinSLADLPLCD-3D-Printi/) ·
[Wevolver 3D print supports guide](https://www.wevolver.com/article/3d-print-supports-a-guide-for-engineers) ·
[Siraya Tech types of supports](https://siraya.tech/blogs/news/3d-printing-types-of-supports).
