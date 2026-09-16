# Asset sources and licences for Base Studio (research, 2026-09-16)

Question: which asset ecosystems can Base-ifier bundle or stream for its terrain/prop studio,
and what may users do with the results? Context that changes the answer: **selling is the
exception.** Ordinary users export watermarked bases for their own printing; only holders of
a Bit Death Labs commercial licence export watermark-free output for sale. So:

1. Anything **we** bundle or stream is our redistribution: it must be CC0 or ours, whatever
   the user's tier.
2. What a **user imports** is their responsibility in the personal tier (the app is an
   editor; personal printing of owned assets is broadly allowed or unaddressed).
3. The **commercial tier's** watermark-free export is where licence tags get enforced.

## CC0 sources (bundle, redistribute, sell: all allowed; credit optional)

| Source | Licence | API / bulk | Content for bases | Notes |
|---|---|---|---|---|
| Poly Haven | CC0 (polyhaven.com/license) | Public REST API, third-party in-app browsers explicitly welcomed; set a unique User-Agent and name the source | 521 models: 37 rocks, 110 nature, 97 industrial, 68 containers, 32 ground cover | Photoreal; glTF ships a `.bin` with geometry separate from textures |
| ambientCG | CC0 (docs.ambientcg.com/license) | Documented API | 2000+ PBR materials (rock, gravel, mud, cobbles: displacement maps make good terrain stamps); few models | Textures more than props |
| Kenney | CC0 (kenney.nl) | No API, zip packs | Nature, castle, dungeon, industrial, space kits | Flat-shaded low-poly: toy-like next to sculpted minis |
| Smithsonian Open Access 3D | CC0 per item (si.edu/openaccess) | Metadata API; per-object export | Statues, artefacts, specimens | Check each item's tag; raw scans need decimation |
| Quaternius | CAUTION: "QAL v1.0" since 28 Aug 2026, replacing CC0 | None | ~2000 stylised models incl. a 270-piece sci-fi kit | Forbids redistributing assets "independently... in modified form"; a base that mostly is the model is ambiguous; ask before use |
| Three D Scans | No citable licence text found | None | Museum sculpture scans, millions of tris | Confirm directly before commercial use |

## Quixel Megascans / Fab (Epic): not usable for bundling or streaming

Fab launched 22 Oct 2024 and put Megascans under the Fab Standard License for any engine
(the old Unreal-only restriction is gone; content acquired free by end of 2024 stays usable,
freemium since 2025). The EULA (fab.com/eula, 1 Oct 2024):

- 4(c): a distributed project may include Content only "in object code" and must restrict
  end users from "extracting or otherwise using Content outside of the Project".
- 5(a), 6(b): no standalone distribution; no letting third parties "incorporate Content into
  their own products, services, or other projects".
- 4(a): the project "must reasonably add value beyond the value of the Content and the
  Content must be merely a component of the Project and not the primary focus".
- 3D printing / physical goods are not mentioned anywhere; no FAQ covers them.
- No public API or bulk download (forum requests 2024-2026 unanswered); access only through
  the Fab website, the Fab desktop app, or UE/UEFN plugins.

Verdict: Base-ifier cannot bundle or stream Megascans. A printable STL whose value is a
scanned rock fails 4(a) and 6(b) for sale; personal printing of a user's own Megascans is an
unaddressed grey area, so such imports are tagged `personal-only`.

## Marketplace licences: none allow selling a base whose value is the asset

| Source | Key clause | Sell STL | Sell prints |
|---|---|---|---|
| Sketchfab Standard | No stand-alone files; no derivative "so similar" it is not original; "may not print a 3D asset or a slightly modified version of it and sell it" | No | No (CC0/CC-BY items on Sketchfab are fine) |
| TurboSquid | Physical creations allowed, but untransformed/substantially similar objects limited to 5 personal/gift copies; bans assets in tools with general import/export | No | Only the 5-copy personal cap |
| CGTrader Royalty Free | Products may not be sold "in the form downloaded or in 3D printed physical form" | No | No |
| KitBash3D | Output limited to images/video/interactive; editable formats need extra rights | No | Not granted |
| Adobe Substance 3D Assets | Distribution only when the asset is not "the primary value" | No | No |
| Unity Asset Store | Software products only | No | No |
| BlenderKit | CC0 items fine; Royalty Free items: no resale even modified | per item | per item |
| Textures.com | 2D only, no redistribution, scans cannot be bundled | n/a | n/a |

## Print sites are per item

Thingiverse, Printables, Cults3D and MyMiniFactory/Scan the World let each uploader choose a
Creative Commons variant or a house licence. CC-BY-NC forbids selling prints or files.
CC-BY-ND forbids sharing any adapted version, so a base cut from an ND file cannot be sold or
even given away. CC0 and CC-BY are fine (BY needs credit). Cults3D "Private Use" forbids
modification, file sale and print sale; its paid add-on allows print sales only while active.

## Wargaming STL creators

Loot Studios, Artisan Guild, Epic Basing, Txarli and Printable Scenery: default personal use;
paid merchant tiers allow selling PRINTS; none allow redistributing files, modified or not.
That is the ecosystem's hard line, and Base-ifier's own licence follows it.

## What the app does with this

- Bundled library: CC0 (Poly Haven via its API, ambientCG stamps, Smithsonian per item) and
  our own parametric elements; nothing from Fab or marketplaces.
- Imports carry a licence tag: `cc0`, `attribution`, `merchant-prints-only`,
  `personal-only`, `no-derivatives`, `own-rights`, `unknown`. Personal tier: reminder only.
  Commercial (watermark-free) export: `personal-only`, `no-derivatives` and `unknown` block
  the export of pieces containing that prop; `merchant-prints-only` allows the user's own
  printing but marks the file "do not distribute"; `attribution` writes a credits sidecar.
- Questions for a lawyer (commercial tier only): ND plus heavy transformation; TurboSquid's
  "small part of a much larger array" exception; how our commercial licence interacts with
  third-party merchant tiers (it cannot grant rights an asset licence withholds).
