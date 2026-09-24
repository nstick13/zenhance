/**
 * When is a company too big for one set of rings? (Greg, 2026-09-21)
 *
 * Not a headcount. A 400-person company that is four levels deep reads fine on
 * rings; a 150-person one that is eleven levels deep might not. The question
 * the map actually has to answer is visual: *from the whole-company view, how
 * far must you zoom in before a unit's name can be read?* If that is a short
 * step, the rings hold their context and stay. If it is a long way, the rings
 * have become a giant target — and if drawing each branch locally genuinely
 * fits the company better, the map switches to local branch geography.
 *
 * Measured against a fixed reference screen — the five-year-old entry iPad
 * AGENTS.md sets as the bar — never the live window, so resizing a browser
 * can't flip the drawing, and the same company always gets the same map.
 *
 * Calibration on representative shapes (reference screen, 2026-09-22):
 *
 *   company (deepOrg.ts shapes)     ring zoom-to-read   local fits…    result
 *   Sparrow Jam, 10 people          1.1×                —              rings
 *   Digital Tailoring, 45           2.3×                —              rings
 *   150 people, 5 levels            4.0×                —              rings
 *   400 people, 7 levels            8.6×                1.15× better   rings
 *   1,000 people, 9 levels          28×                 2.4× better    local
 *   2,562 people, 12 levels         91×                 5.1× better    local
 *   ~6,000 people, 13 levels        229×                6.1× better    local
 */
import { fanFor } from "@/lib/map/layout/branches";
import { layoutOrbitalForest } from "@/lib/map/layout/forest";
import type { Geography, OrbitalScene } from "@/lib/map/layout/layout";
import type { LayoutOptions } from "@/lib/map/layout/layout";
import type { OrbitalTree } from "@/lib/map/layout/model";

export const REFERENCE_VIEWPORT = { width: 1024, height: 768 } as const;
/** Unit names begin to read from here (lod.unitLabelVisible). */
export const READABLE_SCALE = 0.7;
/** More than this many times zoom from whole-company to readable, and the
 *  rings are no longer holding their context. */
export const MAX_ZOOM_TO_READ = 6;
/** Local geography must fit the company at least this much larger to be
 *  worth changing how the company is drawn. */
export const LOCAL_MUST_WIN_BY = 1.5;
/**
 * Past this, the ring map is not "less good" — it has stopped working, and
 * the margin test stops being the right question.
 *
 * The guard above exists so a company does not change drawing for a marginal
 * gain. But a company needing seventy times zoom to read a name on its rings
 * cannot be navigated on them at any margin, and since 2026-09-24 the local
 * drawing is deliberately *less* compact — tight fans that run one way, so a
 * branch's direction tells you where you are (Greg: "master/centre on the
 * left and the detail toward the right"). It buys legibility of structure,
 * not area. So above this line, local geography needs only to be better, not
 * better by half.
 */
export const RINGS_HOPELESS = 30;
/** The zoom range over which local branches are allowed to become radially
 * loose. Log space is deliberate: 2x→4x is the same perceptual step as
 * 20x→40x, while a raw headcount would say nothing about the drawing. */
export const LOOSE_FROM_ZOOM = 2;
export const FULLY_LOOSE_ZOOM = 64;

/**
 * Whether children may leave their parent's circle.
 *
 * Off on 2026-09-23, back on 2026-09-24. The reason it went off was Greg's
 * "those orbits seem to be inconsistent, some of them quite elliptical" — which
 * he has since clarified was about the **reparent interaction ring**, not about
 * where children sit. What he wants from the children is the opposite: *"make
 * use of variable connection line lengths where needed, and by default try to
 * fan out more tightly, rather than splaying in such a way that they are
 * equidistantly distributed around the parent node."*
 *
 * The three link crossings that variation used to cause are fixed at the
 * source: a child may now only come inward while its branch still fits the
 * angular slot it was given (branches.ts). Bounded that way, variation buys
 * about a third of the company's extent and costs nothing.
 */
export const ALLOW_RADIAL_LOOSENESS = true;
/** Breathing room a fitted view leaves at its edges. */
export const FIT_MARGIN = 1.06;

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** The settled structural extent of a scene: its own bounds when it has them,
 *  otherwise the circle every ring scene is drawn inside. */
