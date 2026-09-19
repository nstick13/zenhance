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
 * Rendered as SVG, not Konva. Three to a dozen nodes don't need a canvas,
 * and SVG gives us crisp text at any camera scale for free.
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

/** A node's drawn state: where it is, and how far it has arrived (0→1). */
type Motion = { x: number; y: number; a: number };

/** One published animation frame — everything render needs, and nothing else. */
type Frame = { pos: Record<string, Motion>; k: number; cy: number; busy: boolean };

type Node = {
  id: string;
  kind: Kind;
  parentId: string | null;
  name: string | null;
  role: string | null; // person
  purpose: string | null; // team
};

let seq = 0;
const nid = (k: Kind) => `${k}-${++seq}`;

const ringRadius = (slots: number) => 180 + Math.max(0, slots - 8) * 16;

/** Root at the origin; everything else evenly spread on one ring around it. */
function layoutOf(nodes: Node[], addSlot: boolean) {
  const pos: Record<string, { x: number; y: number }> = {};
  const root = nodes.find((n) => n.parentId === null);
  if (!root) return { pos, ring: 0 };
  pos[root.id] = { x: 0, y: 0 };

  const kids = nodes.filter((n) => n.parentId === root.id);
  if (kids.length === 0) {
    // A lone person: the "add" affordance floats beside them rather than orbiting.
    if (addSlot) pos.__add = { x: SOLO_ADD_R, y: 0 };
    return { pos, ring: 0 };
  }

  const n = kids.length;
  const R = ringRadius(n);
  // People are spaced by how many PEOPLE there are — never by whether the
  // "+" happens to be showing, or finishing the last field would spin the
  // whole team round to make room for it.
  // Start at 180° so the first two sit left/right of the team: "alongside".
  kids.forEach((k, i) => {
    const a = Math.PI + (i * 2 * Math.PI) / n;
    pos[k.id] = { x: Math.cos(a) * R, y: Math.sin(a) * R };
  });
  if (addSlot) {
    // Drop it in the gap between the last person and the first.
    const a = Math.PI + ((n - 0.5) * 2 * Math.PI) / n;
    pos.__add = { x: Math.cos(a) * R, y: Math.sin(a) * R };
  }
  return { pos, ring: R };
}

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

/* --- wizard shape -------------------------------------------------------- */
type Step =
  | { key: 'name'; title: string; kind: 'text'; placeholder: string; suggestions: string[] }
  | { key: 'role' | 'purpose'; title: string; kind: 'select'; placeholder: string; options: string[] }
  | { key: 'teammates'; title: string; kind: 'choice'; options: { value: 'yes' | 'no'; label: string; hint: string }[] };

