# Resin printing best practice for pre-supported wargaming bases

Research for auto-generating print-ready (pre-supported) exports from Base-ifier: flat
sculpted bases, ~20mm–150x100mm, 3mm plate + sculpt on top, magnet recesses underneath.
Sources are general resin-printing community knowledge (blogs, forums, slicer docs) plus
direct geometric inspection of the OPR "Supported STL" files that ship with the S-Bases set.

## Summary

- Never print these bases flat against the plate. A large flat underside creates 5–15kg of
  FEP suction per layer, causing warp, elephant's foot, and lifted prints. Tilt.
- The OPR pre-supported files themselves confirm this: every file we inspected is tilted,
  never flat. Small/round bases sit at ~45°; the large 150×100mm rectangle sits at ~70°
  (steeper for bigger flat footprints).
- None of the inspected files use a printed raft. Supports land directly on the plate via
  small individual flared feet (~0.5mm thick, a few mm across) — not a shared raft slab.
- All inspected files raise the part 5–7mm (most commonly 6mm) off the plate before supports
  begin.
- Support contact is edge-biased: on the large rectangle, ~80% of support contacts land
  within 15% of the footprint edge, matching the "heavy on edges, light in the middle"
  community rule for flat undersides.
- Community numbers for support tips converge around 0.3–0.6mm (light/detail) up to
  ~0.8–1.2mm (heavy/structural); our measured OPR support diameters (~0.3–1.6mm, noisy) sit
  in that band.
- Elephant's-foot / hole-shrink compensation on resin printers is commonly 0.1–0.3mm
  undersize on holes; our current +0.1mm radial magnet tolerance is at the tight end of that
  range — workable but worth flagging to users as "print a test coupon first."
- Chitubox needs a manifold mesh only for its own hollow tool; for straight slicing,
  overlapping/non-manifold shells (our body+sculpt export, like the OPR originals) rasterize
  fine — this is exactly how the OPR files themselves are built and the user's test prints
  already confirm it works.
- Auto-orient in Lychee/Chitubox Pro is called out repeatedly as unreliable — it can pick
  extreme angles chasing a support-count minimum. A magnet-recess base is a good candidate for
  a fixed, deliberate default angle rather than auto-orient.
- Drain holes are for hollow prints; our bases are solid ~3mm plates, so no hollowing/drain
  holes are needed — but the magnet recess pockets are small local cavities that can trap air
  the same way, so their orientation still matters (see Q4).

## Findings per question

### 1. Orientation: flat vs raised vs tilted