export function sceneBounds(scene: OrbitalScene): Bounds {
  if (scene.bounds) return scene.bounds;
  const r = scene.extent + 60;
  return { minX: -r, minY: -r, maxX: r, maxY: r };
}

export function fitScaleFor(bounds: Bounds, viewport: { width: number; height: number }): number {
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  return Math.min(viewport.width / (w * FIT_MARGIN), viewport.height / (h * FIT_MARGIN));
}

export function zoomToRead(scene: OrbitalScene): number {
  return READABLE_SCALE / fitScaleFor(sceneBounds(scene), REFERENCE_VIEWPORT);
}

/** 0..1 visual complexity for spatial decisions. This is derived from the
 * same fixed-viewport legibility measurement that chooses geography, never
 * from employee count or the live browser size. */
export function visualComplexity(ringZoomToRead: number): number {
  if (!Number.isFinite(ringZoomToRead) || ringZoomToRead <= LOOSE_FROM_ZOOM) return 0;
  const lo = Math.log(LOOSE_FROM_ZOOM);
  const hi = Math.log(FULLY_LOOSE_ZOOM);
  return Math.min(1, Math.max(0, (Math.log(ringZoomToRead) - lo) / (hi - lo)));
}

/** What the layout actually receives — see ALLOW_RADIAL_LOOSENESS. */
const loosenessFor = (ringZoomToRead: number) =>
  ALLOW_RADIAL_LOOSENESS ? visualComplexity(ringZoomToRead) : 0;

/** Everything the local layout takes from the same one measurement. */
const localOptions = (ringZoom: number) => ({
  radialLooseness: loosenessFor(ringZoom),
  fan: fanFor(visualComplexity(ringZoom)),
});

export type GeographyChoice = {
  geography: Geography;
  ringZoomToRead: number;
  /** Bounded complexity used by local radial variation. */
  radialLooseness: number;
  /** Only measured when the rings failed their test. */
  localZoomToRead: number | null;
};

/** Decide how to draw a company, and hand back the scene for that decision.
 *  Pure and deterministic: the same tree always gets the same drawing.
 *
 *  `preview` forces a drawing regardless of the test. It exists so the local
 *  geography can be looked at on the small invented demo companies (no large
 *  one exists any more); the caller must only ever pass it for those. */
export function layoutCompany(
  tree: OrbitalTree,
  options: LayoutOptions = {},
  preview?: Geography,
): { scene: OrbitalScene; choice: GeographyChoice } {
  if (preview === "local") {
    // Even a forced preview keeps the real company's complexity. This makes
    // Sparrow stay calm and circular while still exercising the local path.
    const ring = layoutOrbitalForest(tree, options);
    const ringZoom = zoomToRead(ring);
    const local = layoutOrbitalForest(tree, {
      ...options,
      geography: "local",
      ...localOptions(ringZoom),
    });
    return { scene: local, choice: {
      geography: "local",
      ringZoomToRead: ringZoom,
      radialLooseness: loosenessFor(ringZoom),
      localZoomToRead: zoomToRead(local),
    } };
  }
  const ring = layoutOrbitalForest(tree, options);
  const ringZoom = zoomToRead(ring);
  if (ringZoom <= MAX_ZOOM_TO_READ) {
    return { scene: ring, choice: {
      geography: "orbital",
      ringZoomToRead: ringZoom,
      radialLooseness: loosenessFor(ringZoom),
      localZoomToRead: null,
    } };
  }
  const local = layoutOrbitalForest(tree, {
    ...options,
    geography: "local",
    ...localOptions(ringZoom),
  });
  const localZoom = zoomToRead(local);
  // Past RINGS_HOPELESS there is nothing left to compare: a company needing
  // seventy times zoom to read a name on its rings cannot be navigated on
  // them at any margin, and the local drawing is deliberately not competing
  // on area — it spends room on short connections and tight fans so that
  // where a branch runs tells you where you are. Below that line the margin
  // still guards against changing drawing for a marginal gain.
  const geography: Geography = ringZoom > RINGS_HOPELESS
    ? "local"
    : ringZoom / localZoom >= LOCAL_MUST_WIN_BY ? "local" : "orbital";
  return {
    scene: geography === "local" ? local : ring,
    choice: {
      geography,
      ringZoomToRead: ringZoom,
      radialLooseness: loosenessFor(ringZoom),
      localZoomToRead: localZoom,
    },
  };
}
