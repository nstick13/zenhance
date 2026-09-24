export type Point = { x: number; y: number };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * One geographic camera, with at most one extra semantic tier around a local
 * field. The field never changes camera scale or master geography.
 */
export function effectiveSemanticScale(
  baseScale: number,
  distancePx: number,
  radiusPx = 240,
  maxBoost = 0.62,
): number {
  if (!Number.isFinite(distancePx) || radiusPx <= 0) return baseScale;
  const t = clamp01(1 - distancePx / radiusPx);
  const influence = t * t * (3 - 2 * t);
  return baseScale + maxBoost * influence;
}

/**
 * Broad-brush headcount sizing. The input is compressed, converted to a
 * product-tuned index, then interpolated as screen area before deriving the
 * radius. Exact counts remain text, never an area-reading exercise.
 */
export function overviewMarkRadius(headcount: number, master = false): number {
  const minimum = 3.2;
  const maximum = 17;
  const referenceHeadcount = 1_000;
  const compressed = Math.log1p(Math.max(0, headcount)) / Math.log1p(referenceHeadcount);
  const sizeIndex = clamp01(compressed) ** 0.72;
  const area = Math.PI * minimum ** 2 +
    (Math.PI * maximum ** 2 - Math.PI * minimum ** 2) * sizeIndex;
  const radius = Math.sqrt(area / Math.PI);
  return Math.max(master ? 12 : minimum, Math.min(maximum, radius));
}

export type VisibilityCandidate = {
  id: string;
  parentId: string | null;
  depth: number;
  headcount: number;
  distancePx: number;
  onRoute?: boolean;
  selected?: boolean;
  root?: boolean;
};

/** A viewport/detail budget, deliberately bounded for old tablets/laptops. */
export function structureBudget(viewportArea: number, baseScale: number): number {
  const screenAllowance = Math.max(0, Math.min(70, Math.round(viewportArea / 18_000)));
  const detailAllowance = Math.max(0, Math.min(90, Math.round(baseScale * 34)));
  return Math.max(24, Math.min(180, 24 + screenAllowance + detailAllowance));
}

/**
 * Spend the structural budget on roots, the selected route, local territory
 * and large branches. Adding a candidate also adds its ancestor route, so an
 * ordinary descendant never appears without a way home.
 */
export function pickVisibleStructure(
  candidates: VisibilityCandidate[],
  budget: number,
): Set<string> {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const score = (candidate: VisibilityCandidate) => {
    if (candidate.root) return 1_000_000_000;
    if (candidate.selected) return 900_000_000;
    if (candidate.onRoute) return 800_000_000 - candidate.depth;
    const local = Math.max(0, 260 - candidate.distancePx) * 8_000;
    const size = Math.log1p(Math.max(0, candidate.headcount)) * 24_000;
    const shallow = Math.max(0, 24 - candidate.depth) * 2_000;
    return local + size + shallow;
  };
  const ordered = [...candidates].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const visible = new Set<string>();

  for (const candidate of ordered) {
    const route: string[] = [];
    let current: VisibilityCandidate | undefined = candidate;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!visible.has(current.id)) route.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const forced = !!(candidate.root || candidate.selected || candidate.onRoute);
    if (!forced && visible.size + route.length > Math.max(1, budget)) continue;
    for (const id of route.reverse()) visible.add(id);
  }
  return visible;
}

const isDescendant = (id: string, ancestorId: string, parentById: Record<string, string | null>): boolean => {
  let current: string | null | undefined = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === ancestorId) return true;
    seen.add(current);
    current = parentById[current];
  }
  return false;
};

export function basketOwner(
  basketIds: string[],
  nodeId: string,
  parentById: Record<string, string | null>,
): string | null {
  return basketIds.find((entryId) => isDescendant(nodeId, entryId, parentById)) ?? null;
}

export function addBasketEntry(
  basketIds: string[],
  nodeId: string,
  parentById: Record<string, string | null>,
): { ids: string[]; absorbed: string[]; owner: string | null } {
  const owner = basketOwner(basketIds, nodeId, parentById);
  if (owner) return { ids: basketIds, absorbed: [], owner };
  const absorbed = basketIds.filter((entryId) => isDescendant(entryId, nodeId, parentById));
  return {
    ids: [...basketIds.filter((entryId) => !absorbed.includes(entryId)), nodeId],
    absorbed,
    owner: null,
  };
}

const signedAngle = (angle: number, origin: number) =>
  Math.atan2(Math.sin(angle - origin), Math.cos(angle - origin));

/**
 * Open a gap at the pointer by easing only neighbours that actually collide
 * with it. The returned angles are both the live preview and the committed
 * answer, so release cannot produce a second layout jump.
 */
export function insertionAngles(
  siblings: { id: string; angle: number }[],
  draggedId: string,
  targetAngle: number,
  minimumSeparation: number,
): Record<string, number> {
  const ordered = siblings
    .filter((sibling) => sibling.id !== draggedId)
    .map((sibling) => ({ ...sibling, unwrapped: targetAngle + signedAngle(sibling.angle, targetAngle) }))
    .sort((a, b) => a.unwrapped - b.unwrapped);
  const split = ordered.findIndex((sibling) => sibling.unwrapped > targetAngle);
  const insertion = split < 0 ? ordered.length : split;
  const next: Record<string, number> = { [draggedId]: targetAngle };

  let boundary = targetAngle - minimumSeparation;
  for (let index = insertion - 1; index >= 0; index--) {
    const sibling = ordered[index]!;
    if (sibling.unwrapped <= boundary) break;
    next[sibling.id] = boundary;
    boundary -= minimumSeparation;
  }

  boundary = targetAngle + minimumSeparation;
  for (let index = insertion; index < ordered.length; index++) {
    const sibling = ordered[index]!;
    if (sibling.unwrapped >= boundary) break;
    next[sibling.id] = boundary;
    boundary += minimumSeparation;
  }
  return next;
}

export type EnvelopeDisc = Point & { r: number };

/** Convex structural territory sampled from unit discs, never people/work. */
export function structuralEnvelope(discs: EnvelopeDisc[], padding = 42): Point[] {
  const samples = discs.flatMap((disc) => Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    const radius = disc.r + padding;
    return { x: disc.x + Math.cos(angle) * radius, y: disc.y + Math.sin(angle) * radius };
  }));
  if (samples.length <= 2) return samples;
  const points = [...samples].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...points].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export function smoothEnvelopePath(points: Point[]): string {
  if (points.length < 3) return '';
  const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = midpoint(points.at(-1)!, points[0]!);
  const commands = [`M ${start.x} ${start.y}`];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const end = midpoint(point, next);
    commands.push(`Q ${point.x} ${point.y} ${end.x} ${end.y}`);
  });
  commands.push('Z');
  return commands.join(' ');
}