function stepsFor(node: Node, isLoneRoot: boolean): Step[] {
  if (node.kind === 'team') {
    return [
      {
        key: 'name',
        title: 'What is this team called?',
        kind: 'text',
        placeholder: 'Team name',
        suggestions: TEAM_NAMES,
      },
      {
        key: 'purpose',
        title: 'What does it deliver?',
        kind: 'select',
        placeholder: 'Pick what this team is for',
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

type Side = 'right' | 'left' | 'below' | 'above' | 'sheet';
type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Put the callout where it hides the least. A box pinned to one side always
 * ends up over a neighbour once the ring fills in — the team sits between two
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

  const GAP = 26;
  const candidates: { side: Side; rect: Rect }[] = [
    { side: 'right', rect: { x: node.x + node.r + GAP, y: node.y - ch / 2, w: cw, h: ch } },
    { side: 'left', rect: { x: node.x - node.r - GAP - cw, y: node.y - ch / 2, w: cw, h: ch } },
    { side: 'below', rect: { x: node.x - cw / 2, y: node.y + node.r + GAP + 18, w: cw, h: ch } },
    { side: 'above', rect: { x: node.x - cw / 2, y: node.y - node.r - GAP - ch, w: cw, h: ch } },
  ];

  let best = candidates[0]!;
  let bestScore = Infinity;
  candidates.forEach((c, i) => {
    const clipped =
      Math.max(0, 12 - c.rect.x) +
      Math.max(0, c.rect.x + c.rect.w - (vw - 12)) +
      Math.max(0, 12 - c.rect.y) +
      Math.max(0, c.rect.y + c.rect.h - (vh - 12));
    const hidden = others.filter((o) => overlaps(c.rect, o)).length;
    // Covering a node is the expensive thing; running off-screen is next;
    // the declared order only breaks ties.
    const score = hidden * 1000 + clipped * 2 + i;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  });

  const rect = {
    ...best.rect,
    x: Math.max(12, Math.min(vw - cw - 12, best.rect.x)),
    y: Math.max(12, Math.min(vh - ch - 12, best.rect.y)),
  };
  const tail =
    best.side === 'right' || best.side === 'left'
      ? Math.max(18, Math.min(ch - 30, node.y - rect.y))
      : Math.max(18, Math.min(cw - 30, node.x - rect.x));

  return { rect, side: best.side, tail };
}

/* ======================================================================== */

export default function GrowLab() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stepIx, setStepIx] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [reduced, setReduced] = useState(false);

  const shellRef = useRef<HTMLDivElement | null>(null);

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
  const root = nodes.find((n) => n.parentId === null) ?? null;
  const team = nodes.find((n) => n.kind === 'team') ?? null;
  const people = nodes.filter((n) => n.kind === 'person');
  const needsData = nodes.some((n) => !isComplete(n));
  // Growth is only offered once nothing is asking for attention — otherwise
  // the "+" competes with the nodes that are pulsing because they're empty,
  // and it must never appear mid-wizard (it moves the camera under the user).
  const showAdd = nodes.length > 0 && !needsData && !openId;

  const { pos: targetPos, ring } = useMemo(() => layoutOf(nodes, showAdd), [nodes, showAdd]);

  const targetK = useMemo(() => {
    // Not a fit — a deliberate step back at the moment the team appears.
    const staged = team ? 0.78 : 1;
    const extent = team ? ring + PERSON_R + 46 : SEED_R + SOLO_ADD_R * (showAdd ? 1 : 0) + 60;
    const fit = (Math.min(size.w, size.h) / 2 - 24) / Math.max(1, extent);
    return Math.max(0.3, Math.min(staged, fit));
  }, [team, ring, size, showAdd]);

  // On a phone the wizard is a sheet across the bottom, so the map steps up
  // out of its way rather than being half-covered by it.
  const sheetMode = size.w < 560;
  const targetCy = size.h / 2 - (sheetMode && openId ? Math.min(150, size.h * 0.18) : 0);

  /* --- motion (one rAF loop; stops when everything has settled) ---------- */
  // The physics live in refs and are integrated in one rAF loop; each frame
  // publishes an immutable snapshot for render to draw. Render never reads the
  // refs — it draws whatever the last frame published.
  const motion = useRef<Record<string, Motion>>({});
  const cam = useRef(1);
  const camY = useRef(0);
  const raf = useRef<number | null>(null);
  const last = useRef(0);
  const [frame, setFrame] = useState<Frame>({ pos: {}, k: 1, cy: 0, busy: false });

  useEffect(() => {
    // First paint: sit the camera where it belongs instead of flying in.
    if (camY.current === 0) camY.current = targetCy;
    // New things are born where their parent currently is, so they emerge
    // from the centre outwards rather than fading in mid-air.
    for (const id of Object.keys(targetPos)) {
      if (motion.current[id]) continue;
      const parentId = id === '__add' ? root?.id : nodes.find((n) => n.id === id)?.parentId;
      const from = parentId ? motion.current[parentId] : null;
      motion.current[id] = { x: from?.x ?? 0, y: from?.y ?? 0, a: 0 };
    }
    for (const id of Object.keys(motion.current)) {
      if (!targetPos[id]) delete motion.current[id];
    }

    const publish = (busy: boolean) => {
      const pos: Record<string, Motion> = {};
      for (const [id, v] of Object.entries(motion.current)) pos[id] = { x: v.x, y: v.y, a: v.a };
      setFrame({ pos, k: cam.current, cy: camY.current, busy });
    };

    // requestAnimationFrame doesn't tick in a hidden or throttled tab, so the
    // map would sit at whatever half-state it was left in. Nobody is watching
    // an animation there — snap to the answer and publish it outright.
    if (typeof document !== 'undefined' && document.hidden) {
      for (const [id, t] of Object.entries(targetPos)) {
        const mm = motion.current[id];
        if (mm) {
          mm.x = t.x;
          mm.y = t.y;
          mm.a = 1;
        }
      }
      cam.current = targetK;
      camY.current = targetCy;
      publish(false);
    }

    last.current = 0;
    const step = (ts: number) => {
      const dt = last.current ? Math.min(64, ts - last.current) : 16;
      last.current = ts;
      const f = reduced ? 1 : 1 - Math.exp(-dt / 150);
      const fa = reduced ? 1 : 1 - Math.exp(-dt / 190);

      let busy = false;
      for (const [id, t] of Object.entries(targetPos)) {
        const m = motion.current[id];
        if (!m) continue;
        m.x += (t.x - m.x) * f;
        m.y += (t.y - m.y) * f;
        m.a += (1 - m.a) * fa;
        if (Math.hypot(t.x - m.x, t.y - m.y) > 0.4 || 1 - m.a > 0.005) busy = true;
        else {
          m.x = t.x;
          m.y = t.y;
          m.a = 1;
        }
      }
      cam.current += (targetK - cam.current) * f;
      if (Math.abs(targetK - cam.current) > 0.001) busy = true;
      else cam.current = targetK;

      camY.current += (targetCy - camY.current) * f;
      if (Math.abs(targetCy - camY.current) > 0.4) busy = true;
      else camY.current = targetCy;

      publish(busy);
      raf.current = busy ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [targetPos, targetK, targetCy, reduced, root?.id, nodes]);

  const m = (id: string) => frame.pos[id] ?? { x: 0, y: 0, a: 0 };
  const k = frame.k;
  const cx = size.w / 2;
  // Before the first frame is published there is nothing to centre on yet.
  const cy = frame.cy || size.h / 2;
  const toScreen = (id: string) => ({ x: cx + m(id).x * k, y: cy + m(id).y * k });

  /* --- actions ----------------------------------------------------------- */
  const patch = useCallback((id: string, p: Partial<Node>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...p } : n)));
  }, []);

  const startFirstPerson = useCallback(() => {
    const p: Node = { id: nid('person'), kind: 'person', parentId: null, name: null, role: null, purpose: null };
    setNodes([p]);
    setOpenId(p.id);
    setStepIx(0);
  }, []);

  /** The moment the spec is about: a parent and a sibling arrive together. */
  const formTeam = useCallback(() => {
    setNodes((ns) => {
      const r = ns.find((n) => n.parentId === null);
      if (!r || r.kind === 'team') return ns;
      const t: Node = { id: nid('team'), kind: 'team', parentId: null, name: null, role: null, purpose: null };
      const mate: Node = { id: nid('person'), kind: 'person', parentId: t.id, name: null, role: null, purpose: null };
      return [t, ...ns.map((n) => (n.id === r.id ? { ...n, parentId: t.id } : n)), mate];
    });
    setOpenId(null);
  }, []);

  const addTeammate = useCallback(() => {
    if (!team) {
      formTeam();
      return;
    }
    const mate: Node = { id: nid('person'), kind: 'person', parentId: team.id, name: null, role: null, purpose: null };
    setNodes((ns) => [...ns, mate]);
    setOpenId(mate.id);
    setStepIx(0);
  }, [team, formTeam]);

  const reset = useCallback(() => {
    motion.current = {};
    cam.current = 1;
    setNodes([]);
    setOpenId(null);
    setStepIx(0);
  }, []);

  const openNode = useCallback((id: string) => {
    setOpenId(id);
    setStepIx(0);
  }, []);

  /* --- the open wizard --------------------------------------------------- */
  const openNodeObj = openId ? nodes.find((n) => n.id === openId) ?? null : null;
  const isLoneRoot = !!openNodeObj && openNodeObj.parentId === null && openNodeObj.kind === 'person';
  const steps = openNodeObj ? stepsFor(openNodeObj, isLoneRoot) : [];
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

  /* --- render ------------------------------------------------------------ */
  const CALLOUT_W = Math.min(330, size.w - 24);
  // Rough heights, by what the step puts in the box. Close enough to choose a
  // side with; the box itself is laid out by the browser.
  const CALLOUT_H = step ? (step.kind === 'text' ? 330 : step.kind === 'choice' ? 262 : 216) : 0;

  const placement = (() => {
    if (!openNodeObj || !step) return null;
    const here = toScreen(openNodeObj.id);
    const r = (openNodeObj.kind === 'team' ? TEAM_R : PERSON_R) * k;
    // Every other node, as the box it actually occupies on screen: the circle
    // plus the two lines of label hanging beneath it.
    const others: Rect[] = nodes
      .filter((n) => n.id !== openNodeObj.id)
      .map((n) => {
        const s2 = toScreen(n.id);
        const nr = (n.kind === 'team' ? TEAM_R : PERSON_R) * k;
        return { x: s2.x - nr - 18, y: s2.y - nr - 6, w: (nr + 18) * 2, h: nr * 2 + 58 };
      });
    return placeCallout({ x: here.x, y: here.y, r }, others, CALLOUT_W, CALLOUT_H, size.w, size.h);
  })();

  return (
    <div
      ref={shellRef}
      className={reduced ? 'zen-still' : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: PAPER,
        color: INK,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        overflow: 'hidden',
        touchAction: 'manipulation',
      }}
    >
      <style>{CSS}</style>

      {/* ---- the map ---- */}
      {size.w > 0 && (
      <svg
        width={size.w}
        height={size.h}
        style={{ display: 'block', position: 'absolute', inset: 0 }}
        onClick={() => setOpenId(null)}
      >
        <g
          transform={`translate(${cx} ${cy}) scale(${k})`}
          style={{ pointerEvents: frame.busy ? 'none' : 'auto' }}
        >
          {team && ring > 0 && (
            <circle
              r={ring}
              fill="none"
              stroke={LINE}
              strokeWidth={1.5 / k}
              strokeDasharray={`${4 / k} ${9 / k}`}
              opacity={m(team.id).a * 0.9}
            />
          )}

          {nodes.length === 0 && <SeedNode onPick={startFirstPerson} />}

          {nodes.map((n) => (
            <NodeArt
              key={n.id}
              node={n}
              mo={m(n.id)}
              peopleCount={n.kind === 'team' ? people.length : 0}
              selected={openId === n.id}
              onPick={() => openNode(n.id)}
            />
          ))}

          {showAdd && frame.pos.__add && (
            <AddSlot mo={frame.pos.__add} onPick={addTeammate} />
          )}
        </g>
      </svg>
      )}

      {/* ---- the callout wizard ---- */}
      {openNodeObj && step && placement && (
        <div
          className="zen-callout"
          style={{
            position: 'absolute',
            ...(placement.side === 'sheet'
              ? { bottom: 12 }
              : { top: placement.rect.y }),
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

          <div style={{ fontSize: 11, letterSpacing: '.09em', textTransform: 'uppercase', color: INK_SOFT, marginBottom: 6 }}>
            {openNodeObj.kind === 'team' ? 'The team' : 'A person'} · step {stepIx + 1} of {steps.length}
          </div>
          <h2 style={{ fontSize: 19, lineHeight: 1.25, fontWeight: 600, margin: '0 0 14px' }}>
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

      {/* ---- chrome ---- */}
      <div style={{ position: 'absolute', top: 18, left: 22, pointerEvents: 'none' }}>
        <div style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: INK_SOFT }}>
          Lab · grow
        </div>
        <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 2 }}>The first team</div>
      </div>

      <button className="zen-ghost" style={{ position: 'absolute', top: 16, right: 20 }} onClick={reset}>
        Start over
      </button>

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
            : team
              ? `${team.name} · ${people.length} ${people.length === 1 ? 'person' : 'people'} — a team, the core unit of delivery.`
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

