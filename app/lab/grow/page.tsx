'use client';

/* ------------------------------------------------------------------------ *
 * Lab · "grow" — the first team
 *
 * A feel study for the blank-canvas start. Nothing here touches the DB, auth
 * or any production component (see docs/LAB.md). All state is React state:
 * a hard refresh wipes it, deliberately.
 *
 * The conceit: an organisation is grown one node at a time, and the *team*
 * is not something you declare — it's what appears the moment you say the
 * first person has someone to work with.
 *
 * Beyond that first team the map is a FOREST, not a tree: separate teams sit
 * side by side as unconnected islands, because at this stage nobody has said
 * how they relate. A parent is something you add when you're ready, never a
 * thing the map demands.
 *
 * Rendered as SVG, not Konva. Three to a dozen nodes don't need a canvas.
 * Shapes live in the scaled camera layer; labels are drawn in screen space on
 * top, so text stays the same size however far the map has zoomed out.
 * ------------------------------------------------------------------------ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* --- paper palette (mirrors app/globals.css @theme static) --------------- */
const PAPER = '#f6f4ee';
const SURFACE = '#ffffff';
const INK = '#22272e';
const INK_SOFT = '#5c6570';
const LINE = '#e4e0d6';
const TEAM_HUE = '#2f6f6a';

/* --- geometry ------------------------------------------------------------ */
const PERSON_R = 40;
const TEAM_R = 52;
const SEED_R = 50;
const SOLO_ADD_R = 150;
/** Clear air between a node and the subtree standing on its ring. */
const GAP = 46;
/** Breathing room between two neighbours on the same ring. */
const PAD = 30;
/** Gap between two islands when they're tidied into a row. */
const ISLAND_GAP = 110;
/** Width of the invisible band around a ring that answers the pointer. */
const RING_BAND = 30;

/* --- sample data (invented — house rule: no real people in fixtures) ----- */
const SAMPLE_NAMES = ['Ana Whitfield', 'Marcus Reyn', 'Priya Solanki', 'Tom Okafor', 'Lena Brandt', 'Sam Ellery'];

const ROLES = [
  'Software Engineer',
  'Engineering Manager',
  'Product Manager',
  'Product Designer',
  'QA Engineer',
  'Data Analyst',
  'DevOps Engineer',
  'Business Analyst',
  'Delivery Lead',
];

const ROLE_COLOR: Record<string, string> = {
  'Software Engineer': '#3b6ea5',
  'Engineering Manager': '#6b5b95',
  'Product Manager': '#8a5cc4',
  'Product Designer': '#c2632b',
  'QA Engineer': '#2f8f6b',
  'Data Analyst': '#1f7a8c',
  'DevOps Engineer': '#4a7c2f',
  'Business Analyst': '#a6683c',
  'Delivery Lead': '#5b7a99',
};
const roleColor = (role: string | null) => (role && ROLE_COLOR[role]) || '#8b94a0';

const TEAM_NAMES = ['Checkout', 'Onboarding', 'Payments Platform', 'Search', 'Mobile Apps', 'Customer Portal'];
const PARENT_NAMES = ['Commerce', 'Customer Platform', 'Core Services', 'Digital', 'Group Technology'];

const TEAM_PURPOSES = [
  'Taking payment and finishing the order',
  'Getting a new customer up and running',
  'Keeping the platform running',
  'Finding and browsing products',
  'The phone and tablet experience',
  'Reporting and insight for the business',
];

/* --- model --------------------------------------------------------------- */
type Kind = 'person' | 'team';

type Node = {
  id: string;
  kind: Kind;
  parentId: string | null;
  name: string | null;
  role: string | null; // person
  purpose: string | null; // team
};

/** Where a node is drawn, and how far it has arrived (0→1). */
type Motion = { x: number; y: number; a: number };
type Target = Motion;

/** One published animation frame — everything render needs, and nothing else. */
type Frame = {
  pos: Record<string, Motion>;
  k: number;
  tx: number;
  ty: number;
  busy: boolean;
};

let seq = 0;
const nid = (k: Kind) => `${k}-${++seq}`;

const nodeR = (n: Node) => (n.kind === 'team' ? TEAM_R : PERSON_R);

/** A node is "done" when it has everything the map needs to describe it. */
const isComplete = (n: Node) =>
  n.kind === 'team' ? !!n.name?.trim() && !!n.purpose : !!n.name?.trim() && !!n.role;

/** What this node is still missing, in the user's words. */
function missingLabel(n: Node): string | null {
  if (!n.name?.trim()) return 'Needs a name';
  if (n.kind === 'team' && !n.purpose) return 'Needs a purpose';
  if (n.kind === 'person' && !n.role) return 'Needs a role';
  return null;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/* --- layout -------------------------------------------------------------- */

type Layout = {
  pos: Record<string, { x: number; y: number }>;
  /** Radius of the ring a node's children stand on. Teams always have one. */
  ring: Record<string, number>;
  /** How far a node's whole subtree reaches from its centre. */
  reach: Record<string, number>;
  roots: Node[];
  kids: Record<string, Node[]>;
};

/**
 * Rings are sized by what stands on them, not by depth. Adding a parent
 * therefore grows the map outwards rather than shrinking everything inside it
 * — which is what keeps a three-deep org readable instead of turning the
 * people into specks.
 */
function buildLayout(nodes: Node[], pinned: Record<string, { x: number; y: number }>): Layout {
  const byId: Record<string, Node> = {};
  const kids: Record<string, Node[]> = {};
  const roots: Node[] = [];
  for (const n of nodes) {
    byId[n.id] = n;
    if (n.parentId === null) roots.push(n);
    else (kids[n.parentId] ||= []).push(n);
  }

  const ring: Record<string, number> = {};
  const reach: Record<string, number> = {};

  const measure = (id: string): number => {
    const n = byId[id]!;
    const ch = kids[id] ?? [];
    const r = nodeR(n);

    if (ch.length === 0) {
      // An empty team still draws the orbit it could hold — that ring is how
      // you add to it, so it has to exist before there's anything on it.
      if (n.kind === 'team') {
        ring[id] = r + PERSON_R + GAP;
        return (reach[id] = ring[id]!);
      }
      return (reach[id] = r);
    }

    const childReach = ch.map((c) => measure(c.id));
    const widest = Math.max(...childReach);
    // Clear this node and the deepest child...
    const clearance = r + widest + GAP;
    // ...and be long enough round for every child to stand side by side.
    const circumference = ch.length * (2 * widest + PAD);
    ring[id] = Math.max(clearance, circumference / (2 * Math.PI));
    return (reach[id] = ring[id]! + widest);
  };

  const pos: Record<string, { x: number; y: number }> = {};
  /**
   * `facing` is the direction this node was reached from. Children are spread
   * around it, so a subtree fans away from its grandparent instead of folding
   * back over it — placing every ring's first child at a fixed angle put a
   * whole three-deep org on one straight line.
   */
  const place = (id: string, x: number, y: number, facing: number) => {
    // A node the user has put somewhere stays put, and its children keep
    // orbiting it from there. "Tidy up" is what gives these back.
    const at = pinned[id];
    const px = at ? at.x : x;
    const py = at ? at.y : y;
    pos[id] = { x: px, y: py };
    const ch = kids[id] ?? [];
    if (!ch.length) return;
    const R = ring[id]!;
    const spread = (2 * Math.PI) / ch.length;
    ch.forEach((c, i) => {
      const a = facing + (i - (ch.length - 1) / 2) * spread;
      place(c.id, px + Math.cos(a) * R, py + Math.sin(a) * R, a);
    });
  };

  for (const root of roots) {
    measure(root.id);
    // Facing "up" means the first two children land left and right of the
    // centre — the "alongside" reading the first team is built around.
    place(root.id, 0, 0, -Math.PI / 2);
  }

  return { pos, ring, reach, roots, kids };
}

/** Every node at or below `id`. Nothing may be dropped inside its own subtree
 *  — that would cut the subtree off the map entirely (see lib/orbital/snap.ts). */
function descendantIds(kids: Record<string, Node[]>, id: string): Set<string> {
  const out = new Set<string>([id]);
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of kids[cur] ?? []) {
      if (out.has(c.id)) continue;
      out.add(c.id);
      stack.push(c.id);
    }
  }
  return out;
}

/**
 * What a drop would mean, read off where the node was let go — the same two
 * questions the production map asks (lib/orbital/snap.ts): how far out you
 * are says which level, and which orbit you are on says whose child you'd be.
 * Here the rungs aren't global — each island has its own — so "the ring you
 * landed on" answers both at once.
 *
 * Land nowhere near a ring and this returns null: the node has simply been
 * moved, and nothing about the org has changed.
 */
const RING_CATCH = 46;

function classifyDrop(
  layout: Layout,
  draggedId: string,
  at: { x: number; y: number },
): { parentId: string; distance: number } | null {
  const blocked = descendantIds(layout.kids, draggedId);
  let best: { parentId: string; distance: number } | null = null;
  for (const [id, R] of Object.entries(layout.ring)) {
    if (blocked.has(id)) continue;
    const c = layout.pos[id];
    if (!c) continue;
    const off = Math.abs(Math.hypot(at.x - c.x, at.y - c.y) - R);
    if (off > RING_CATCH) continue;
    if (!best || off < best.distance) best = { parentId: id, distance: off };
  }
  return best;
}

