# The zoom ladder on the hex map — a proposal

**Nothing here is built.** This is a design note written on 2026-11-06, before
any code, from a conversation Greg opened: *"we're going to look at what
happens when we use zoom. I think we need several levels of zoom, and smooth
animations between them."* It records the levels he described, one measurement
that changes the shape of the answer, a rule I'd propose instead of a fixed
ladder, and the three questions still waiting on him.

**In one paragraph.** Zooming out of a company should feel like pulling back
from a street to a city to a country — people become teams, teams become
functions, functions become a company, and a company becomes one shape among
others. What has to be decided is what *triggers* each of those changes. Greg's
instinct was that four things matter: how big the window is, how many nodes are
on screen, how big the company is, and how many layers it has. The measurement
below says one of those is already handled for free, two of them would actively
make the map worse, and the fourth matters enormously — but not as a threshold.
The whole ladder can hang off a single number: **how many pixels wide a cell is
on the glass.**

---

## The levels, in Greg's words

1. **People.** The base. Avatars, and data on that person and their work.
2. **A team, or a few teams.** Avatars still there, summary data per person,
   maybe more on hover, but the emphasis is on the team.
3. **Teams of teams, or functions.** Humans stop being avatars and become
   nodes or dots. Teams read as the coloured zones — *"oddly shaped gummy
   bears"* — finished on `lab` on 2026-11-06.
4. **Companies.** Every team on the same branch bubbles together into one
   super-blob. Only its leading node is interactive.
5. **Conglomerates.** *"Effectively a repeat of the immediate-above point."*

That last sentence is the key to the whole design, and it is picked up under
*One rule, applied recursively* below.

---

## The one number: cell-pixels

The hex map has a property the orbital map never had: **every cell is the same
size.** A person, a team node, a division node and the company all occupy one
cell of a uniform lattice. Size carries no meaning here.

So there is only one honest question to ask about zoom — *how big is a cell on
the glass* — and Greg already found it on 2026-10-02, when he asked for people
to appear sooner and the answer turned out not to be a world scale:

> *"Right now it feels like we need to zoom too far before people become
> visible… Ideally, we want to be able to see two or three teams on a standard
> 13" display, and more on a larger screen."*

That became `PEOPLE_AT_CELL_PX = [140, 230]` in `app/lab/hex/HexLab.tsx` —
cell circumradius in **screen** pixels, not world scale. The reason it travels
is that it is the same number on a 13" laptop and a 32" monitor; what changes
between them is how much of the company you see at that level of detail, which
is exactly right.

**The proposal is to make cell-pixels the only input to the ladder**, and to
take the other three factors out of the threshold entirely.

### Viewport size is already handled

Hold the threshold constant and a bigger screen shows more teams at the same
level of detail. Nothing more is needed, and anything more would break the one
property that makes the number portable.

### On-screen node count should not be an input

It is tempting, and it breaks two ways.

**Panning would change the zoom level.** Move sideways out of a sparse branch
into a dense one, without touching the zoom, and the map would change
character under you. There is no way to read that as anything but a fault.

**It oscillates.** Revealing detail puts more marks on screen, which crosses
the threshold, which hides them, which crosses back. This is the standard
level-of-detail flicker, and the standard fix — a wide deadband — costs you
the precision that made counting attractive in the first place.

Node count is a *consequence* of cell-pixels and viewport size, not an
independent cause. Deciding how many marks a given view can carry is a real
and separate job, and it already has an owner: `lib/map/runtime/visibility.ts`
holds the mark budget and the thinning. **Budget by count, trigger by
cell-pixels** — the two should not be the same mechanism.

### Company size and depth should not move the thresholds either

If the ladder re-pitches itself per company, somebody who learns the map on
Digital Tailoring has to learn it again on a 2,500-person org, and there is
never a stable relationship between *how big a face is on my screen* and *what
I can do here*. That relationship is the thing being learnt.

They matter instead by deciding **how many rungs a company has at all.**

---

## What the measurement says

Measured on 2026-11-06 against the four lab fixtures, through the real code —
`buildLabCompany` → `buildOrbitalTree` → `layoutHex` → `minScaleFor` — at the
default `roomy` density, people strata. The figure is cell **circumradius** in
screen pixels when the whole company is fitted to the window. The method is at
the end of this note; the script was deliberately not kept.

| Company | Cells | Span | Fits at (1440×820) | Fits at (2560×1400) | Doublings up to 230px |
| --- | ---: | ---: | ---: | ---: | ---: |
| Sparrow-ish, 10 | 27 | 24 × 14 | 21.8px *(capped)* | 21.8px *(capped)* | ~3.4 |
| Digital Tailoring-ish, 45 | 110 | 77 × 51 | 7.5px | 12.8px | ~5.0 |
| 1,000 · 8 rungs | 1,273 | 228 × 199 | 1.9px | 3.3px | ~6.9 |
| Northwind, 2,562 · 11 rungs | 2,957 | 419 × 310 | 1.2px | 2.1px | ~7.6 |

