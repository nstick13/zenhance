# Getting the orbital layout engine back

Greg asked for this on 2026-09-29, when the hex grid study started: *"stash the
existing engine or notes into some high-compression txt file (or similar) so we
can recover it later."*

**Nothing has been deleted.** The hex grid is additive — it lives in
`lib/map/layout/hex/` beside the old engine, and `/org` still draws exactly what
it drew before. Even if that changes, there are three independent ways back, and
you only need one of them.

## 1. It is still in the working tree

`lib/map/layout/layout.ts`, `branches.ts`, `position.ts`, `forest.ts`, `snap.ts`
and the rest are untouched. The hex study does not import them and does not
replace them. If the hex idea is abandoned, delete `lib/map/layout/hex/` and
`app/lab/hex/` and the repo is where it was.

## 2. The git tag

```bash
git show archive/orbital-layout-pre-hex
git checkout -b recover-orbital archive/orbital-layout-pre-hex
```

That tag points at `6046866` — the last commit on `lab` before any of this.
This is the repo's normal convention; see `AGENTS.md` § *Nothing is ever lost*.

## 3. The compressed bundle

`docs/reference/orbital-layout-engine.tar.xz` — 73 KB holding 27 files and
5,810 lines: the whole layout engine, its 155 tests, the growth engine's
insertion planner, and the two documents that explain what they decided.

```bash
tar -xJf docs/reference/orbital-layout-engine.tar.xz
```

It extracts to the same paths it was taken from, so do it somewhere other than
the repo root unless you actually want to overwrite what is there.

## What is in the bundle, and why it is worth keeping

| file | what it knows that is expensive to rediscover |
|---|---|
| `layout.ts` | the ring map: rungs, sectors, seat fans, the torus stand-in |
| `branches.ts` | local geography — the river, `fanFor`, the fan ladder, `ORBIT_TOLERANCE` |
| `complexity.ts` | how a company is measured to choose its drawing, with the calibration table |
| `position.ts` · `snap.ts` | what a saved angle means on each drawing, and how a drop reads back |
| `envelope.ts` | the territory outline: smooth union → marching squares → Chaikin |
| `geometry.ts` | seat packing, ring steps, work furniture — **still used by the hex study** |
| `model.ts` | tree building — **still used by the hex study** |
| `insertion.ts` | who makes room when a unit is dropped, and the preview-equals-commit rule |
| `__tests__/laws.test.ts` | the four laws, and the fixtures that hold them |

The two most expensive things in there are the **calibration table** in
`complexity.ts` (measured on a reference screen, not guessed) and the **fan
ladder** in `branches.ts` (three attempts, each with a recorded reason). Both
were tuned against real measurements that are written down in
`docs/LARGE-COMPANY-NAVIGATION.md`, which is also in the bundle.