/** Two circles drawn as one blob of liquid, for the moment before a merge. */
function metaballPath(
  a: { x: number; y: number; r: number },
  b: { x: number; y: number; r: number },
): string | null {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const d = Math.hypot(vx, vy);
  if (d === 0 || d <= Math.abs(a.r - b.r)) return null;
  if (d > (a.r + b.r) * 2.2) return null;

  const V = 0.5;
  const HANDLE = 2.4;
  let u1 = 0;
  let u2 = 0;
  if (d < a.r + b.r) {
    u1 = Math.acos(Math.min(1, Math.max(-1, (a.r * a.r + d * d - b.r * b.r) / (2 * a.r * d))));
    u2 = Math.acos(Math.min(1, Math.max(-1, (b.r * b.r + d * d - a.r * a.r) / (2 * b.r * d))));
  }
  const between = Math.atan2(vy, vx);
  const maxSpread = Math.acos(Math.min(1, Math.max(-1, (a.r - b.r) / d)));

  const a1 = between + u1 + (maxSpread - u1) * V;
  const a2 = between - u1 - (maxSpread - u1) * V;
  const a3 = between + Math.PI - u2 - (Math.PI - u2 - maxSpread) * V;
  const a4 = between - Math.PI + u2 + (Math.PI - u2 - maxSpread) * V;

  const pt = (c: { x: number; y: number }, ang: number, r: number) => ({
    x: c.x + Math.cos(ang) * r,
    y: c.y + Math.sin(ang) * r,
  });
  const p1 = pt(a, a1, a.r);
  const p2 = pt(a, a2, a.r);
  const p3 = pt(b, a3, b.r);
  const p4 = pt(b, a4, b.r);

  const total = a.r + b.r;
  const base = Math.min(V * HANDLE, Math.hypot(p3.x - p1.x, p3.y - p1.y) / total);
  const f = base * Math.min(1, (d * 2) / total);
  const h1 = a.r * f;
  const h2 = b.r * f;

  const c1 = pt(p1, a1 - Math.PI / 2, h1);
  const c2 = pt(p3, a3 + Math.PI / 2, h2);
  const c3 = pt(p4, a4 - Math.PI / 2, h2);
  const c4 = pt(p2, a2 + Math.PI / 2, h1);

  return [
    `M ${p1.x} ${p1.y}`,
    `C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p3.x} ${p3.y}`,
    `A ${b.r} ${b.r} 0 0 0 ${p4.x} ${p4.y}`,
    `C ${c3.x} ${c3.y} ${c4.x} ${c4.y} ${p2.x} ${p2.y}`,
    `A ${a.r} ${a.r} 0 0 0 ${p1.x} ${p1.y}`,
    'Z',
  ].join(' ');
}

/** A copy of the pin map with these ids dropped — they go back on their ring. */
const without = (m: Record<string, { x: number; y: number }>, ...ids: string[]) => {
  const out = { ...m };
  for (const id of ids) delete out[id];
  return out;
};

/* --- callout placement --------------------------------------------------- */
type Side = 'right' | 'left' | 'below' | 'above' | 'sheet';
type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Put the callout where it hides the least. A box pinned to one side always
 * ends up over a neighbour once the ring fills in — a team sits between two
 * people, so "always to the right" covers one of them.
 */
function placeCallout(
  node: { x: number; y: number; r: number },
  others: Rect[],
  cw: number,
  ch: number,
  vw: number,
  vh: number,
): { rect: Rect; side: Side; tail: number } {
  if (vw < 560) {
    // Phone: a sheet along the bottom beats a box that fills the screen.
    return { rect: { x: 12, y: vh - ch - 12, w: vw - 24, h: ch }, side: 'sheet', tail: 0 };
  }

  const G = 26;
  // The title sits top-left and the buttons top-right; nothing may be placed
  // under that strip.
  const TOP = 58;
  const candidates: { side: Side; rect: Rect }[] = [
    { side: 'right', rect: { x: node.x + node.r + G, y: node.y - ch / 2, w: cw, h: ch } },
    { side: 'left', rect: { x: node.x - node.r - G - cw, y: node.y - ch / 2, w: cw, h: ch } },
    { side: 'below', rect: { x: node.x - cw / 2, y: node.y + node.r + G + 18, w: cw, h: ch } },
    { side: 'above', rect: { x: node.x - cw / 2, y: node.y - node.r - G - ch, w: cw, h: ch } },
  ];

  let best = candidates[0]!;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    const clipped =
      Math.max(0, 12 - c.rect.x) +
      Math.max(0, c.rect.x + c.rect.w - (vw - 12)) +
      Math.max(0, TOP - c.rect.y) +
      Math.max(0, c.rect.y + c.rect.h - (vh - 12));
    const hidden = others.filter((o) => overlaps(c.rect, o)).length;
    const score = hidden * 1000 + clipped * 2 + i;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  });

  const rect = {
    ...best.rect,
    x: Math.max(12, Math.min(vw - cw - 12, best.rect.x)),
    y: Math.max(TOP, Math.min(vh - ch - 12, best.rect.y)),
  };
  const tail =
    best.side === 'right' || best.side === 'left'
      ? Math.max(18, Math.min(ch - 30, node.y - rect.y))
      : Math.max(18, Math.min(cw - 30, node.x - rect.x));

  return { rect, side: best.side, tail };
}

/* --- wizard shape -------------------------------------------------------- */
type Step =
  | { key: 'name'; title: string; kind: 'text'; placeholder: string; suggestions: string[] }
  | { key: 'role' | 'purpose'; title: string; kind: 'select'; placeholder: string; options: string[] }
  | { key: 'teammates'; title: string; kind: 'choice'; options: { value: 'yes' | 'no'; label: string; hint: string }[] };

function stepsFor(node: Node, isLoneRoot: boolean, isParent: boolean): Step[] {
  if (node.kind === 'team') {
    return [
      {
        key: 'name',
        title: isParent ? 'What sits above it?' : 'What is this team called?',
        kind: 'text',
        placeholder: isParent ? 'Its name' : 'Team name',
        suggestions: isParent ? PARENT_NAMES : TEAM_NAMES,
      },
      {
        key: 'purpose',
        title: 'What does it deliver?',
        kind: 'select',
        placeholder: 'Pick what this is for',
        options: TEAM_PURPOSES,
      },
    ];
  }
  const base: Step[] = [
    { key: 'name', title: 'Who is this?', kind: 'text', placeholder: 'Their name', suggestions: SAMPLE_NAMES },
    { key: 'role', title: 'What do they do?', kind: 'select', placeholder: 'Pick a role', options: ROLES },
  ];
  if (!isLoneRoot) return base;
  return [
    ...base,
    {
      key: 'teammates',
      title: 'Does this person have any teammates?',
      kind: 'choice',
      options: [
        { value: 'yes', label: 'Yes — they work with others', hint: 'We will open up their team around them' },
        { value: 'no', label: 'Not yet — just them', hint: 'You can add teammates at any time' },
      ],
    },
  ];
}

/**
 * Labels are drawn at a fixed size, so the further the map zooms out the more
 * they crowd. Rather than let names pile on top of each other, drop the role
 * line first and the whole label only if it still won't fit. Shallower nodes
 * are laid down first, so the big picture survives and the detail gives way.
 */
type LabelPlan = { id: string; showSub: boolean };

function declutter(
  items: { id: string; x: number; y: number; depth: number; title: string; sub: string; titleSize: number }[],
): Record<string, LabelPlan> {
  const box = (it: (typeof items)[number], withSub: boolean): Rect => {
    const w = Math.max(it.title.length * it.titleSize * 0.56, withSub ? it.sub.length * 6.2 : 0);
    return { x: it.x - w / 2, y: it.y - it.titleSize, w, h: withSub ? 34 : 18 };
  };
  const placed: Rect[] = [];
  const out: Record<string, LabelPlan> = {};
  for (const it of [...items].sort((a, b) => a.depth - b.depth || a.x - b.x)) {
    const full = box(it, !!it.sub);
    if (!placed.some((q) => overlaps(q, full))) {
      placed.push(full);
      out[it.id] = { id: it.id, showSub: !!it.sub };
      continue;
    }
    const slim = box(it, false);
    if (!placed.some((q) => overlaps(q, slim))) {
      placed.push(slim);
      out[it.id] = { id: it.id, showSub: false };
    }
    // else: no room at all — this name sits out until the map has space.
  }
  return out;
}

/* --- what the ring offers ------------------------------------------------ */
type RingAction = 'person' | 'parent' | 'sibling';

type DragState = {
  id: string;
  /** The camera as it was when you grabbed. Auto-fit must not move the world
   *  under the pointer mid-drag. */
  cam: { k: number; tx: number; ty: number };
  /** World point the pointer grabbed at. */
  grab: { x: number; y: number };
  /** Everything that travels with this node, at the moment it was grabbed. */
  start: Record<string, { x: number; y: number }>;
  moved: boolean;
};

/** Two teams running together, or two people deciding to become a team. */
/** Where a team made around two people should sit. */
type TeamHome = string | 'alone' | 'new';

type MergeState = {
  a: string;
  b: string;
  kind: Kind;
  stage: 'choose' | 'rename' | 'home' | 'parent';
  name: string;
};

/* ======================================================================== */

