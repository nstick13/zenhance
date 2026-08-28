/**
 * Findings policy (S5 tab 5) — the workspace's rules for which findings the
 * detectors are allowed to raise. Pure and client-safe (no React, no DB): the
 * detector engine in `findings.ts` reads this to decide what fires, and the
 * settings tab edits it.
 *
 * Two layers, both settled on the analytics design canvas:
 *  1. **Detectors on/off** — a workspace can silence a whole detector.
 *  2. **Per-discipline Spread threshold** — "on N+ teams" is a *fact*; whether
 *     it becomes a finding is the organisation's call, and it differs by
 *     discipline. A Security Engineer across six teams is the job in one org
 *     and a bus-factor risk in the next, so the threshold is set per discipline:
 *       • flag at N   → a number
 *       • no limit    → null (never flag this discipline — this is also how the
 *                        old hard-coded "platform is exempt" is expressed now)
 *       • unset       → no entry; inherit the workspace default
 *
 * The default policy reproduces the pre-config behaviour exactly (every
 * detector on, Spread at the seeded threshold for everyone), so a workspace
 * with no stored policy — or one read before the table exists — behaves as it
 * did in v0.1.36.
 *
 * Per-instance exceptions (the "9 of 12 reviewed" layer) are deliberately NOT
 * here yet — see the roadmap; they need finding-instance identity and a review
 * UI that only pays off once findings render on the live canvas.
 */

/**
 * Default team count at which Spread fires, workspace-wide. Lives here (the
 * leaf module) rather than in findings.ts so the default policy can reference
 * it without a circular import — findings.ts re-exports it for callers. It's a
 * seeded default: `computeSpreadFindings` takes a threshold argument, and the
 * per-discipline policy overrides it.
 */
export const SPREAD_TEAM_THRESHOLD = 2;

export type FindingsPolicy = {
  spreadEnabled: boolean;
  overCommitmentEnabled: boolean;
  couplingEnabled: boolean;
  /** Workspace-wide team count at which Spread fires when a discipline is unset. */
  defaultSpreadThreshold: number;
  /** Per-discipline override: N = flag at N; null = no limit. Absent = inherit. */
  perDiscipline: Map<string, number | null>;
};

export const DEFAULT_FINDINGS_POLICY: FindingsPolicy = {
  spreadEnabled: true,
  overCommitmentEnabled: true,
  couplingEnabled: true,
  defaultSpreadThreshold: SPREAD_TEAM_THRESHOLD,
  perDiscipline: new Map(),
};

/**
 * One row of `findings_policy`. The row whose `disciplineId` is null carries
 * the workspace-wide config (detector switches + default threshold); every
 * other row carries a single discipline's Spread override in `spreadThreshold`.
 */
export type FindingsPolicyRow = {
  disciplineId: string | null;
  spreadThreshold: number | null;
  spreadEnabled: boolean;
  overCommitmentEnabled: boolean;
  couplingEnabled: boolean;
};

/** Fold DB rows into a resolved policy. Unknown/absent rows fall back to the
 *  defaults per field, so a partial table can never crash the engine. */
export function resolveFindingsPolicy(rows: FindingsPolicyRow[]): FindingsPolicy {
  const workspaceRow = rows.find((r) => r.disciplineId === null);
  const perDiscipline = new Map<string, number | null>();
  for (const r of rows) {
    if (r.disciplineId !== null) perDiscipline.set(r.disciplineId, r.spreadThreshold);
  }
  return {
    spreadEnabled: workspaceRow?.spreadEnabled ?? DEFAULT_FINDINGS_POLICY.spreadEnabled,
    overCommitmentEnabled:
      workspaceRow?.overCommitmentEnabled ?? DEFAULT_FINDINGS_POLICY.overCommitmentEnabled,
    couplingEnabled: workspaceRow?.couplingEnabled ?? DEFAULT_FINDINGS_POLICY.couplingEnabled,
    defaultSpreadThreshold:
      workspaceRow?.spreadThreshold ?? DEFAULT_FINDINGS_POLICY.defaultSpreadThreshold,
    perDiscipline,
  };
}

/**
 * The Spread threshold that applies to a person with this discipline: their
 * discipline's override if one is set (including `null` for no limit), else the
 * workspace default. Returns `null` when Spread should never fire for them.
 */
export function spreadThresholdFor(
  policy: FindingsPolicy,
  disciplineId: string | null,
): number | null {
  if (disciplineId !== null && policy.perDiscipline.has(disciplineId)) {
    return policy.perDiscipline.get(disciplineId) ?? null;
  }
  return policy.defaultSpreadThreshold;
}
