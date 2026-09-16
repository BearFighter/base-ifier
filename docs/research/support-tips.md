# Support tip geometry: removal-friendly contact points

Follow-up to `resin-printing-bases.md` and `support-patterns.md`. The user's current tip
(vertical cone, 1.4mm pillar -> 0.5mm dia over 1.5mm, penetrating 0.3mm into the underside)
printed fine but left "significant nubs that required sanding" at every contact. Slicer-doc
and community research into contact-point geometry; no code changed.

## 1. Contact geometry for the smallest, cleanest nub

**Diameter.** Every slicer treats tip diameter as the core removal-vs-strength dial. Lychee's
miniature presets run **0.15mm (light) / 0.30mm (medium) / 0.50mm (heavy)**
([Lychee support components](https://sites.google.com/mango3d.io/lycheesliceredu/support-components)).
Community guides converge on **0.30-0.35mm for detail, 0.40-0.45mm as the "snap off clean"
sweet spot, 0.45-0.50mm for heavy/structural**
([Dreaming3D](https://dreaming3d.net/blogs/news/ultimate-resin-support-settings-guide-stop-failed-prints-2026)).
PrusaSlicer's own SLA default head diameter is **0.4mm**, and one guide flags **under 0.5mm as
"very likely to fail"** for load-bearing heads on large parts
([objectforge](https://objectforge.blogspot.com/2020/05/support-head-diameter-in-prusaslicer.html),
[HalfBrainToys](https://medium.com/@halfbraintoys/best-auto-supports-for-resin-sla-3d-printing-works-for-any-printer-c2114bbf85fc)).
**Disagreement**: no diameter is called both safe and effortless anywhere — sources frame it
as a per-print trade, biggest tips where load is highest (edges), smallest where cosmetics
matter more (already Base-ifier's edge-biased layout).

**Depth/penetration.** Chitubox calls it "Contact Depth," Lychee "Penetration," PrusaSlicer
"Head Penetration" — same concept everywhere: how far the tip's solid volume overlaps the
part. PrusaSlicer's documented range is **0.1-0.7mm**; a Chitubox worked example uses
**0.20mm** penetration explicitly
([Chitubox support parameters](https://docs.chitubox.com/en-US/chitubox-basic/latest/ui-and-features/configure-support-parameters),
[forum.prusa3d.com](https://forum.prusa3d.com/forum/original-prusa-sl1-general-discussion-announcements-and-releases/prusa-slicer-support-tweaks/)).
No source gives one universal default — Prusa forum users report factory defaults from
0.2-0.4mm across versions — but **0.2-0.3mm recurs across tools**, already what Base-ifier
uses.

**Cone/tip length.** PrusaSlicer's head length (taper above the pillar) works well at
**2-5mm**; Chitubox separates "Upper Diameter" (contact tip) from "Lower Diameter" (where the
taper meets the pillar) so the transition can be widened, stopping the pillar from starving
the tip of strength
([forum.prusa3d.com](https://forum.prusa3d.com/forum/original-prusa-sl1-general-discussion-announcements-and-releases/prusa-slicer-support-tweaks/),
[Chitubox docs](https://docs.chitubox.com/en-US/chitubox-basic/latest/ui-and-features/configure-support-parameters)).
Base-ifier's 1.5mm is short by comparison but reasonable given the pillar itself is only
1.4mm — a longer taper there is just a second thin, breakable section.

**Ball vs cone vs necked.** The most consistent finding across sources: a plain cone ("Default
Contact") leaves a small **crater/hole** needing filler; a **ball/sphere contact** leaves a
small **raised bump** that just needs sanding, recommended whenever "the priority is easy
post-processing"
([Anycubic](https://store.anycubic.com/blogs/3d-printing-guides/comparison-of-support-tips-in-3d-printing)).
Anycubic's Photon Workshop and Chitubox both expose a **"Break Point"** option: a deliberately
thin waist between ball and pillar so the print breaks there instead of tearing the model
surface. Ball+break-point ranks best for sanding ease and finish but *worst* for print-success
rate on large/heavy parts — the necked design trades mid-print robustness for cleanup ease
(same source). This "necked tip" is exactly what the task description proposes, and it's a
named, shipping feature, not a novel idea.

**Alignment to the surface normal.** No slicer we found reliably reorients pillars to the local
surface normal — PrusaSlicer and Chitubox build pillars along the build (Z) axis regardless of
local surface angle; only Lychee's docs vaguely claim it "will try to angle the tip so it's
coming off the model at approximately a 90 degree angle," with no default value confirmed
([Lychee support components](https://sites.google.com/mango3d.io/lycheesliceredu/support-components)).
Working the geometry ourselves (not a cited number): a cylindrical tip of diameter *d* driven
straight down into a plane tilted θ from horizontal meets it in an ellipse whose long axis is
**d / cos θ** (θ = angle between tip axis and surface normal = the plate's tilt). At
Base-ifier's 45° default that's **1.41×** the nominal diameter; at 55° (large rectangles),
**1.74×** — a "0.5mm" tip actually leaves a 0.7-0.87mm-long mark, which plausibly explains nubs
feeling bigger than the configured diameter, and follows directly from `autoTiltDeg`.

## 2. Practical numbers for a 45° tilted flat underside

Combining the above, experienced users land on roughly **0.35-0.45mm tip diameter** and
**0.2-0.3mm penetration** for supports meant to snap off by hand without sanding — where
Lychee's "medium" preset, PrusaSlicer's stock 0.4mm head, and the community "0.40-0.45mm sweet
spot" all cluster. The "0.2mm depth / 0.3-0.4mm tip" forum shorthand is these same defaults
collapsed to round numbers, not a separately-derived rule. The failure mode at the other end
is well documented: too-thin or too-sparse tips let the print's weight and peel force pull it
off its supports mid-print, dropping it into the vat while the supports stay on the plate —
one of the most common resin failure patterns, driven by tip strength and support count
together, not diameter alone
([Anycubic](https://store.anycubic.com/blogs/3d-printing-guides/resin-3d-print-support-separation)).
Base-ifier's pillars (1.4mm, trending to 1.3-1.5mm per `support-patterns.md`) are much fatter
than the tip, so only the last, thin segment is actually at risk — this mainly bears on the
terminal diameter and neck length, not the pillar.

## 3. Removal technique

Consensus is to remove supports **green** — after the IPA wash, before final UV curing —
because uncured resin is still flexible and tears/snaps with less force and less model damage;
fully-cured supports are brittle, "fly across the room when cut," and more likely to pockmark
or crack the model at the joint
([Forgecise](https://www.forgecise.com/do-you-cut-resin-print-supports-before-or-after-curing/)).
The trade-off named explicitly: green removal favors finish, post-cure removal favors
dimensional accuracy — for small decorative bases, green removal is the fit. Ball contacts are
meant to be *cut* with flush cutters at the neck (not pulled), leaving the ball rather than
tearing the model surface; "Break Point" necking is the only named sacrificial trick found —
no source described a raised "sanding pad" design.

## 4. Mesh contact: intersection or exact touching?

Every slicer found — Lychee, Chitubox, PrusaSlicer — defines penetration/contact depth as a
**nonzero, positive** number specifically so the tip's solid volume overlaps the part; none
model a tip as tangent/zero-depth contact. This corroborates Base-ifier's current
intersection-based design and `resin-printing-bases.md`'s finding: the real risk for slicers
like Chitubox is **exact coplanar overlap** (a support face bit-identical with a body/sculpt
face), not overlap in general — keep intersecting, keep contacts off-axis from flat faces.

## Recommended tip geometry for Base-ifier

- **Contact (tip) diameter: 0.4mm** (down from 0.5mm) — inside the "safe and clean" band
  every source agrees on; the fat 1.3-1.5mm pillar carries the load, so the tip itself can run
  toward the removal-friendly end.
- **Neck: a straight 0.4mm-diameter cylinder, ~0.3-0.4mm long**, between the tapered cone and
  the surface — the deliberate weak point (Anycubic/Chitubox "Break Point" pattern) so breakage
  happens there, not against the model surface.
- **Cone/taper length: keep ~1.5mm** above the neck, matching the current value and scaled to
  the pillar's own diameter.
- **Penetration: 0.2-0.3mm**, measured along the **local surface normal**, not vertical Z — the
  current code adds `penetration` to world Z, under-delivering real depth as tilt increases
  (0.3mm vertical is only ~0.17mm true depth at 55°).
- **Align at least the neck+cone to the surface normal**, not world Z — no mainstream slicer
  fully solves this either, but the math above shows it directly fixes the oversized-nub
  complaint: a normal-aligned 0.4mm tip leaves a true 0.4mm circular mark instead of a
  0.57-0.7mm ellipse. Keep the pillar vertical; only bend the last ~1-2mm.
- **Small sphere at the contact**, ~0.1mm larger than the neck (~0.5mm over a 0.4mm neck) —
  converts leftover material into a small dome that sands in one or two strokes instead of a
  flat scar, per every ball-contact source.
- **UI guidance**: remove supports after the IPA wash but *before* UV curing — snap or
  flush-cut at the neck, then cure. Curing first makes cleanup harder and more likely to mark
  the sculpt, per the removal-technique consensus.

Sources: [Lychee support components](https://sites.google.com/mango3d.io/lycheesliceredu/support-components) ·
[Chitubox support parameters](https://docs.chitubox.com/en-US/chitubox-basic/latest/ui-and-features/configure-support-parameters) ·
[PrusaSlicer SLA slicing](https://help.prusa3d.com/product/prusaslicer/sla-slicing_214) ·
[PrusaSlicer support tweaks forum thread](https://forum.prusa3d.com/forum/original-prusa-sl1-general-discussion-announcements-and-releases/prusa-slicer-support-tweaks/) ·
[Support Head Diameter in PrusaSlicer](https://objectforge.blogspot.com/2020/05/support-head-diameter-in-prusaslicer.html) ·
[HalfBrainToys: Best AUTO Supports for Resin SLA](https://medium.com/@halfbraintoys/best-auto-supports-for-resin-sla-3d-printing-works-for-any-printer-c2114bbf85fc) ·
[Anycubic: comparison of support tips](https://store.anycubic.com/blogs/3d-printing-guides/comparison-of-support-tips-in-3d-printing) ·
[Anycubic: resin print support separation](https://store.anycubic.com/blogs/3d-printing-guides/resin-3d-print-support-separation) ·
[Dreaming3D resin support settings guide](https://dreaming3d.net/blogs/news/ultimate-resin-support-settings-guide-stop-failed-prints-2026) ·
[Forgecise: cut supports before or after curing](https://www.forgecise.com/do-you-cut-resin-print-supports-before-or-after-curing/).