export default function GrowLab() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [pinned, setPinned] = useState<Record<string, { x: number; y: number }>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [parentJustAdded, setParentJustAdded] = useState<string | null>(null);
  const [stepIx, setStepIx] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);

  /** Where the pointer is on a ring, and whether the menu has been opened there. */
  const [hover, setHover] = useState<{ parentId: string; angle: number } | null>(null);
  const [menu, setMenu] = useState<{ parentId: string; angle: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [merge, setMerge] = useState<MergeState | null>(null);
  /** Set while two teams are visibly running together, before they become one. */
  const [coalescing, setCoalescing] = useState<{ a: string; b: string } | null>(null);
  const [moveAsk, setMoveAsk] = useState<{ id: string; parentId: string } | null>(null);

  const shellRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  /* --- viewport ---------------------------------------------------------- */
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(320, r.height) });
    };
    // Measure straight away rather than waiting to be told: a ResizeObserver
    // can be throttled or never deliver its first callback (a backgrounded
    // tab, an embedded view), and the whole map is centred off this number.
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    // `?still=1` forces the reduced-motion rendering, so the calm version can
    // be reviewed without anyone changing their OS settings.
    const forced = new URLSearchParams(window.location.search).has('still');
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(forced || mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  /* --- derived ----------------------------------------------------------- */
  const layout = useMemo(() => buildLayout(nodes, pinned), [nodes, pinned]);

  /** How many rungs out from its island's centre a node sits. */
  const depthOf = useMemo(() => {
    const out: Record<string, number> = {};
    const walk = (id: string, d: number) => {
      out[id] = d;
      for (const c of layout.kids[id] ?? []) walk(c.id, d + 1);
    };
    for (const r of layout.roots) walk(r.id, 0);
    return out;
  }, [layout]);

  /** Everyone anywhere beneath a node — a parent counts its whole subtree. */
  const headcount = useMemo(() => {
    const out: Record<string, number> = {};
    const walk = (id: string): number => {
      const kids = layout.kids[id] ?? [];
      let n = 0;
      for (const c of kids) n += c.kind === 'person' ? 1 + walk(c.id) : walk(c.id);
      return (out[id] = n);
    };
    for (const r of layout.roots) walk(r.id);
    return out;
  }, [layout]);
  const byId = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])), [nodes]);
  const people = nodes.filter((n) => n.kind === 'person');
  const teams = nodes.filter((n) => n.kind === 'team');
  const needsData = nodes.some((n) => !isComplete(n));

  /** The lone-person start still gets its own "+": there is no ring yet. */
  const soloRoot =
    layout.roots.length === 1 && layout.roots[0]!.kind === 'person' && nodes.length === 1
      ? layout.roots[0]!
      : null;
  const showSoloAdd = !!soloRoot && isComplete(soloRoot) && !openId;

  /** The floating "+" on a ring: wherever the pointer is, or wherever the menu was opened. */
  const plus = menu ?? hover;

  /* --- targets ----------------------------------------------------------- */
  const targets = useMemo(() => {
    const t: Record<string, Target> = {};
    for (const n of nodes) {
      const p = layout.pos[n.id];
      if (p) t[n.id] = { x: p.x, y: p.y, a: 1 };
    }
    if (soloRoot && showSoloAdd) {
      const p = layout.pos[soloRoot.id]!;
      t.__solo = { x: p.x + SOLO_ADD_R, y: p.y, a: 1 };
    }
    if (plus) {
      const c = layout.pos[plus.parentId];
      const R = layout.ring[plus.parentId];
      if (c && R) t.__plus = { x: c.x + Math.cos(plus.angle) * R, y: c.y + Math.sin(plus.angle) * R, a: 1 };
    }
    return t;
  }, [nodes, layout, plus, soloRoot, showSoloAdd]);

  /* --- camera: frame the whole forest ------------------------------------ */
  const cameraFit = useMemo(() => {
    if (!size.w) return { k: 1, tx: 0, ty: 0 };
    if (!nodes.length) return { k: 1, tx: size.w / 2, ty: size.h / 2 };

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const grow = (x: number, y: number, r: number) => {
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    };
    for (const n of nodes) {
      const p = layout.pos[n.id];
      if (!p) continue;
      grow(p.x, p.y, nodeR(n));
      const R = layout.ring[n.id];
      if (R) grow(p.x, p.y, R);
    }
    if (soloRoot && showSoloAdd) {
      const p = layout.pos[soloRoot.id]!;
      grow(p.x + SOLO_ADD_R, p.y, PERSON_R);
    }

    // Labels are drawn in screen space beneath each node, so the bottom needs
    // more room than the rest.
    const mx = 76;
    const top = 76;
    const bottom = 120;
    const availW = Math.max(120, size.w - mx * 2);
    const availH = Math.max(120, size.h - top - bottom);
    const k = Math.max(0.22, Math.min(1, availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    return { k, tx: size.w / 2 - cx * k, ty: (top + (size.h - bottom)) / 2 - cy * k };
  }, [nodes, layout, size, soloRoot, showSoloAdd]);

  // Auto-fit is frozen for the duration of a drag: the world must not zoom or
  // slide under the pointer while you are holding something.
  const camera = drag ? drag.cam : cameraFit;

  // On a phone the wizard is a sheet across the bottom, so the map steps up
  // out of its way rather than being half-covered by it.
  const sheetMode = size.w < 560;
  const camTy = camera.ty - (sheetMode && (openId || menu) ? Math.min(150, size.h * 0.18) : 0);

  /** The node being dragged and everything under it — these follow the pointer
   *  exactly rather than easing after it, or the drag feels like elastic. */
  const dragFamily = useMemo(
    () => (drag ? descendantIds(layout.kids, drag.id) : null),
    [drag, layout],
  );

  /* --- motion (one rAF loop; stops when everything has settled) ---------- */
  const motion = useRef<Record<string, Motion>>({});
  const cam = useRef({ k: 1, tx: 0, ty: 0 });
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const [frame, setFrame] = useState<Frame>({ pos: {}, k: 1, tx: 0, ty: 0, busy: false });

  useEffect(() => {
    if (!size.w) return;
    if (!cam.current.tx && !cam.current.ty) cam.current = { k: camera.k, tx: camera.tx, ty: camTy };

    // New things are born where their parent currently is, so they emerge
    // from the centre outwards rather than fading in mid-air.
    for (const id of Object.keys(targets)) {
      if (motion.current[id]) continue;
      // The "+" belongs to the pointer, so it appears exactly where you are
      // rather than flying out from the middle each time you brush the ring.
      const parentId = id === '__plus' ? undefined : id === '__solo' ? soloRoot?.id : byId[id]?.parentId ?? undefined;
      const from = parentId ? motion.current[parentId] : undefined;
      motion.current[id] = { x: from?.x ?? targets[id]!.x, y: from?.y ?? targets[id]!.y, a: 0 };
    }

    const publish = (busy: boolean) => {
      const pos: Record<string, Motion> = {};
      for (const [id, v] of Object.entries(motion.current)) pos[id] = { x: v.x, y: v.y, a: v.a };
      setFrame({ pos, k: cam.current.k, tx: cam.current.tx, ty: cam.current.ty, busy });
    };

    const settle = () => {
      for (const id of Object.keys(motion.current)) {
        const t = targets[id];
        if (!t) {
          delete motion.current[id];
          continue;
        }
        motion.current[id] = { ...t };
      }
      cam.current = { k: camera.k, tx: camera.tx, ty: camTy };
    };

    // requestAnimationFrame doesn't tick in a hidden or throttled tab, so the
    // map would sit at whatever half-state it was left in. Nobody is watching
    // an animation there — snap to the answer and publish it outright.
    if (typeof document !== 'undefined' && document.hidden) {
      settle();
      publish(false);
      return;
    }

    last.current = 0;
    const step = (ts: number) => {
      const dt = last.current ? Math.min(64, ts - last.current) : 16;
      last.current = ts;
      const ease = (tau: number) => (reduced ? 1 : 1 - Math.exp(-dt / tau));
      const fSlow = ease(150);
      const fFade = ease(190);
      // The "+" tracks the pointer, so it gets a much shorter leash.
      const fPlus = ease(60);

      let busy = false;
      for (const id of Object.keys(motion.current)) {
        const m = motion.current[id]!;
        const t = targets[id];
        const held = dragFamily?.has(id) ?? false;
        const fp = held ? 1 : id === '__plus' ? fPlus : fSlow;
        const fa = id === '__plus' ? fPlus : fFade;
        if (!t) {
          // Nothing wants it any more: fade it out, then drop it.
          m.a += (0 - m.a) * fa;
          if (m.a < 0.02) delete motion.current[id];
          else busy = true;
          continue;
        }
        m.x += (t.x - m.x) * fp;
        m.y += (t.y - m.y) * fp;
        m.a += (t.a - m.a) * fa;
        if (Math.hypot(t.x - m.x, t.y - m.y) > 0.4 || Math.abs(t.a - m.a) > 0.005) busy = true;
        else {
          m.x = t.x;
          m.y = t.y;
          m.a = t.a;
        }
      }

      const c = cam.current;
      c.k += (camera.k - c.k) * fSlow;
      c.tx += (camera.tx - c.tx) * fSlow;
      c.ty += (camTy - c.ty) * fSlow;
      if (Math.abs(camera.k - c.k) > 0.0008 || Math.hypot(camera.tx - c.tx, camTy - c.ty) > 0.4) busy = true;
      else cam.current = { k: camera.k, tx: camera.tx, ty: camTy };

      publish(busy);
      raf.current = busy ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [targets, camera, camTy, reduced, size.w, byId, plus?.parentId, soloRoot?.id, dragFamily]);

  const m = (id: string) => frame.pos[id] ?? { x: 0, y: 0, a: 0 };
  const k = frame.k || camera.k;
  const tx = frame.tx || camera.tx;
  const ty = frame.ty || camTy;
  const toScreen = (id: string) => ({ x: m(id).x * k + tx, y: m(id).y * k + ty });
  const worldToScreen = (p: { x: number; y: number }) => ({ x: p.x * k + tx, y: p.y * k + ty });

  /* --- actions ----------------------------------------------------------- */
  const patch = useCallback((id: string, p: Partial<Node>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...p } : n)));
  }, []);

  const closeAll = useCallback(() => {
    setOpenId(null);
    setMenu(null);
    setMoveAsk(null);
  }, []);

  const startFirstPerson = useCallback(() => {
    const p: Node = { id: nid('person'), kind: 'person', parentId: null, name: null, role: null, purpose: null };
    setNodes([p]);
    setPinned({ [p.id]: { x: 0, y: 0 } });
    setOpenId(p.id);
    setStepIx(0);
  }, []);

  /** The moment the first sequence is about: a parent and a sibling arrive together. */
  const formTeam = useCallback(() => {
    setNodes((ns) => {
      const r = ns.find((n) => n.parentId === null && n.kind === 'person');
      if (!r) return ns;
      const t: Node = { id: nid('team'), kind: 'team', parentId: null, name: null, role: null, purpose: null };
      const mate: Node = { id: nid('person'), kind: 'person', parentId: t.id, name: null, role: null, purpose: null };
      setPinned((is) => {
        const { [r.id]: at, ...rest } = is;
        return { ...rest, [t.id]: at ?? { x: 0, y: 0 } };
      });
      return [t, ...ns.map((n) => (n.id === r.id ? { ...n, parentId: t.id } : n)), mate];
    });
    closeAll();
  }, [closeAll]);

  /** Where a new island goes: clear of everything already on the paper. */
  const nextIslandSpot = useCallback(() => {
    let right = -Infinity;
    for (const root of layout.roots) {
      const p = layout.pos[root.id];
      if (p) right = Math.max(right, p.x + (layout.reach[root.id] ?? nodeR(root)));
    }
    if (right === -Infinity) return { x: 0, y: 0 };
    const newReach = TEAM_R + PERSON_R + GAP;
    // Deliberately off the line — "tidy up" is what straightens them.
    const drift = layout.roots.length % 2 === 0 ? -86 : 74;
    return { x: right + ISLAND_GAP + newReach, y: drift };
  }, [layout]);

  const ringAction = useCallback(
    (parentId: string, action: RingAction) => {
      setMenu(null);
      setHover(null);

      if (action === 'person') {
        const p: Node = { id: nid('person'), kind: 'person', parentId, name: null, role: null, purpose: null };
        setNodes((ns) => [...ns, p]);
        setOpenId(p.id);
        setStepIx(0);
        return;
      }

      if (action === 'parent') {
        const child = byId[parentId];
        if (!child) return;
        const up: Node = {
          id: nid('team'),
          kind: 'team',
          parentId: child.parentId,
          name: null,
          role: null,
          purpose: null,
        };
        setNodes((ns) => [up, ...ns.map((n) => (n.id === parentId ? { ...n, parentId: up.id } : n))]);
        if (child.parentId === null) {
          // The new node takes over the island the old root was standing on.
          setPinned((is) => {
            const { [parentId]: at, ...rest } = is;
            return { ...rest, [up.id]: at ?? { x: 0, y: 0 } };
          });
        }
        setParentJustAdded(up.id);
        setOpenId(up.id);
        setStepIx(0);
        return;
      }

      // sibling — a separate island. Nothing is claimed about how they relate.
      const t: Node = { id: nid('team'), kind: 'team', parentId: null, name: null, role: null, purpose: null };
      const spot = nextIslandSpot();
      setNodes((ns) => [...ns, t]);
      setPinned((is) => ({ ...is, [t.id]: spot }));
      setOpenId(t.id);
      setStepIx(0);
    },
    [byId, nextIslandSpot],
  );

  /**
   * Give everything back to the hierarchy: every hand-placed node returns to
   * its orbit, and the islands straighten into one evenly spaced row.
   */
  const tidyUp = useCallback(() => {
    const ordered = [...layout.roots].sort(
      (a, b) => (layout.pos[a.id]?.x ?? 0) - (layout.pos[b.id]?.x ?? 0),
    );
    const next: Record<string, { x: number; y: number }> = {};
    let cursor = 0;
    for (const root of ordered) {
      const reach = layout.reach[root.id] ?? nodeR(root);
      cursor += reach;
      next[root.id] = { x: cursor, y: 0 };
      cursor += reach + ISLAND_GAP;
    }
    // Only the roots keep a position — everything below goes back on its ring.
    setPinned(next);
  }, [layout]);

  /** True once anything has been moved off its orbit. */
  const anyPinned = nodes.some((n) => n.parentId !== null && pinned[n.id]);

  const reset = useCallback(() => {
    motion.current = {};
    cam.current = { k: 1, tx: 0, ty: 0 };
    setNodes([]);
    setPinned({});
    setOpenId(null);
    setMenu(null);
    setHover(null);
    setDrag(null);
    setMerge(null);
    setCoalescing(null);
    setMoveAsk(null);
    setParentJustAdded(null);
    setStepIx(0);
  }, []);

  const openNode = useCallback((id: string) => {
    setMenu(null);
    setHover(null);
    setOpenId(id);
    setStepIx(0);
  }, []);

  /* --- structural moves ---------------------------------------------------- */

  /** Hang a node off a different parent, and let it find its place on the ring. */
  const reparent = useCallback((id: string, parentId: string) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, parentId } : n)));
    // Drop the hand-placed position: joining a team means taking a seat on it.
    setPinned((p) => without(p, id));
    setMoveAsk(null);
  }, []);

  /**
   * Run two teams together into one. Everything either of them held — teams
   * and people alike — ends up on the survivor's ring; the survivor keeps its
   * own place in the hierarchy, so nothing above either team changes.
   */
  const mergeIntoOne = useCallback(
    (aId: string, bId: string, name: string) => {
      setNodes((ns) =>
        ns
          .filter((n) => n.id !== aId)
          .map((n) => {
            if (n.id === bId) return { ...n, name: name.trim() || n.name };
            if (n.parentId === aId) return { ...n, parentId: bId };
            return n;
          }),
      );
      setPinned((p) => {
        const next = { ...p };
        delete next[aId];
        // Everything that was held by either side goes back on the ring, which
        // is what makes the merged team redraw as one.
        for (const n of nodes) if (n.parentId === aId || n.parentId === bId) delete next[n.id];
        return next;
      });
      setMerge(null);
      setCoalescing(null);
    },
    [nodes],
  );

  /** Put both teams under one parent — an existing node, or a brand new one. */
  const giveSharedParent = useCallback(
    (aId: string, bId: string, parentId: string | null) => {
      const aPos = layout.pos[aId];
      const bPos = layout.pos[bId];
      if (parentId) {
        setNodes((ns) => ns.map((n) => (n.id === aId || n.id === bId ? { ...n, parentId } : n)));
        setPinned((p) => without(p, aId, bId));
        setMerge(null);
        return;
      }
      const up: Node = { id: nid('team'), kind: 'team', parentId: null, name: null, role: null, purpose: null };
      setNodes((ns) => [up, ...ns.map((n) => (n.id === aId || n.id === bId ? { ...n, parentId: up.id } : n))]);
      setPinned((p) => {
        // The new parent appears between the two teams it was made for.
        return {
          ...without(p, aId, bId),
          [up.id]: {
            x: ((aPos?.x ?? 0) + (bPos?.x ?? 0)) / 2,
            y: ((aPos?.y ?? 0) + (bPos?.y ?? 0)) / 2,
          },
        };
      });
      setMerge(null);
      setParentJustAdded(up.id);
      setOpenId(up.id);
      setStepIx(0);
    },
    [layout],
  );

  /**
   * Two people who work together are a team — so say so, and one appears
   * around them. It takes the place in the hierarchy the pair already had.
   */
  const formTeamAround = useCallback(
    (aId: string, bId: string, name: string, home: TeamHome) => {
      const aPos = layout.pos[aId];
      const bPos = layout.pos[bId];
      const mid = {
        x: ((aPos?.x ?? 0) + (bPos?.x ?? 0)) / 2,
        y: ((aPos?.y ?? 0) + (bPos?.y ?? 0)) / 2,
      };

      // "A new parent" means two nodes, not one: the pair's team, and the
      // thing that holds it. The holder is what you're then asked to name.
      const holder: Node | null =
        home === 'new'
          ? { id: nid('team'), kind: 'team', parentId: null, name: null, role: null, purpose: null }
          : null;
      const under = holder ? holder.id : home === 'alone' ? null : home;

      const team: Node = {
        id: nid('team'),
        kind: 'team',
        parentId: under,
        name: name.trim() || null,
        role: null,
        purpose: null,
      };

      setNodes((ns) => [
        ...(holder ? [holder] : []),
        team,
        ...ns.map((n) => (n.id === aId || n.id === bId ? { ...n, parentId: team.id } : n)),
      ]);
      setPinned((p) => {
        const next = without(p, aId, bId);
        // Standing on its own, it appears between the two it was made for;
        // inside something else, it takes a seat on that ring instead.
        if (holder) next[holder.id] = mid;
        else if (under === null) next[team.id] = mid;
        return next;
      });
      setMerge(null);
      setCoalescing(null);
      if (holder) {
        setParentJustAdded(holder.id);
        setOpenId(holder.id);
        setStepIx(0);
      } else if (!name.trim()) {
        setOpenId(team.id);
        setStepIx(0);
      }
    },
    [layout],
  );

  /** Put two people on the same team — one that is already on the map. */
  const movePairInto = useCallback((aId: string, bId: string, teamId: string) => {
    setNodes((ns) => ns.map((n) => (n.id === aId || n.id === bId ? { ...n, parentId: teamId } : n)));
    setPinned((p) => without(p, aId, bId));
    setMerge(null);
  }, []);

  /** The droplet: slide one team into the other, then let them become one. */
  const runMerge = useCallback(
    (kind: Kind, aId: string, bId: string, name: string, home: TeamHome = 'alone') => {
      const commit = () =>
        kind === 'team' ? mergeIntoOne(aId, bId, name) : formTeamAround(aId, bId, name, home);
      const bPos = layout.pos[bId];
      if (!bPos || reduced) {
        commit();
        return;
      }
      setCoalescing({ a: aId, b: bId });
      // Two people don't disappear into each other — they draw together and a
      // team closes around them — so they only lean in.
      const aPos = layout.pos[aId] ?? bPos;
      const to =
        kind === 'team'
          ? bPos
          : { x: aPos.x + (bPos.x - aPos.x) * 0.45, y: aPos.y + (bPos.y - aPos.y) * 0.45 };
      setPinned((p) => ({ ...p, [aId]: to }));
      window.setTimeout(commit, 420);
    },
    [layout, reduced, mergeIntoOne, formTeamAround],
  );

  /* --- dragging ----------------------------------------------------------- */

  /** Screen point → world point, through a given camera. */
  const toWorld = useCallback((cx: number, cy: number, c: { k: number; tx: number; ty: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: (cx - left - c.tx) / c.k, y: (cy - top - c.ty) / c.k };
  }, []);

  /** Two teams close enough that letting go would run them together. */
  const armed = useMemo(() => {
    if (!drag?.moved) return null;
    const a = byId[drag.id];
    const ap = layout.pos[drag.id];
    if (!a || !ap) return null;
    // Like pairs with like: two teams run together, two people become a team.
    // A person meeting a team is a different question, and the orbit asks it.
    const blocked = descendantIds(layout.kids, drag.id);
    let best: { id: string; d: number } | null = null;
    for (const other of nodes) {
      if (other.kind !== a.kind || blocked.has(other.id)) continue;
      const bp = layout.pos[other.id];
      if (!bp) continue;
      const d = Math.hypot(ap.x - bp.x, ap.y - bp.y);
      if (d > (nodeR(a) + nodeR(other)) * 1.3) continue;
      if (!best || d < best.d) best = { id: other.id, d };
    }
    return best ? { a: drag.id, b: best.id, kind: a.kind } : null;
  }, [drag, byId, layout, nodes]);

  /** Where the drop would put this node in the org, if anywhere. */
  const landing = useMemo(() => {
    if (!drag?.moved || armed) return null;
    const n = byId[drag.id];
    const at = layout.pos[drag.id];
    if (!n || !at || n.parentId === null) return null;
    const hit = classifyDrop(layout, drag.id, at);
    if (!hit || hit.parentId === n.parentId) return null;
    return hit;
  }, [drag, armed, byId, layout]);

  // Event handlers run long after the render that created them, so they read
  // the world through this instead of a stale closure.
  const live = useRef({ drag, armed, landing, byId, layout });
  useEffect(() => {
    live.current = { drag, armed, landing, byId, layout };
  });

  /**
   * Listeners are wired up here and now, not in an effect. An effect only runs
   * after React commits, and a quick press-and-release finishes before that —
   * which silently swallowed the tap.
   */
  const beginDrag = useCallback(
    (id: string, cx: number, cy: number) => {
      const cam = { k, tx, ty };
      const grab = toWorld(cx, cy, cam);
      // Anything below this node that has been hand-placed travels with it;
      // everything else keeps orbiting and follows for free.
      const family = descendantIds(layout.kids, id);
      const start: Record<string, { x: number; y: number }> = {
        [id]: layout.pos[id] ?? { x: 0, y: 0 },
      };
      for (const fid of family) {
        if (fid !== id && pinned[fid]) start[fid] = pinned[fid]!;
      }
      const session: DragState = { id, cam, grab, start, moved: false };
      setDrag(session);
      setHover(null);
      setMenu(null);

      const move = (mx: number, my: number) => {
        const w = toWorld(mx, my, cam);
        const dx = w.x - grab.x;
        const dy = w.y - grab.y;
        if (!session.moved) {
          // A press that hasn't travelled is still a click, not a drag.
          if (Math.hypot(dx, dy) * cam.k < 4) return;
          session.moved = true;
          setDrag({ ...session });
        }
        setPinned((prev) => {
          const next = { ...prev };
          for (const [nid2, at] of Object.entries(start)) next[nid2] = { x: at.x + dx, y: at.y + dy };
          return next;
        });
      };

      const onMouseMove = (e: MouseEvent) => move(e.clientX, e.clientY);
      const onTouchMove = (e: TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        e.preventDefault();
        move(t.clientX, t.clientY);
      };
      const finish = () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', finish);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', finish);
        window.removeEventListener('touchcancel', finish);
        setDrag(null);
        if (!session.moved) {
          openNode(id);
          return;
        }
        const { armed: arm, landing: land, byId: ids } = live.current;
        if (arm) {
          setMerge({
            a: arm.a,
            b: arm.b,
            kind: arm.kind,
            stage: 'choose',
            name: arm.kind === 'team' ? ids[arm.b]?.name ?? '' : '',
          });
          return;
        }
        if (land) {
          // A person changing team is unremarkable; moving a team takes its
          // whole subtree with it, so that one gets asked about.
          if (ids[id]?.kind === 'person') reparent(id, land.parentId);
          else setMoveAsk({ id, parentId: land.parentId });
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', finish);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', finish);
      window.addEventListener('touchcancel', finish);
    },
    [k, tx, ty, toWorld, layout, pinned, openNode, reparent],
  );

  /* --- pointer on a ring -------------------------------------------------- */
  const angleOn = useCallback(
    (parentId: string, e: { clientX: number; clientY: number }) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const c = layout.pos[parentId];
      if (!rect || !c) return 0;
      const wx = (e.clientX - rect.left - tx) / k;
      const wy = (e.clientY - rect.top - ty) / k;
      return Math.atan2(wy - c.y, wx - c.x);
    },
    [layout, k, tx, ty],
  );

  /* --- the open wizard --------------------------------------------------- */
  const openNodeObj = openId ? byId[openId] ?? null : null;
  const isLoneRoot = !!openNodeObj && openNodeObj.parentId === null && openNodeObj.kind === 'person';
  const steps = openNodeObj ? stepsFor(openNodeObj, isLoneRoot, parentJustAdded === openNodeObj.id) : [];
  const step = steps[Math.min(stepIx, steps.length - 1)] ?? null;

  const answer = (value: string) => {
    if (!openNodeObj || !step) return;
    if (step.key === 'teammates') {
      if (value === 'yes') formTeam();
      else setOpenId(null);
      return;
    }
    patch(openNodeObj.id, { [step.key]: value } as Partial<Node>);
  };

  const canAdvance = (() => {
    if (!openNodeObj || !step) return false;
    if (step.key === 'name') return !!openNodeObj.name?.trim();
    if (step.key === 'role') return !!openNodeObj.role;
    if (step.key === 'purpose') return !!openNodeObj.purpose;
    return false;
  })();

  const next = () => {
    if (stepIx < steps.length - 1) setStepIx(stepIx + 1);
    else setOpenId(null);
  };

  /* --- where the boxes go ------------------------------------------------- */
  const CALLOUT_W = Math.min(330, size.w - 24);
  const CALLOUT_H = step ? (step.kind === 'text' ? 330 : step.kind === 'choice' ? 262 : 216) : 0;
  const MENU_H = 300;

  const otherBoxes = useCallback(
    (exceptId?: string): Rect[] =>
      nodes
        .filter((n) => n.id !== exceptId)
        .map((n) => {
          const s = toScreen(n.id);
          const nr = nodeR(n) * k;
          return { x: s.x - nr - 18, y: s.y - nr - 6, w: (nr + 18) * 2, h: nr * 2 + 58 };
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, frame, k, tx, ty],
  );

  const placement = (() => {
    if (!openNodeObj || !step) return null;
    const here = toScreen(openNodeObj.id);
    const r = nodeR(openNodeObj) * k;
    return placeCallout({ x: here.x, y: here.y, r }, otherBoxes(openNodeObj.id), CALLOUT_W, CALLOUT_H, size.w, size.h);
  })();

  const menuPlacement = (() => {
    if (!menu || openNodeObj) return null;
    const here = toScreen('__plus');
    return placeCallout({ x: here.x, y: here.y, r: 26 }, otherBoxes(), CALLOUT_W, MENU_H, size.w, size.h);
  })();

  const menuOwner = menu ? byId[menu.parentId] : null;

  const askPlacement = (() => {
    const focusId = merge ? merge.b : moveAsk ? moveAsk.id : null;
    if (!focusId) return null;
    const here = toScreen(focusId);
    const n = byId[focusId];
    const h = merge
      ? merge.stage === 'choose'
        ? 268
        : merge.stage === 'rename'
          ? 300
          : merge.stage === 'home'
            ? 330
            : 280
      : 232;
    return {
      ...placeCallout({ x: here.x, y: here.y, r: (n ? nodeR(n) : 40) * k }, otherBoxes(focusId), CALLOUT_W, h, size.w, size.h),
    };
  })();

  /**
   * Two people from the same team make a team that plainly belongs there. Two
   * people from *different* teams don't — picking one of their parents for
   * them would be a coin toss, so it gets asked.
   */
  const pairHomes = (() => {
    if (!merge || merge.kind !== 'person') return null;
    const pa = byId[merge.a]?.parentId ?? null;
    const pb = byId[merge.b]?.parentId ?? null;
    if (pa === pb) return null;
    const seen = new Set<string>();
    const options: { value: TeamHome; label: string; hint: string }[] = [];
    for (const [pid, who] of [
      [pb, merge.b],
      [pa, merge.a],
    ] as const) {
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      options.push({
        value: pid,
        label: byId[pid]?.name ?? 'That team',
        hint: `Where ${byId[who]?.name?.split(' ')[0] ?? 'they'} already sits`,
      });
    }
    options.push({ value: 'alone', label: 'On its own', hint: 'Answering to nothing, for now' });
    options.push({ value: 'new', label: 'Something new', hint: 'A new node above it, which you can name next' });
    return options;
  })();

  /** Teams a pair could be filed under — never one of their own descendants. */
  const parentChoices = (() => {
    if (!merge) return [];
    const blocked = new Set([...descendantIds(layout.kids, merge.a), ...descendantIds(layout.kids, merge.b)]);
    return teams.filter((t) => !blocked.has(t.id) && t.name?.trim());
  })();

  /** One entry per visible node: where its label goes and what it would say. */
  const labelItems = nodes
    .map((n) => {
      const mo = m(n.id);
      if (mo.a < 0.05) return null;
      const s2 = worldToScreen(mo);
      const missing = missingLabel(n);
      const count = headcount[n.id] ?? 0;
      return {
        id: n.id,
        node: n,
        alpha: mo.a,
        x: s2.x,
        y: s2.y + nodeR(n) * k + 20,
        depth: depthOf[n.id] ?? 0,
        title: n.name?.trim() || (n.kind === 'team' ? 'Your team' : 'A teammate'),
        sub:
          missing ??
          (n.kind === 'team'
            ? count
              ? `${count} ${count === 1 ? 'person' : 'people'}`
              : 'No one yet'
            : n.role) ??
          '',
        titleSize: n.kind === 'team' ? 15 : 14,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const labelPlan = declutter(labelItems);

  /* --- render ------------------------------------------------------------ */
  return (
    <div
      ref={shellRef}
      className={reduced ? 'zen-still' : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: PAPER,
        color: INK,
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        overflow: 'hidden',
        touchAction: 'manipulation',
      }}
    >
      <style>{CSS}</style>

      {size.w > 0 && (
        <svg
          ref={svgRef}
          width={size.w}
          height={size.h}
          style={{ display: 'block', position: 'absolute', inset: 0 }}
          onClick={closeAll}
        >
          {/* ---- shapes, in the camera's frame ---- */}
          <g
            transform={`translate(${tx} ${ty}) scale(${k})`}
            /* No blanket gate here. Anything that shouldn't take a click
               says so for itself — switching the whole map off meant the "+"
               chasing the pointer could silently eat your clicks. */
          >
            {/* orbits — every team has one, and it's how you add to it */}
            {teams.map((t) => {
              const R = layout.ring[t.id];
              const mo = m(t.id);
              if (!R || mo.a < 0.05) return null;
              const live =
                hover?.parentId === t.id || menu?.parentId === t.id || landing?.parentId === t.id;
              return (
                <g key={`ring-${t.id}`}>
                  <circle
                    r={R}
                    cx={mo.x}
                    cy={mo.y}
                    fill="none"
                    stroke={live ? TEAM_HUE : LINE}
                    strokeWidth={(live ? 2 : 1.5) / k}
                    strokeDasharray={`${4 / k} ${9 / k}`}
                    opacity={mo.a * (live ? 0.75 : 0.9)}
                    style={{ transition: 'stroke 160ms ease' }}
                  />
                  {/* the band that answers the pointer — invisible, generous */}
                  <circle
                    r={R}
                    cx={mo.x}
                    cy={mo.y}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={RING_BAND / k}
                    style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                    // Mouse events, not pointer events: they fire everywhere,
                    // including the older browsers this has to run on.
                    onMouseMove={(e) => {
                      if (menu || drag) return;
                      setHover({ parentId: t.id, angle: angleOn(t.id, e) });
                    }}
                    onMouseLeave={() => {
                      if (!menu) setHover(null);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const angle = angleOn(t.id, e);
                      setHover({ parentId: t.id, angle });
                      setMenu({ parentId: t.id, angle });
                      setOpenId(null);
                    }}
                  />
                </g>
              );
            })}

            {nodes.length === 0 && <SeedNode onPick={startFirstPerson} />}

            {/* the droplet: two teams running together, or already doing so */}
            {(() => {
              // Visible while you hold them together, and while you decide —
              // the question on screen is about these two, so show them joined.
              const pair = coalescing ?? armed ?? (merge ? { a: merge.a, b: merge.b } : null);
              if (!pair) return null;
              const ma = m(pair.a);
              const mb = m(pair.b);
              const a = byId[pair.a];
              const b = byId[pair.b];
              if (!a || !b) return null;
              const d = metaballPath(
                { x: ma.x, y: ma.y, r: nodeR(a) + 4 },
                { x: mb.x, y: mb.y, r: nodeR(b) + 4 },
              );
              if (!d) return null;
              return <path d={d} fill={TEAM_HUE} fillOpacity={coalescing ? 0.3 : 0.2} />;
            })()}

            {nodes.map((n) => {
              const mo = m(n.id);
              const t = targets[n.id];
              // Mid-flight it is sitting on top of its parent, so it must not
              // take the click — but only *it* stops listening, not the map.
              const arrived = (!t || Math.hypot(t.x - mo.x, t.y - mo.y) < 3) && mo.a > 0.6;
              return (
                <NodeShape
                  key={n.id}
                  node={n}
                  mo={mo}
                  selected={openId === n.id}
                  dragging={drag?.id === n.id && drag.moved}
                  joining={armed ? armed.a === n.id || armed.b === n.id : false}
                  interactive={arrived}
                  onGrab={(cx, cy) => beginDrag(n.id, cx, cy)}
                />
              );
            })}

            {frame.pos.__solo && (
              <AddDot mo={m('__solo')} k={k} onPick={formTeam} />
            )}
            {frame.pos.__plus && (
              <AddDot
                mo={m('__plus')}
                k={k}
                passive
                onPick={() => {
                  if (plus) setMenu(plus);
                }}
              />
            )}
          </g>

          {/* ---- labels, in screen space so they stay legible at any zoom ---- */}
          <g style={{ pointerEvents: 'none' }}>
            {labelItems.map((it) => {
              const plan = labelPlan[it.id];
              if (!plan) return null;
              return (
                <NodeLabel
                  key={`lab-${it.id}`}
                  node={it.node}
                  x={it.x}
                  y={it.y}
                  alpha={it.alpha}
                  title={it.title}
                  sub={plan.showSub ? it.sub : ''}
                />
              );
            })}
            {frame.pos.__solo && (
              <text
                x={worldToScreen(m('__solo')).x}
                y={worldToScreen(m('__solo')).y + PERSON_R * k + 18}
                textAnchor="middle"
                fontSize={12}
                fill={INK_SOFT}
                opacity={m('__solo').a}
              >
                Add a teammate
              </text>
            )}
          </g>
        </svg>
      )}

      {/* ---- the wizard ---- */}
      {openNodeObj && step && placement && (
        <div
          className="zen-callout"
          style={{
            position: 'absolute',
            ...(placement.side === 'sheet' ? { bottom: 12 } : { top: placement.rect.y }),
            left: placement.rect.x,
            width: placement.rect.w,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {placement.side !== 'sheet' && (
            <div
              className={`zen-tail ${placement.side}`}
              style={
                placement.side === 'right' || placement.side === 'left'
                  ? { top: placement.tail }
                  : { left: placement.tail }
              }
            />
          )}

          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {steps.map((s, i) => (
              <span key={s.key} className="zen-pip" style={{ background: i <= stepIx ? INK : LINE }} />
            ))}
          </div>

          <div className="zen-kicker">
            {openNodeObj.kind === 'team' ? (parentJustAdded === openNodeObj.id ? 'The parent' : 'The team') : 'A person'}{' '}
            · step {stepIx + 1} of {steps.length}
          </div>
          <h2 className="zen-title">
            {step.key === 'teammates' && openNodeObj.name
              ? `Does ${openNodeObj.name.split(' ')[0]} have any teammates?`
              : step.title}
          </h2>

          {step.kind === 'text' && (
            <>
              <input
                className="zen-input"
                autoFocus
                placeholder={step.placeholder}
                value={openNodeObj.name ?? ''}
                onChange={(e) => patch(openNodeObj.id, { name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canAdvance) next();
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {step.suggestions.map((s) => (
                  <button key={s} className="zen-chip" onClick={() => patch(openNodeObj.id, { name: s })}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}

          {step.kind === 'select' && (
            <select
              className="zen-input"
              autoFocus
              value={(step.key === 'role' ? openNodeObj.role : openNodeObj.purpose) ?? ''}
              onChange={(e) => answer(e.target.value)}
            >
              <option value="" disabled>
                {step.placeholder}
              </option>
              {step.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}

          {step.kind === 'choice' && (
            <div style={{ display: 'grid', gap: 8 }}>
              {step.options.map((o) => (
                <button key={o.value} className="zen-choice" onClick={() => answer(o.value)}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{o.label}</span>
                  <span style={{ fontSize: 12, color: INK_SOFT }}>{o.hint}</span>
                </button>
              ))}
            </div>
          )}

          {step.kind !== 'choice' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
              {stepIx > 0 && (
                <button className="zen-ghost" onClick={() => setStepIx(stepIx - 1)}>
                  Back
                </button>
              )}
              <div style={{ flex: 1 }} />
              <button className="zen-primary" disabled={!canAdvance} onClick={next}>
                {stepIx < steps.length - 1 ? 'Next' : 'Done'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ---- the ring menu ---- */}
      {menu && menuPlacement && menuOwner && (
        <div
          className="zen-callout"
          style={{
            position: 'absolute',
            ...(menuPlacement.side === 'sheet' ? { bottom: 12 } : { top: menuPlacement.rect.y }),
            left: menuPlacement.rect.x,
            width: menuPlacement.rect.w,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuPlacement.side !== 'sheet' && (
            <div
              className={`zen-tail ${menuPlacement.side}`}
              style={
                menuPlacement.side === 'right' || menuPlacement.side === 'left'
                  ? { top: menuPlacement.tail }
                  : { left: menuPlacement.tail }
              }
            />
          )}
          <div className="zen-kicker">{menuOwner.name ?? 'This team'}</div>
          <h2 className="zen-title">What goes here?</h2>
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="zen-choice" onClick={() => ringAction(menu.parentId, 'person')}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>A person</span>
              <span style={{ fontSize: 12, color: INK_SOFT }}>Another seat on this orbit</span>
            </button>
            <button className="zen-choice" onClick={() => ringAction(menu.parentId, 'parent')}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Something above it</span>
              <span style={{ fontSize: 12, color: INK_SOFT }}>
                {menuOwner.name ?? 'This team'} starts orbiting a parent
              </span>
            </button>
            <button className="zen-choice" onClick={() => ringAction(menu.parentId, 'sibling')}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Another team</span>
              <span style={{ fontSize: 12, color: INK_SOFT }}>Stands on its own, off to one side</span>
            </button>
          </div>
        </div>
      )}

      {/* ---- running two teams together ---- */}
      {merge && askPlacement && (
        <div
          className="zen-callout"
          style={{
            position: 'absolute',
            ...(askPlacement.side === 'sheet' ? { bottom: 12 } : { top: askPlacement.rect.y }),
            left: askPlacement.rect.x,
            width: askPlacement.rect.w,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="zen-kicker">
            {byId[merge.a]?.name ?? 'This team'} + {byId[merge.b]?.name ?? 'that one'}
          </div>

          {merge.stage === 'choose' && (
            <>
              <h2 className="zen-title">
                {merge.kind === 'team' ? 'What should happen?' : 'Do these two work together?'}
              </h2>
              <div style={{ display: 'grid', gap: 8 }}>
                <button
                  className="zen-choice"
                  onClick={() => setMerge({ ...merge, stage: 'rename', name: byId[merge.b]?.name ?? '' })}
                >
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {merge.kind === 'team' ? 'Make them one team' : 'Make them a team'}
                  </span>
                  <span style={{ fontSize: 12, color: INK_SOFT }}>
                    {merge.kind === 'team'
                      ? 'Everyone and everything in both, on one ring. Nothing above either team changes.'
                      : 'A new team closes around the two of them, where they already sit.'}
                  </span>
                </button>
                <button className="zen-choice" onClick={() => setMerge({ ...merge, stage: 'parent' })}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {merge.kind === 'team' ? 'Give them a shared parent' : 'Put them on the same team'}
                  </span>
                  <span style={{ fontSize: 12, color: INK_SOFT }}>
                    {merge.kind === 'team'
                      ? 'Both stay as they are, and start orbiting the same thing.'
                      : 'Move them both onto a team that is already on the map.'}
                  </span>
                </button>
              </div>
              <div style={{ display: 'flex', marginTop: 14 }}>
                <div style={{ flex: 1 }} />
                <button className="zen-ghost" onClick={() => setMerge(null)}>
                  {merge.kind === 'team' ? 'Leave them apart' : 'Not really'}
                </button>
              </div>
            </>
          )}

          {merge.stage === 'rename' && (
            <>
              <h2 className="zen-title">
                {merge.kind === 'team' ? 'What is the merged team called?' : 'What is their team called?'}
              </h2>
              <input
                className="zen-input"
                autoFocus
                placeholder="Team name"
                value={merge.name}
                onChange={(e) => setMerge({ ...merge, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !merge.name.trim()) return;
                  if (pairHomes) setMerge({ ...merge, stage: 'home' });
                  else runMerge(merge.kind, merge.a, merge.b, merge.name);
                }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {[
                  ...new Set(
                    merge.kind === 'team'
                      ? [byId[merge.a]?.name, byId[merge.b]?.name, ...TEAM_NAMES]
                      : TEAM_NAMES,
                  ),
                ]
                  .filter((v): v is string => !!v?.trim())
                  .slice(0, 5)
                  .map((v) => (
                    <button key={v} className="zen-chip" onClick={() => setMerge({ ...merge, name: v })}>
                      {v}
                    </button>
                  ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
                <button className="zen-ghost" onClick={() => setMerge({ ...merge, stage: 'choose' })}>
                  Back
                </button>
                <div style={{ flex: 1 }} />
                <button
                  className="zen-primary"
                  disabled={!merge.name.trim()}
                  onClick={() =>
                    pairHomes
                      ? setMerge({ ...merge, stage: 'home' })
                      : runMerge(merge.kind, merge.a, merge.b, merge.name)
                  }
                >
                  {pairHomes ? 'Next' : merge.kind === 'team' ? 'Merge' : 'Create the team'}
                </button>
              </div>
            </>
          )}

          {merge.stage === 'home' && pairHomes && (
            <>
              <h2 className="zen-title">Where does {merge.name.trim() || 'their team'} sit?</h2>
              <p style={{ fontSize: 13, color: INK_SOFT, margin: '-6px 0 14px' }}>
                They come from different teams, so this one is yours to say.
              </p>
              <div style={{ display: 'grid', gap: 8 }}>
                {pairHomes.map((o) => (
                  <button
                    key={String(o.value)}
                    className="zen-choice"
                    onClick={() => runMerge(merge.kind, merge.a, merge.b, merge.name, o.value)}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{o.label}</span>
                    <span style={{ fontSize: 12, color: INK_SOFT }}>{o.hint}</span>
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', marginTop: 14 }}>
                <button className="zen-ghost" onClick={() => setMerge({ ...merge, stage: 'rename' })}>
                  Back
                </button>
              </div>
            </>
          )}

          {merge.stage === 'parent' && (
            <>
              <h2 className="zen-title">
                {merge.kind === 'team' ? 'What do they both sit under?' : 'Which team?'}
              </h2>
              <div style={{ display: 'grid', gap: 8, maxHeight: 200, overflowY: 'auto' }}>
                {merge.kind === 'team' && (
                  <button className="zen-choice" onClick={() => giveSharedParent(merge.a, merge.b, null)}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Something new</span>
                    <span style={{ fontSize: 12, color: INK_SOFT }}>A new node, made to hold the two of them</span>
                  </button>
                )}
                {parentChoices.map((t) => (
                  <button
                    key={t.id}
                    className="zen-choice"
                    onClick={() =>
                      merge.kind === 'team'
                        ? giveSharedParent(merge.a, merge.b, t.id)
                        : movePairInto(merge.a, merge.b, t.id)
                    }
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</span>
                    <span style={{ fontSize: 12, color: INK_SOFT }}>Already on the map</span>
                  </button>
                ))}
                {merge.kind === 'person' && parentChoices.length === 0 && (
                  <p style={{ fontSize: 13, color: INK_SOFT, margin: 0 }}>
                    There is no other team to move them to yet.
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', marginTop: 14 }}>
                <button className="zen-ghost" onClick={() => setMerge({ ...merge, stage: 'choose' })}>
                  Back
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ---- moving a team to a different parent ---- */}
      {moveAsk && !merge && askPlacement && (
        <div
          className="zen-callout"
          style={{
            position: 'absolute',
            ...(askPlacement.side === 'sheet' ? { bottom: 12 } : { top: askPlacement.rect.y }),
            left: askPlacement.rect.x,
            width: askPlacement.rect.w,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="zen-kicker">{byId[moveAsk.id]?.name ?? 'This team'}</div>
          <h2 className="zen-title">
            Move it under {byId[moveAsk.parentId]?.name ?? 'that team'}?
          </h2>
          <p style={{ fontSize: 13, color: INK_SOFT, margin: '0 0 14px' }}>
            Everything below it comes too. Dropping it somewhere on the paper only moves it.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="zen-ghost" onClick={() => setMoveAsk(null)}>
              Just leave it there
            </button>
            <div style={{ flex: 1 }} />
            <button className="zen-primary" onClick={() => reparent(moveAsk.id, moveAsk.parentId)}>
              Move it
            </button>
          </div>
        </div>
      )}

      {/* ---- chrome ---- */}
      <div style={{ position: 'absolute', top: 18, left: 22, pointerEvents: 'none' }}>
        <div style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: INK_SOFT }}>
          Lab · grow
        </div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2 }}>The first team</div>
      </div>

      <div style={{ position: 'absolute', top: 16, right: 20, display: 'flex', gap: 8 }}>
        {(layout.roots.length > 1 || anyPinned) && (
          <button className="zen-ghost" onClick={tidyUp}>
            Tidy up
          </button>
        )}
        <button className="zen-ghost" onClick={reset}>
          Start over
        </button>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontSize: 12,
          color: INK_SOFT,
          pointerEvents: 'none',
        }}
      >
        {nodes.length === 0
          ? 'A blank canvas. Everything starts with one person.'
          : needsData
            ? 'The breathing nodes are still missing something — click one.'
            : teams.length
              ? `${teams.length} ${teams.length === 1 ? 'team' : 'teams'} · ${people.length} ${
                  people.length === 1 ? 'person' : 'people'
                } — hover an orbit to add to it.`
              : `Just ${people[0]?.name ?? 'one person'} so far. Nothing here is saved.`}
      </div>
    </div>
  );
}

/* --- node art ------------------------------------------------------------ */

function SeedNode({ onPick }: { onPick: () => void }) {
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      <circle className="zen-pulse" r={SEED_R + 18} fill={INK_SOFT} fillOpacity={0.14} />
      <circle r={SEED_R} fill={SURFACE} stroke={INK_SOFT} strokeWidth={2} strokeDasharray="5 7" />
      <line x1={-17} y1={0} x2={17} y2={0} stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <line x1={0} y1={-17} x2={0} y2={17} stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <text y={SEED_R + 40} textAnchor="middle" fontSize={14} fontWeight={600} fill={INK}>
        Start here
      </text>
      <text y={SEED_R + 59} textAnchor="middle" fontSize={12.5} fill={INK_SOFT}>
        Add the first person
      </text>
    </g>
  );
}

/**
 * The "+" that rides a ring. Sized in screen pixels so it stays tappable.
 *
 * `passive` is load-bearing: this thing is drawn under the pointer, on top of
 * the ring's hit band. If it takes the pointer, the band it came from gets a
 * mouseleave, the "+" vanishes, the band takes over again — a flicker loop
 * that eats clicks. So on a ring it is paint only, and the band owns both the
 * hover and the click.
 */
function AddDot({
  mo,
  k,
  passive,
  onPick,
}: {
  mo: Motion;
  k: number;
  passive?: boolean;
  onPick: () => void;
}) {
  const r = 26 / k;
  const arm = 11 / k;
  return (
    <g
      transform={`translate(${mo.x} ${mo.y}) scale(${0.55 + 0.45 * mo.a})`}
      opacity={mo.a}
      style={{ cursor: 'pointer', pointerEvents: passive ? 'none' : 'auto' }}
      onClick={(e) => {
        if (passive) return;
        e.stopPropagation();
        onPick();
      }}
    >
      <circle r={r} fill={SURFACE} stroke={TEAM_HUE} strokeWidth={1.8 / k} opacity={0.96} />
      <line x1={-arm} y1={0} x2={arm} y2={0} stroke={TEAM_HUE} strokeWidth={2.4 / k} strokeLinecap="round" />
      <line x1={0} y1={-arm} x2={0} y2={arm} stroke={TEAM_HUE} strokeWidth={2.4 / k} strokeLinecap="round" />
    </g>
  );
}

function NodeShape({
  node,
  mo,
  selected,
  dragging,
  joining,
  interactive,
  onGrab,
}: {
  node: Node;
  mo: Motion;
  selected: boolean;
  dragging: boolean;
  joining: boolean;
  interactive: boolean;
  onGrab: (clientX: number, clientY: number) => void;
}) {
  const isTeam = node.kind === 'team';
  const r = nodeR(node);
  const hue = isTeam ? TEAM_HUE : roleColor(node.role);
  const unnamed = !node.name?.trim();
  // A node keeps breathing until it's actually described — a name alone
  // isn't enough, or the map would go quiet while it still knows nothing.
  const wants = !isComplete(node);

  return (
    <g
      transform={`translate(${mo.x} ${mo.y}) scale(${(0.62 + 0.38 * mo.a) * (dragging ? 1.06 : 1)})`}
      opacity={mo.a}
      // Until it has arrived it is invisible but still hit-testable, and it is
      // sitting on top of its parent — so it must not take the click.
      style={{ cursor: dragging ? 'grabbing' : 'grab', pointerEvents: interactive ? 'auto' : 'none' }}
      onMouseDown={(e) => {
        e.stopPropagation();
        onGrab(e.clientX, e.clientY);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (!t) return;
        e.stopPropagation();
        onGrab(t.clientX, t.clientY);
      }}
      // The press already did the work. The browser still fires a click
      // afterwards, and letting it reach the paper would shut the panel that
      // the release just opened.
      onClick={(e) => e.stopPropagation()}
    >
      {wants && <circle className="zen-pulse" r={r + 11} fill={hue} fillOpacity={0.18} />}
      {joining && <circle r={r + 13} fill={TEAM_HUE} fillOpacity={0.16} />}
      {selected && <circle r={r + 8} fill="none" stroke={hue} strokeWidth={1.5} opacity={0.5} />}
      <circle r={r} fill={SURFACE} stroke={hue} strokeWidth={isTeam ? 3 : 2.5} opacity={unnamed ? 0.55 : 1} />
      {isTeam ? (
        <g fill={hue} opacity={unnamed ? 0.5 : 0.9}>
          <circle cx={-13} cy={4} r={6} />
          <circle cx={13} cy={4} r={6} />
          <circle cx={0} cy={-11} r={6} />
        </g>
      ) : node.name ? (
        <text textAnchor="middle" dy={6} fontSize={17} fontWeight={600} fill={hue}>
          {initials(node.name)}
        </text>
      ) : (
        <text textAnchor="middle" dy={7} fontSize={20} fontWeight={500} fill={hue} opacity={0.7}>
          ?
        </text>
      )}
    </g>
  );
}

/** Drawn in screen space: the map can zoom out without the names shrinking. */
function NodeLabel({
  node,
  x,
  y,
  alpha,
  title,
  sub,
}: {
  node: Node;
  x: number;
  y: number;
  alpha: number;
  title: string;
  sub: string;
}) {
  const isTeam = node.kind === 'team';
  const unnamed = !node.name?.trim();
  const missing = missingLabel(node);
  const hue = isTeam ? TEAM_HUE : roleColor(node.role);
  // A paper halo behind the glyphs: labels cross the dotted rings constantly,
  // and this is what keeps them readable when they do.
  const halo = { paintOrder: 'stroke' as const, stroke: PAPER, strokeWidth: 3.5, strokeLinejoin: 'round' as const };
  return (
    <g opacity={alpha}>
      <text
        x={x}
        y={y}
        textAnchor="middle"
        fontSize={isTeam ? 15 : 14}
        fontWeight={600}
        fill={unnamed ? INK_SOFT : INK}
        style={halo}
      >
        {title}
      </text>
      {sub && (
        <text x={x} y={y + 17} textAnchor="middle" fontSize={12} fill={missing ? hue : INK_SOFT} style={halo}>
          {sub}
        </text>
      )}
    </g>
  );
}

/* --- styles -------------------------------------------------------------- */
const CSS = `
@keyframes zenPulse {
  0%, 100% { transform: scale(1);    opacity: .45; }
  50%      { transform: scale(1.16); opacity: 1;   }
}
/* NB: the keyframe owns \`opacity\`, so the tint must ride on \`fill-opacity\` —
   an SVG opacity="" attribute here would be silently overridden. */
.zen-pulse { animation: zenPulse 2.6s ease-in-out infinite; transform-origin: 0 0; }

@keyframes zenCalloutIn {
  from { opacity: 0; transform: translateY(6px) scale(.985); }
  to   { opacity: 1; transform: none; }
}
.zen-callout {
  background: ${SURFACE};
  border: 1px solid ${LINE};
  border-radius: 14px;
  padding: 18px 18px 16px;
  box-shadow: 0 18px 44px -18px rgba(34,39,46,.32), 0 2px 6px rgba(34,39,46,.05);
  animation: zenCalloutIn 220ms cubic-bezier(.22,.8,.3,1) both;
}
/* The tail names the side the CALLOUT is on, so it hangs off the opposite edge. */
.zen-tail {
  position: absolute; width: 12px; height: 12px;
  background: ${SURFACE}; transform: rotate(45deg);
}
.zen-tail.right { left: -7px;   margin-top: -6px;  border-left: 1px solid ${LINE}; border-bottom: 1px solid ${LINE}; }
.zen-tail.left  { right: -7px;  margin-top: -6px;  border-right: 1px solid ${LINE}; border-top: 1px solid ${LINE}; }
.zen-tail.below { top: -7px;    margin-left: -6px; border-left: 1px solid ${LINE}; border-top: 1px solid ${LINE}; }
.zen-tail.above { bottom: -7px; margin-left: -6px; border-right: 1px solid ${LINE}; border-bottom: 1px solid ${LINE}; }

.zen-kicker { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: ${INK_SOFT}; margin-bottom: 6px; }
.zen-title  { font-size: 19px; line-height: 1.25; font-weight: 600; margin: 0 0 14px; }

.zen-pip { height: 3px; flex: 1; border-radius: 2px; transition: background 220ms ease; }

.zen-input {
  width: 100%; box-sizing: border-box;
  padding: 10px 12px; font-size: 14.5px; color: ${INK};
  background: ${PAPER}; border: 1px solid ${LINE}; border-radius: 9px;
  outline: none; font-family: inherit;
}
.zen-input:focus { border-color: ${INK_SOFT}; background: ${SURFACE}; }

.zen-chip {
  padding: 5px 10px; font-size: 12.5px; color: ${INK_SOFT};
  background: ${PAPER}; border: 1px solid ${LINE}; border-radius: 999px;
  cursor: pointer; font-family: inherit;
}
.zen-chip:hover, .zen-chip:active { color: ${INK}; border-color: ${INK_SOFT}; }

.zen-choice {
  display: flex; flex-direction: column; gap: 2px; text-align: left;
  padding: 11px 13px; border: 1px solid ${LINE}; border-radius: 10px;
  background: ${PAPER}; cursor: pointer; color: ${INK}; font-family: inherit;
  transition: border-color 140ms ease, background 140ms ease;
}
.zen-choice:hover, .zen-choice:active { border-color: ${INK_SOFT}; background: ${SURFACE}; }

.zen-primary {
  padding: 8px 18px; font-size: 14px; font-weight: 600; font-family: inherit;
  color: ${PAPER}; background: ${INK}; border: 1px solid ${INK};
  border-radius: 9px; cursor: pointer;
}
.zen-primary:disabled { opacity: .3; cursor: default; }

.zen-ghost {
  padding: 7px 14px; font-size: 13px; font-family: inherit;
  color: ${INK_SOFT}; background: transparent;
  border: 1px solid ${LINE}; border-radius: 9px; cursor: pointer;
}
.zen-ghost:hover, .zen-ghost:active { color: ${INK}; border-color: ${INK_SOFT}; }

@media (prefers-reduced-motion: reduce) {
  .zen-pulse { animation: none; opacity: .8; }
  .zen-callout { animation: none; }
}
/* Same treatment, reachable via ?still=1 for review. */
.zen-still .zen-pulse { animation: none; opacity: .8; }
.zen-still .zen-callout { animation: none; }
`;