*(Sparrow Jam's 21.8px is the camera's own zoom cap, not a fit — a ten-person
company would otherwise fill the window at a much larger cell. `minScaleFor`
in `lib/map/camera/viewport.ts` owns that.)*

**The finding: the available zoom range is not a constant.** It is about three
and a half doublings on a ten-person company and seven and a half on
Northwind — a factor of four difference in how much ladder there is to climb.

**Which is why a fixed ladder is the right answer rather than a compromise.**
Pin the rungs to cell-pixels and Sparrow Jam gets the top two or three and
simply never reaches the outer ones. That is correct: **Sparrow Jam has no
team-of-teams level**, and a map that invented one would be lying. The ladder
elides itself on small companies, for free, with no per-company tuning.

### Where the rungs land

Pitched to those numbers, cell circumradius in screen pixels:

| Level | Cell-r | Cells across 1440px | What the smallest readable thing is |
| --- | ---: | ---: | --- |
| **Work** | ~500 | ~2 | an individual task |
| **Person** | 230 | ~4 | a human, with a face |
| **Team** | 50 | ~19 | a human as a tile; the team is the subject |
| **Function** | 14 | ~69 | a team as a cell; the gummy bear is the subject |
| **Whole** | 4 | ~240 | a function as a blob; the company is the subject |

Horizontal cell pitch on this lattice is `1.5 × circumradius`, which is where
*cells across* comes from.

Each rung is about ×3.5 from the one below it — roughly 1.8 doublings — and the
five of them span 230px down to 4px, which is 5.8 doublings. Northwind has
7.6, so it gets the whole ladder with headroom. Sparrow Jam has 3.4 from its
cap, so it gets Work, Person and Team and stops.

**Treat those five numbers as a starting point for looking, not as settled.**
Only the 140–230px band for people has been through Greg's eyes; the rest are
derived from footprints and arithmetic, and the next step is to look at them
(see *Before any code*).

---

## One rule, applied recursively

Greg's five levels are a *structural* ladder — person, team, team-of-teams,
company, conglomerate. But org depth runs from 2 rungs on Sparrow Jam to 11 on
Northwind, so **zoom level N cannot map to org rung N**. Northwind would need
eleven levels, and then a conglomerate of Northwinds would need twelve.

The way out is in Greg's own last sentence: a conglomerate *"is effectively a
repeat of the immediate-above point."* It is not a new level. It is the same
level, one rung further up. So the proposal is one rule:

> **At any zoom, pick the rung whose typical territory footprint reads at about
> 70px on screen. Draw that rung's envelope as the gummy bear. Everything below
> it is ground, or dots, or nothing; everything above it is a larger envelope
> you have not reached yet.**

One formula, and teams blob into functions into divisions into the company into
a conglomerate — continuously, by the same mechanism, on an org of any depth.
Northwind's eleven rungs collapse smoothly because the blob rung simply slides
outward as the camera pulls back. Nobody tunes a ladder per company, and
*which level am I on* is derived rather than declared.

**It is cheap, because the drawing already exists.** `roundedUnion` →
`boundaryLoops` → `pushOut` → `traceRounded` in `app/lab/hex/loops.ts` take an
arbitrary set of cells and give back a rounded boundary; `evenodd` fills
already handle holes and islands. The only new thing is *which grouping* gets
handed to them.

**It wants caching.** Cells do not move when the camera moves, so a rung's
envelope is a pure function of the arrangement and should be computed once per
rung and kept. This matters: one fill per team already ran a **33ms median**
from a wheel notch to two frames later on the 1,000-person company — two 60Hz
frames, on a dev build on a developer's machine, which is not the five-year-old
iPad the bar is set by. There is not much headroom to spend.

---

## Two changes to the levels as described

### There is a level below people, and it is the one that makes the product useful

Greg put people at the base, and said that level needs *"data on that person
and their work."* At 460px across, a person's cell is a **glance** — face,
name, role, one read of how loaded they are. The **read** of their work needs
another level in.

The reason is pixels, not preference. Work volume varies from three items to
forty, and a fixed-size cell cannot be one dot per item past a point. So inside
a person's cell, work is a **shape** at person level and **items** one level
further in — which is the pattern the orbital map already proved as
torus → people → capsule → work dots (`lib/map/camera/lod.ts`).

### The map must not decide what data a person shows

Greg named the hard part himself: *"the volume of work and what data would be
needed may vary from business unit to business unit, person to person."*

The map should not try to answer that. It should answer **how much room there
is**, and let something else fill it:

