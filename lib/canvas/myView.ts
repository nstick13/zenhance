import { DEFAULT_LENS, normalizeLens, type Lens } from "./lens";

/**
 * "My view" — the per-user half of the lens (S3/S5, the 🔶 decision).
 *
 * The workspace default lives in `workspaces.lens` and is what a colleague
 * sees on their first open. This module holds what *I* am looking at right
 * now, which is mine alone and must never touch anyone else's map.
 *
 * The bug this fixes: `saveLens` used to fire from the canvas topbar and write
 * workspace-wide, immediately — so flipping to colour-by-discipline to make a
 * point in a demo silently changed it for every other user, permanently, with
 * no undo and no notice. Tolerable at two settings, untenable at ten.
 *
 * Browser storage rather than a table on purpose: this is a per-device
 * convenience, not a fact anything queries, and it needs no migration. Every
 * access is guarded — a private window, disabled site data, or a browser that
 * throws on access must degrade to the workspace default, never to a crash.
 */

const keyFor = (workspaceId: string) => `zenhance:lens:${workspaceId}`;

/** My saved view for this workspace, or null if I have never set one. */
export function readMyView(workspaceId: string): Lens | null {
  if (!workspaceId) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(workspaceId));
    if (!raw) return null;
    // normalizeLens degrades per field, so a blob written by an older or newer
    // build can never cost the user the settings this build still understands.
    return normalizeLens(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeMyView(workspaceId: string, lens: Lens): void {
  if (!workspaceId) return;
  try {
    window.localStorage.setItem(keyFor(workspaceId), JSON.stringify(lens));
  } catch {
    /* storage unavailable — the lens still applies for this session */
  }
}

/** Drop my override so this workspace's default takes over again. */
export function clearMyView(workspaceId: string): void {
  if (!workspaceId) return;
  try {
    window.localStorage.removeItem(keyFor(workspaceId));
  } catch {
    /* nothing to do — the caller resets its state either way */
  }
}

/** Field-wise equality. Two lenses that differ in no field are the same view. */
export function sameLens(a: Lens, b: Lens): boolean {
  return a.colorBy === b.colorBy && a.labelBy === b.labelBy;
}

/**
 * What the canvas should open with: my view if I have one, else the
 * workspace's default. A stored view identical to the default is treated as
 * no override at all, so the "just for me" state can't get stuck on.
 */
export function resolveOpeningLens(
  workspaceId: string,
  workspaceDefault: Lens,
): { lens: Lens; isMine: boolean } {
  const mine = readMyView(workspaceId);
  if (!mine || sameLens(mine, workspaceDefault)) {
    return { lens: workspaceDefault ?? DEFAULT_LENS, isMine: false };
  }
  return { lens: mine, isMine: true };
}