Printing large flat objects directly on the plate is the most commonly cited resin-printing
mistake: the whole first-layer area acts as a single suction cup against the FEP each time it
peels, which lifts edges, warps the plate, and stresses the film
([Anycubic](https://store.anycubic.com/blogs/3d-printing-guides/resin-prints-warping-on-build-plate),
[Mr Resin](https://mrresin.es/en/blogs/mr-resin-3d-blog/how-to-orient-parts-in-resin-printer)).
The fix community sources converge on is tilting the part so each printed layer's
cross-section is smaller and the peel happens progressively along an edge rather than all at
once. Cited angles vary: "15–45°" for general suction reduction
([Anycubic](https://store.anycubic.com/blogs/3d-printing-guides/resin-prints-warping-on-build-plate)),
"30–45° off flat" specifically to cut FEP peel force
([ProtoResins](https://protoresins.com/blog/control-peel-forces-prevent-the-vacuum-effect-in-resin-3d-printing)),
but "manual 15–20° for minis is still superior to auto-orient, which can pick 70° chasing a
lower support count and guarantee delamination"
([TheIndustrialMaker](https://theindustrialmaker.com/software-digital-tools/slicer-software/three-chitubox-pro-auto-support-failures-and-how-to-fix-them)).
**This is a real disagreement** — there is no single agreed angle; the "right" answer is
framed as balancing suction area against print height/time. Raised-on-supports (flat
orientation, lifted 5–10mm, fully supported underneath) is a fallback for objects too
awkward to tilt, not the preferred method for a broad flat panel. Fully vertical wastes
height/time and cantilevers wide rectangular bases unsupported. Our own file inspection
settles the practical question for this geometry: OPR's pre-supported bases are tilted,
never flat, steeper as the footprint gets bigger (see Empirical section). In a tilted print
the magnet recess also becomes a diagonal cup rather than a horizontal trap — see Q4.

### 2. Elephant's foot / bottom chamfer / hole tolerance

Elephant's foot compensation values quoted are mostly FDM-flavored (~0.1–0.2mm inward
compensation on the first few layers,
[Creality](https://www.creality.com/blog/3d-printer-elephant-foot)), and a "0.2–0.5mm chamfer
around the base, or 0.5–5mm at 45°" is suggested as a process-agnostic design mitigation
([Qidi](https://qidi3d.com/blogs/news/fix-3d-print-elephant-foot)). Resin-specific guidance is
thinner; the clearest number found is that printed holes generally come out 0.1–0.3mm
undersize from curing overshoot and shrinkage, with SLA/DLP dimensional tolerance generally
quoted around ±0.1–0.15mm
([Creative3DP](https://tools.creative3dp.com/blog/press-fit-tolerances-3d-printing/)).
Magnet press-fit anecdotes vary a lot by printer calibration (one user's 4mm magnet fit at
+0.15mm oversize on the hole but fell out at +0.2mm) — the universal advice is "print a test
coupon, adjust ±0.05mm, reprint," not trust a single number blindly. Our current default
(`radialTol: 0.1mm` for resin, in `src/model/defaults.ts`) sits inside the commonly-cited
0.1–0.3mm band but at its tight edge — reasonable, but best framed to users as a starting
point, not a guarantee. Whether the slicer or Base-ifier should own a bottom chamfer is an
open design question, not a settled one: no source treats it as mandatory for resin the way
FDM treats elephant's foot; it's a nice-to-have, not table stakes.

### 3. Support geometry for flat undersides

Community numbers (mostly Lychee/Chitubox tutorial content):
- Tip diameter: Lychee's "Miniature Light" preset uses 0.3mm tips; general guidance ranges up
  through ~0.8–1.2mm for heavier/structural supports
  ([Lychee docs](https://sites.google.com/mango3d.io/lycheesliceredu/support-components),
  [Instructables](https://www.instructables.com/Best-Support-Settings-for-ResinSLADLPLCD-3D-Printi/)).
- Support base/foot: "12mm diameter, 1mm thick" cited as a default support-base pad size
  ([Instructables](https://www.instructables.com/Best-Support-Settings-for-ResinSLADLPLCD-3D-Printi/)).
- Spacing/density: "2.0–2.5mm for large prints, 1.5–2.0mm for detailed small prints"
  (same source).
- Raft: "2–3mm thick... but avoid oversized rafts, they add their own pull on the FEP"
  ([Siraya Tech](https://siraya.tech/blogs/news/resin-printing-warping)); several sources also
  suggest venting/perforating a raft to relieve suction
  ([ProtoResins](https://protoresins.com/blog/control-peel-forces-prevent-the-vacuum-effect-in-resin-3d-printing)).
- "Heavy on the edges, light in the middle" for flat undersides is explicitly named as the
  strategy to stop edge curl while minimizing visible support scarring in the middle
  ([Mr Resin](https://mrresin.es/en/blogs/mr-resin-3d-blog/supports-in-resin-3d-printing-definitive-guide)).
- Lift height: "5mm minimum for resin drainage," commonly 5–10mm depending on plate size and
  FEP thickness ([Phrozen](https://helpcenter.phrozen3d.com/hc/en-us/articles/6396019826841-3D-printing-parameters-for-support)).

We could not find a published, named "pre-supported base workflow" article with exact
numbers from a commercial base seller (Medusa Miniatures, The Printing Goes Ever On, Epic
Basing all sell pre-supported bases, but describe the *result*, not their recipe) — so the
OPR files are the best concrete reference we have, and broadly corroborate "no raft,
edge-weighted supports, standoff a few mm."

### 4. Hollow vs solid

Hollowing and drain holes are near-universally framed as a hollow-print problem: "a large,
completely flat hollow surface creates a massive suction vacuum... drain holes let air and
resin flow" ([3DModelPainting](https://3dmodelpainting.com/blog/hollow-stl-wall-thickness-resin)),
with typical hole size 2–3mm and two holes (one low, one high) per cavity. Our bases are
**solid** ~3mm plates with a shallow magnet recess, not hollow shells, so the classic
drain-hole requirement does not apply. The one analogous risk is the magnet pocket itself: a
flat-bottomed cylindrical recess printed facing straight down (or straight into the resin
surface) can behave like a tiny suction cup on each layer while it's being formed, and can
trap a meniscus of uncured resin at the bottom. No source addresses this exact case
directly, but it follows from the same suction-force logic as Q1/Q6; a tilt that keeps the
recess opening from facing squarely down should reduce (not eliminate) meniscus trapping
compared to a fully flat/horizontal recess.

### 5. Slicer mesh requirements

Chitubox needs a genuinely manifold mesh **only when its own hollow tool is used**; for plain
slicing, error-detection flags "excess shells" and "non-manifold holes" as *diagnostics*, not
hard failures. Multiple sources note Chitubox specifically struggles with **many coplanar
overlapping triangles landing at exactly the same position** (workaround: jitter positions
slightly), not with overlapping shells in general
([forum discussion referenced via search](https://forum.bambulab.com/t/non-manifold-edges/9709)).
Pre-supported STL workflows (Lychee, Chitubox) merge support geometry into the same mesh as
the model and slice it as one file — the standard distribution format for commercial
pre-supported bases. Our exports already ship as two overlapping shells (body + sculpt)
exactly like the un-modified OPR originals, and the user has already sliced and printed
those successfully, so this format is proven for this content; the risk to watch for when
adding generated supports is **exact coplanar overlap** between a support tip and a flat
body/sculpt face, rather than the
overlap between body and sculpt itself. UVtools is described as a post-slice validation step
(open the sliced file, run island/error detection) rather than a mesh-repair tool for the STL
stage — it catches problems the slicer already baked in, it doesn't change how forgiving the
slicer is of the input mesh
([UVtools wiki](https://github.com/sn4k3/UVtools/wiki/Recommended-workflow)).

### 6. Warping prevention for flat plates

Beyond orientation (Q1), sources converge on: ambient temperature control (20–25°C) affecting
cure consistency ([Anycubic](https://store.anycubic.com/blogs/3d-printing-guides/resin-prints-warping-on-build-plate)),
clean/level build plate, and not skimping on bottom-layer exposure/count so the first layers
are strong enough to carry the rest of the print without flexing
([3DPrinterly](https://3dprinterly.com/9-ways-how-to-fix-resin-3d-prints-warping-simple-fixes/)).
Post-cure warping of thin flat parts (a UV-cure oven softening/re-flowing a still-warm flat
piece) is anecdotally reported in general FDM/resin warping threads but we found no rigorous
resin-specific study quantifying it — treat this as a weak, unconfirmed area. Geometric
mitigations mentioned: ribs/gussets on the underside of large flat parts, and generally
"don't make large parts uniformly thin" — but no source gives a rib spec for a part this small
and already ~3mm thick, and our own inspection suggests OPR doesn't add ribs to these bases
either (their solid plate + tilt + edge supports is the whole strategy).

## Empirical findings from the OPR pre-supported files

Method: parsed each binary STL with the project's own `readStl` (`src/kernel/stl/read.ts`),
split it into connected shells with a vertex-welded union-find (1μm weld tolerance), then (a)
compared the largest shell's bounding box against the *plain* (unsupported) file for the same
base to get native size, and (b) computed an area-weighted triangle-normal histogram
restricted to the largest shell to find its dominant flat-face direction — that direction's
angle from the print +Z axis is the tilt angle, independent of any bbox math. Support/raft
figures come from the remaining (smaller) shells; because these fragment heavily under exact
vertex welding (likely leftover float precision from however OPR's supports were boolean-
merged), per-strut counts are overcounted — treat "shell count" as noisy, but diameter
averages and the edge/middle split (computed over thousands of samples) are directionally
reliable. Scripts are one-off and not checked into the repo.

### Orientation and standoff

| Base | Native flat size (mm, W×D×H) | Tilt of body/sculpt from vertical build axis | Standoff of part above plate | Largest shell (body+sculpt) as % of file |
|---|---|---|---|---|
| Round 25mm #1 | 24.9 × 24.9 × 4.7 | ~44.5–45.7° | 6.00mm | 55.3% |
| Round 75×46mm #1 (oval) | 68.6 × 42.1 × 5.4 | ~45.7° | 6.00mm | 60.8% |
| Square 20mm #1 | (not measured directly) | ~60.0° | 7.31mm | 56.7% |
| Square 60×40mm #1 | (not measured directly) | ~77.3° | 5.00mm | 72.2% |
| Square 150×100mm | 99.5 × 149.2 × 13.1 | ~69.8–70° | 6.00mm | 79.8% |

The pattern across all five files: **round/small bases tilt ~45°, square/rectangular and
larger bases tilt considerably steeper (~60–77°)**. This reads as auto-orient minimizing peel
cross-section per footprint shape/size rather than one fixed house angle — plausible since a
rectangular flat plate has a bigger worst-case contiguous flat area than a round one of
similar span, so it needs a steeper tilt to break that area up. No file in any size class was
printed flat or with a raft.

### Support structure (secondary confidence — see caveat above)

| Base | Support shells found | Tip Ø avg (mm) | Base Ø avg (mm) | Height avg (mm) | Contacts near edge |
|---|---|---|---|---|---|
| Round 25mm #1 | 678 (fragmented) | 1.09 | 1.58 | 2.5 | 43% |
| Round 75×46mm #1 | 3 (mostly fused into body) | 0.30 | 0.12 | 0.42 | 33% (n=3, not meaningful) |
| Square 150×100mm | 7,732 (heavily fragmented) | 0.91 | 1.21 | 4.35 | **80%** |

No file (any size) produced a wide, contiguous raft shell. Instead, every file's lowest
material is a scatter of small flared feet: ~0.5mm thick, a few mm to a few cm long,
sitting directly at z=0–0.5mm — i.e. **per-support pads, not a shared raft**.

## Recommendations for Base-ifier

1. **Default to a tilted export orientation, not flat.** This is both the community consensus
   and what OPR's own proven-to-print files do. Given the ambiguity in exact angle, pick a
   single conservative default rather than trying to replicate OPR's per-shape angle exactly:
   **30–40° tilt** for round/oval bases, **40–50° for square/rectangular bases**, increasing
   toward the steeper end (up to ~55°) for the largest rectangles (100×150mm class) where the
   flat plate area is largest. This is shallower than what we measured in the OPR files
   (45–77°) — deliberately so, since sources flag very steep auto-orient angles as a known
   failure mode, and a shallower tilt keeps print height/time down for a tool aimed at
   non-experts who won't manually tune supports.
2. **Do not add a raft.** Neither the community sources nor any OPR file we inspected use one
   for these bases; generate individual flared support feet directly on the plate instead.
3. **Support parameters to generate**: tip diameter ~0.4–0.6mm (between Lychee's "light" 0.3mm
   and the ~0.9–1.2mm we measured in OPR's heavier bases — err smaller since easier to clean up
   than to reprint), base/foot diameter ~1–1.5mm flared pad, spacing ~2–2.5mm under the
   underside, standoff/raise height **6mm** (matches all five OPR files closely), and bias
   support density toward the footprint edges (heavier there) with lighter/sparser coverage in
   the middle — this matches both the explicit community rule and our measured 80%-edge
   contact on the large rectangle.
4. **Magnet recess tolerance**: current `radialTol: 0.1mm` / `depthTol: 0.1mm` (in
   `src/model/defaults.ts`) is inside the commonly-cited 0.1–0.3mm resin hole-shrink range but
   at the tight edge. Leave the default as-is (it's already been validated by the user's own
   test prints), but surface it in the UI as an adjustable "if magnets are tight/loose, bump
   this by 0.05mm and reprint" control rather than a fixed hidden constant — matches the
   universal "test coupon" advice from every tolerance source found.
5. **Bottom chamfer**: not mandatory per the research (no resin source treats it as required
   the way FDM elephant's-foot chamfers are), but cheap to add and low-risk; if added, keep it
   small (0.3–0.5mm at ~45°) and only at the very bottom edge, separate from the existing
   `EdgeProfile` bevel which serves a different (cosmetic top-edge) purpose. Treat as a nice-to-have,
   not this research's top priority.
6. **No hollowing/drain holes** — the bases are solid plates and should stay that way; this
   isn't a case the hollow-print guidance applies to.
7. **Mesh format**: keep exporting body+sculpt as two overlapping shells, unchanged — this is
   exactly how the OPR originals ship and the user has already proven it slices and prints
   cleanly in their pipeline. When generating supports, take care that support tips don't land
   exactly coplanar with a flat body/sculpt face (jitter contact points a fraction of a degree
   or fraction of a mm off-axis if needed) — that's the one mesh-overlap failure mode Chitubox
   is actually reported to choke on.
8. **UI messaging**: tell users the export is pre-tilted and pre-supported for direct slicing
   (no manual support editing needed for a first try), that supports land on the plate with
   small feet (no raft — remind them to level/clean the plate well since there's no raft to
   buffer adhesion), and that if magnets are loose/tight after printing, the magnet tolerance
   setting is the first thing to adjust, with a reprint-a-test-plate suggestion rather than
   guessing a bigger change.
9. **Do not rely on the slicer's auto-orient/auto-support** for these exports — bake the tilt
   and supports into the STL geometry itself (as OPR does), since auto-orient is specifically
   called out as unreliable for flat objects by multiple sources, and the whole point of this
   feature is removing that judgment call from the user.