- **The cell is a fixed budget of slots** — say *who* · *what they're on* ·
  *how it's going* · *one number*. The map guarantees the slots; the tenant or
  the business unit maps its own fields into them. This is the only version of
  this that survives payroll, Jira and WorkBoard all arriving later.
- **Anything variable lives in hover and the panel**, never on the tile.

**The failure mode to design out** is the map *depending* on a field some
customer does not have. That breaks per-customer, which is the worst possible
place to discover it.

---

## Three things to decide before building

### What is grabbable should be what the level is about

Greg's instinct that only the leading node is interactive at company level
generalises: at team level you grab teams, not people. It is a good rule and it
has teeth — it means drag semantics change with the camera.

**It also means one flick while zoomed out could restructure a thousand
people.** Zoomed-out gestures need *more* confirmation, not less, and undo
matters more the further out you are. `decideDrop` in
`lib/map/growth/drop.ts` and the pending-dialog machinery in `HexLab.tsx` are
the right home for that, and it should be designed in rather than discovered.

### Hand placements versus blobs

Law 0 says the hand outranks the engine (`docs/MAP-LAWS.md`), so somebody can
place a team member right across the map — and then that team's gummy bear
grows a long tail, or a separate island. Greg has already seen the symptom at
the tile level: on 2026-10-06, with 1,258 placements of his own on screen, he
named three people *"separated from their family groups"* while the panel
insisted 91% were touching.

`boundaryLoops` already returns multiple loops and the fills are `evenodd`, so
an island costs nothing to draw. **The recommendation is to show it.** An
exclave is true, and a blob that quietly swallowed or dropped it would make
every outer level a lie.

### Smooth morph and discrete levels are two different features

> *"I think we need several levels of zoom, and smooth animations between
> them."*

Both, and they are built separately.

**The morph is nearly free on a lattice.** Cells do not move when you zoom, so
unlike the orbital map *nothing has to animate position*. Only presence and
geometry cross-fade: a face into a dot into nothing; a team's ground from
*colour behind distinguishable tiles* into *the whole shape of the team*. That
is also the reason to believe it will run on the old iPad, and it should still
respect `prefers-reduced-motion`.

**The named jump is the part that makes the ladder learnable.** A level
control, or `⌘+` / `⌘−`, that tweens the camera to the next rung's framing. Without
it the levels can only be reached by scrubbing a wheel, and nobody ever learns
they exist. *This* is where an animation actually belongs — a camera tween to a
framing, not a cross-fade of content.

---

## One piece of cleanup this turns up

`revealAt` in `lib/map/camera/lod.ts` is in **world scale**, inherited from the
orbital map, where it was the right question because a unit's size there
depended on what it carried. The hex page overrides only the `people` band to
cell-pixels (`HexLab.tsx`, where `tier` is computed) and lets the rest through.

So the HUD's tier is partly driven by a number that means nothing on a lattice,
and `revealAt`'s `torus`, `workCapsule` and `workDots` bands are currently
decorative on this map. **On hex, every band should be cell-pixels.** Worth
doing as the first commit of this work, because everything else reads from it.

---

## Before any code

The cheap, honest first step is to **look**, not to pick numbers in a document.

1. Put a cell-pixel readout in the hex HUD beside the existing `×` figure, so
   the number driving everything is visible while looking at the map.
2. Screenshot all four companies at a ladder of cell-pixel values — 230, 120,
   50, 25, 14, 8, 4 — and put them in front of Greg.
3. Let him name where the levels actually are. The 140–230px band for people
   came from him looking at the map, and the other four rungs should come from
   the same place.

**The questions for Greg, plainly:**

- **Is there a work level below people?** This note argues there is, on the
  grounds that a 460px cell is a glance and not a read. It is his call.
- **Four slots on a person's tile, or some other number?** Everything about
  per-customer data hangs off that answer, and it is a product decision rather
  than an engineering one.
- **Should a zoomed-out drag be able to restructure a division at all?** It
  falls out of "grab what the level is about", and it may be too sharp a tool.

### How the measurement was taken

A throwaway Vitest file called `buildLabCompany(key, "people")` from
`app/lab/hex/company.ts`, then `buildOrbitalTree(org, { mergePassThroughRoot:
false, workCountFor: () => 6 })` — the same options `HexLab.tsx` passes — then
`layoutHex(tree)` at default density, then `minScaleFor(scene.bounds, size)`
from `lib/map/camera/viewport.ts` for each viewport. Cell-pixels is
`scene.hex.size × scale`. It was deleted rather than committed, because it
answers a question once rather than holding a promise; the four lines above
reproduce it.

**Not verified:** none of this has been looked at in a browser, because none of
it is built. The 33ms figure is quoted from `docs/HEX-LAYOUT.md` § *A team
became a place*, not re-measured. No touch device, no iPad, and no check of
whether a derived blob rung is affordable at Northwind's scale — that last one
is the real risk in the proposal, and the caching note is why.
