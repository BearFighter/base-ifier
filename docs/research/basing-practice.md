# Wargaming basing, diorama and display practice → generator rules (research, 2026-09-16)

Sources: Goonhammer "How to Base Everything", Warhammer Community Armies on Parade articles
and entry checklist, Mantic multibasing guide, LITKO Old World tray guide, Micro Art Studio /
Tabletop-Art / Secret Weapon product ranges, Green Stuff World roller specs, Epic Basing and
Loot Studios tutorials, Geo-Scatter docs, Dungeon Alchemist reviews, resin printability
guides (AmeraLabs, NExT Lab). Numbers without a published standard are flagged as heuristics.

## Genre vocabulary

Sci-fi must foreground man-made or alien geometry as the dominant surface (deck plating
seams, grating, cable runs, rebar, crystal or organic growth) with dirt and dust only as a
secondary weathering layer; plain earth reads as fantasy or historical.

| Preset | Ground | 3-5 element families | Density | Height profile |
|---|---|---|---|---|
| Temple ruins | cracked flagstone | broken columns, statuary fragments, vine overgrowth, rubble | medium | one tall fragment, rest low |
| City ruins | shattered concrete, rebar | collapsed masonry, rebar spikes, rubble, urban debris, scorch marks | medium-high | jagged, one taller wall fragment |
| Forest floor | leaf litter, moss | logs, roots, ferns, mushrooms, grass tufts | low-medium | mostly flat, occasional log |
| Swamp | mud, standing water | reeds, dead roots, lily pads, bog debris | low | flat, minimal verticals |
| Snow | packed/drifted snow | rocks, dead brush, footprints, ice patches | low | drift mounds |
| Desert | cracked dry earth, dunes | rocks, bones, dead cacti, sand ripples | low | low dune undulation |
| Lava/volcanic | basalt, glowing cracks | obsidian shards, cooling crust, ash drift | medium | jagged outcrops |
| Graveyard | broken earth, gravel | headstones, bones, iron fencing, dead grass | medium | headstones as verticals |
| Sci-fi industrial deck | deck plating, panel seams | grating, cables, pipes, crates, warning stencils | medium-high | flat plating, occasional pipe run |
| Sci-fi hive rubble | shattered concrete, rebar | rubble, twisted rebar, tech debris, cable snarls | high | uneven rubble mounds |
| Ash wastes | fine ash drift, corroded scrap | scrap metal, wreck fragments, bone/fossil debris, ripples | medium | low dunes, occasional spike |
| Alien jungle | organic loam, coral growth | alien flora, crystals, bioluminescent fungus, egg clusters | medium-high | tall flora spikes over low loam |
| Lunar/regolith | fine regolith, craters | boulders, footprints, tech debris, crater rims | low | crater rims, otherwise flat |
| Trench line | churned mud, duckboard | sandbags, barbed wire, duckboards, spent shells | medium | trench walls as the vertical |
| Cobbled street | 5 x 10 mm cobbles | cracks, drain grates, battle debris | low-medium | near-zero relief |

## Composition rules judges reward

Armies on Parade judges cohesion of theme, originality, conversion and painting; the board
is unscored for most categories but "often elevates presentation". Recurring rules:
focal point off-centre at a rule-of-thirds point; height variation ("layer cakes and
aquariums"); a flat texture-free landing zone under each miniature (slotta/peg holes exist
for this); nothing overhanging the rim; texture scaled to 28-32 mm (Green Stuff World
publishes 5 x 10 mm cobble/brick repeats for 1/22-1/48 scale); a 3-5 element family budget
per unit with varied arrangement (the limited-palette doctrine applied to props); negative
space so the model, not the base, is the subject; density that falls as the base shrinks.

## Multibase and unit practice

Kings of War multibases the whole unit on one scenic footprint (wounds tracked separately),
which is the precedent for "diorama that splits into bases". The Old World keeps individual
20/25 mm bases and ranks them in a separate movement tray; unit fillers and sabot bases are
the middle ground. Continue across cuts: roads, wall tops, fallen trunks, streams, tank
ruts, trench lines (same height and heading on both sides). Never split: discrete hero
props. Author continuous features on a grid aligned to the smallest module (25 mm).

## Display boards

Armies on Parade caps boards at 2 x 2 ft (61 x 61 cm); 22 x 30 in appears as a GW kit
size; independent boards commonly 24 x 18 in or 24 x 12 in. Best entries match base and
board textures and recess or magnet-key each unit base so it lifts out for games.

## Existing tools and their lessons

Geo-Scatter/Scatter5 (Blender): density from slope, altitude, curvature, proximity and
painted masks; 80+ biome presets; attraction/repulsion rules (maps to "keep props off the
feet"). Dungeon Alchemist: rule-based room filling from a themed library; complaints: small
rooms get too few props and miss the centrepiece, no 3D export, weak sci-fi theming.
Generic scatter complaints: too even or too random, floating props, props through feet.

## Printability rules for props

Resin minimum feature 0.3-0.5 mm (lattice/walls 0.5-0.75 mm); self-supporting angle about
25° before supports; support tip 0.4-0.5 mm; no free-standing thin spikes (taper or lean
them); grating holes >= 1 mm with bars >= 0.4 mm; pipes/cables >= 1.5 mm; a flat zone under
the miniature with nothing above 0.2-0.3 mm.

## Rules for the generator (as implemented in `src/kernel/props/scatter.ts` and presets)

1. Foot zone Ø 12-16 mm per model slot, nothing above 0.3 mm inside it.
2. Props inset >= 1.5 mm from rims and planned cut edges.
3. Feature sizes at 28-32 mm scale: cobble/brick 5 x 10 mm, rubble 2-8 mm, planks 3-4 mm,
   grit < 0.5 mm as noise.
4. 3-5 element families per base or unit; vary arrangement, not vocabulary.
5. One hero prop per piece >= 40 mm at a rule-of-thirds point; none below.
6. Height cap by piece size (6 mm on <= 32 mm, 12 mm on <= 60 mm, 25 mm above), tallest
   feature off-centre.
7. Density falls as area shrinks (a third of full density at 25 mm).
8. Linear features cross cuts with matching heading and section; hero props never straddle.
9. Continuous features on a 25 mm module grid.
10. Resin printability minima above; spikes taper and lean <= 65°.
11. Two multibase modes: Kings of War flexible scatter vs Old World base + tray.
12. Display-board mode: 2 x 2 ft / 24 x 18 in / 24 x 30 in presets, tiers, recessed or
    magnet-keyed unit slots, gaps for movement trays, palette contrasting the army.
13. Every scene must resolve to watertight, cuttable, printable geometry before preview.
