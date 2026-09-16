# Getting a residue-free seating face

Research for whether Base-ifier's tilted-and-supported export can leave the underside
(magnet-recess face) untouched, instead of merely making the support nub smaller.
`presupport.ts` today always tilts and always touches the underside; this asks whether
that premise should change. No code changed.

## 1. Flat directly on the build plate, underside down, no supports

**Elephant's foot.** Universally attributed to the plate squeezing resin out from under the
first layers before cure ([mind.dump()](https://blog.honzamrazek.cz/2022/02/a-step-by-step-guide-for-the-perfect-bed-adhesion-and-removing-elephant-foot-on-a-resin-3d-printer/)).
Fix is a slicer setting, not geometry: Chitubox/Lychee "Bottom Tolerance Compensation"
shrinks the exposed area on bottom layers; values found range from **-0.02mm** ("works on
most parts") to **-0.3mm**, with one Lychee-Pro user needing **-0.5mm** specifically when
printing straight on the plate ([Liqcreate](https://www.liqcreate.com/supportarticles/chitubox-shrinkage-compensation-resin/),
[3DPrinterly](https://3dprinterly.com/6-ways-how-to-resin-print-flat-surfaces-and-directly-on-the-build-plate/)).
Lychee's own "Printing on the Plate" doc frames flat-on-plate as low-risk and "perfectly
flat," but lists the same defect plus a compensating "Wait Before Print" (7-12s) and
per-layer pixel erosion as the mitigations — settings, again, not model geometry
([Lychee docs](https://doc.mango3d.io/doc/j3d-tech-s-guide-to-resin-printing/print-settings/printing-on-the-plate/)).
A shallow **0.3-0.5mm, ~45°** bottom chamfer is the only geometric mitigation any source
names, and it's framed as a nice-to-have alongside compensation, not a substitute for it
([Qidi](https://qidi3d.com/blogs/news/fix-3d-print-elephant-foot)) — matches
`resin-printing-bases.md`'s existing recommendation.

**Magnet recess facing the plate.** No source addresses this exact case, but the closest
analogue — a sealed cavity re-entering the vat — is described as capable of trapping resin
under real hydraulic pressure against the plate ("blows out the weakest point") on hollow
prints ([Raise3D](https://www.raise3d.com/blog/resin-3d-printing-failures-troubleshooting/)).
A magnet recess isn't sealed the way a hollow interior is, but flush against the plate its
mouth is nearly closed for several layers — an untested but plausible extrapolation, not a
confirmed failure mode.

**Does it actually work, at what size?** This is the weakest-evidence, most contested part
of the research. A practitioner thread on wargaming bases splits three ways: one user prints
bases flat and calls it his best method, but notes "the edges can sometimes curve a bit as
it shrinks"; another found a near-vertical orientation had *zero* warping with sharper edges
than flat; a third tilts at 45° with heavy supports and a raft and fits only 5 bases per
plate ([The 9th Age forum](https://community.the-ninth-age.com/thread/68875-printing-bases/)).
No source gives a size cutoff in mm where flat-on-plate stops being reliable — every general
warping article frames it as "bigger flat area = more peel force," not a threshold
([Siraya Tech](https://siraya.tech/blogs/news/resin-printing-warping), [Anycubic](https://store.anycubic.com/blogs/3d-printing-guides/resin-prints-warping-on-build-plate)).
The "bases are printed flat by most people" folk claim is **not** well supported — it's one
opinion among several in the one concrete thread found, and it fights the "never print flat"
consensus in `resin-printing-bases.md`'s broader sources. The sculpts having few undercuts
does mean the top mostly doesn't need supports either way, so flat-on-plate's upside (zero
supports anywhere) is real when it works.

## 2. Tilt kept, contacts moved to the side wall / bevel only

No source documents this as a named technique for a part whose underside must stay flat and
functional; general SLA orientation guidance (Formlabs, Anycubic) says tilt 10-45° so
supports land somewhere other than the "showcase" face, but stops at "pick a good face," not
at routing contacts specifically onto a side wall a few mm tall
([Formlabs](https://formlabs.com/support/Model-Orientation), [Anycubic](https://store.anycubic.com/blogs/3d-printing-guides/resin-prints-warping-on-build-plate)).
Reasoning it through geometrically: our own measured OPR files put ~80% of contacts within
15% of the footprint edge on the large plate (`resin-printing-bases.md`), but those contacts
are still *on the underside*, not on a side wall — because a 3mm bevel band gives very
little usable contact area, and it does nothing for the interior of a 100mm+ span, which
still needs support from underneath or it sags/deflects mid-print. Side-wall-only contact is
plausible as a **supplement** near the edge ring (where the current edge-biased layout
already concentrates contacts) but not as a full replacement — no source or measurement
here backs "3mm of wall is enough" as a load-bearing claim for a full tilted plate.

## 3. Recessed seating: rim + interior recess

**Not a named pattern.** Searches for "support pocket," "recessed support," and similar
turned up nothing in slicer docs or commercial base makers — this appears to be original
reasoning, not established practice, and should be prototyped and pull-tested before
shipping. The one adjacent, sourced idea is Lychee's own suggestion to add a raft with
raised edges that becomes "a sanding guide, so you sand the print evenly and don't over
sand" ([Lychee "Printing on the Plate"](https://doc.mango3d.io/doc/j3d-tech-s-guide-to-resin-printing/print-settings/printing-on-the-plate/))
— the same idea in reverse (a controlled reference plane), suggesting the concept isn't
alien to the tooling even though nobody names it for bases. If contacts (ball included, up
to `contactBall` 0.5mm plus `penetration` 0.2-0.3mm ≈ 0.6-0.8mm of protrusion today) stay
strictly inside a recess deeper than that protrusion, residue geometrically cannot cross the
rim plane, regardless of sanding. The rim itself still needs its own support, from its outer
edge/bevel (candidate 2's mechanism, at a much smaller uncontested scale — a 1.5-2mm rim
rather than the whole face).

## 4. Sacrificial layer / breakaway base

Real and documented (Lychee "Split-Rafts," min **1.0mm** raft thickness; 3DPrinterly's
"raft ~93% of model size" example) but this fails the "paste eater" bar on inspection: flush
cutters get "very close" to the surface but a witness mark remains, and every finishing guide
still recommends **400-800 grit progressive sanding** afterward to get it flat and smooth
([EngineerFix](https://engineerfix.com/the-best-flush-cutters-for-3d-printing/),
[Dreaming3D](https://dreaming3d.net/blogs/news/the-best-electric-sanders-for-resin-3d-printing-amp-how-to-actually-use-them),
[Lychee split-rafts](https://doc.mango3d.io/doc/j3d-tech-s-guide-to-resin-printing/troubleshooting-print-failures/split-rafts/)).
It converts "sand N small nubs" into "sand one whole face" — not obviously less
manual work, and worse for a bevelled GW-style edge where a full-face sanding pass risks
rounding the crisp bevel. Deprioritize.

## 5. Other tricks (float supports, elevated skirt)

No independent technique found beyond what candidates 1 and 4 already cover — "float
supports" as a distinct named Lychee/Chitubox feature does not appear in their docs; the
closest real features are the raft-with-feet pattern (candidate 4) and printing flat with
compensation (candidate 1). Not pursued separately.

## Recommendation for Base-ifier

**Ranking:** (1) recessed seating — best fit for the actual requirement, but unproven,
needs prototype prints before it's a default; (2) side-wall/bevel contact as a
*supplement* to (1) for the rim only, not a standalone scheme; (3) flat-on-plate — real
folk practice, but contested evidence and an unverified magnet-recess risk, so treat as an
opt-in for the smallest, non-magnetised bases rather than a default; (4) sacrificial
raft — deprioritized, doesn't reduce manual work; (5) float supports — not a real distinct
option, skip.

**Per size band**, keep today's tilt angles (`autoTiltDeg`) and edge-biased layout, and
change where contacts land:

- **≤40mm**: recess depth 0.3mm, rim width 1.5mm (the minimum that stays printable and
  dimensionally stable at this scale); all contacts inside the recess; flat-on-plate remains
  an experimental opt-in only for bases without magnets, given the unresolved recess-facing-
  plate risk.
- **40-100mm**: recess depth 0.4mm, rim width 1.75-2mm; contacts inside the recess plus
  side-wall/bevel assist for the outermost ring only, since the interior span is large
  enough that recess-only contact under it is untested at this size.
- **>100mm**: recess depth 0.5mm, rim width 2mm; heavier reliance on the side-wall/bevel
  ring (candidate 2) because sources agree flat/near-flat orientation is least reliable at
  this footprint (`resin-printing-bases.md`'s own 150×100mm file measured a 70° tilt) — stay
  tilted and supported, don't attempt flat-on-plate here at all.

**Geometry to add**: a recess depth greater than `contactBall/2 + penetration` (today
≈0.55-0.65mm; round up per band above) cut into the underside inside the rim; support layout
restricted to points at least `rimWidth` inside the footprint edge; an optional second
contact family on the beveled rim edge itself, only where the bevel's vertical extent is
≥1.5mm continuous (below that, fall back to recess-interior contacts only, since a bevel
that short doesn't offer enough wall to land on). None of these numbers are sourced from a
named technique — they follow from the existing tip/penetration research and should be
validated with a physical print before becoming a default, exactly as the magnet-tolerance
"print a test coupon" pattern in `resin-printing-bases.md` already recommends for this
project.