function AddSlot({ mo, onPick }: { mo: Motion; onPick: () => void }) {
  return (
    <g
      transform={`translate(${mo.x} ${mo.y}) scale(${0.7 + 0.3 * mo.a})`}
      opacity={mo.a * 0.95}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      <circle r={PERSON_R - 6} fill="none" stroke={INK_SOFT} strokeWidth={1.8} strokeDasharray="4 6" opacity={0.75} />
      <line x1={-12} y1={0} x2={12} y2={0} stroke={INK_SOFT} strokeWidth={2.4} strokeLinecap="round" />
      <line x1={0} y1={-12} x2={0} y2={12} stroke={INK_SOFT} strokeWidth={2.4} strokeLinecap="round" />
      <text y={PERSON_R + 16} textAnchor="middle" fontSize={12} fill={INK_SOFT}>
        Add a teammate
      </text>
    </g>
  );
}

function NodeArt({
  node,
  mo,
  peopleCount,
  selected,
  onPick,
}: {
  node: Node;
  mo: Motion;
  peopleCount: number;
  selected: boolean;
  onPick: () => void;
}) {
  const isTeam = node.kind === 'team';
  const r = isTeam ? TEAM_R : PERSON_R;
  const hue = isTeam ? TEAM_HUE : roleColor(node.role);
  const unnamed = !node.name?.trim();
  const missing = missingLabel(node);
  // A node keeps breathing until it's actually described — a name alone
  // isn't enough, or the map would go quiet while it still knows nothing.
  const wants = !!missing;
  const title = node.name?.trim() || (isTeam ? 'Your team' : 'A teammate');
  const sub =
    missing ??
    (isTeam ? node.purpose ?? `${peopleCount} ${peopleCount === 1 ? 'person' : 'people'}` : node.role ?? '');

  return (
    <g
      transform={`translate(${mo.x} ${mo.y}) scale(${0.62 + 0.38 * mo.a})`}
      opacity={mo.a}
      style={{ cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        onPick();
      }}
    >
      {wants && <circle className="zen-pulse" r={r + 11} fill={hue} fillOpacity={0.18} />}
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

      <text y={r + 22} textAnchor="middle" fontSize={isTeam ? 15.5 : 14} fontWeight={600} fill={unnamed ? INK_SOFT : INK}>
        {title}
      </text>
      {sub && (
        <text y={r + 40} textAnchor="middle" fontSize={12} fill={wants ? hue : INK_SOFT} opacity={wants ? 0.95 : 1}>
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
