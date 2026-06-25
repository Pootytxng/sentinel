export const meta = {
  name: 'compy-burst',
  description: 'Cost-bounded parallel burst: triage the backlog -> build N disjoint, non-gated, buildable items with full rigor -> land each on main -> ONE integration verify. Replaces the perpetual lane runners; hard budget cap, no dry-spin, no per-tick overhead.',
  phases: [
    { title: 'Triage', detail: 'pick the highest-value disjoint non-gated buildable items' },
    { title: 'Build', detail: 'one isolated worktree agent per item, lands on main' },
    { title: 'Verify', detail: 'single integration check on the merged result' },
  ],
}

// ---------- budget-aware sizing ----------
// Output-token cost of one full build agent (TDD + checks + green + land).
// CALIBRATED from the first real burst (2026-06-25): ~402k output / ~660k total for ~2 built items => ~200k output/item.
const COST_PER_ITEM = 200_000
const HARD_MAX = 6                                   // never exceed this many builds per burst
const reqMax = (args && args.maxItems) || null       // optional caller cap
const includeMarginal = !!(args && args.includeMarginal)

let fleet
if (budget.total) {
  // leave headroom for triage (~cheap) + verify (~cheap); -1 item of slack
  fleet = Math.max(1, Math.min(HARD_MAX, Math.floor(budget.remaining() / COST_PER_ITEM) - 1))
} else {
  fleet = reqMax || 3                                // conservative default when no budget target set
}
if (reqMax) fleet = Math.min(fleet, reqMax)
log(`compy-burst: ${budget.total ? Math.round(budget.remaining()/1000) + 'k tokens left' : 'no budget target'} -> up to ${fleet} item(s) this burst`)

// ---------- Triage (cheap, read-only) ----------
phase('Triage')
const TRIAGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'domain', 'files', 'why'],
        properties: {
          title:  { type: 'string' },
          domain: { type: 'string', description: 'backend|measurement|peripheral|content|honesty|other' },
          files:  { type: 'array', items: { type: 'string' }, description: 'exact files this item will touch (+ their tests)' },
          why:    { type: 'string' },
        },
      },
    },
  },
}
const triage = await agent(
  `Read docs/BACKLOG.md and docs/LANE_BUS.md (the section-5 claimable pool). Return up to ${fleet} of the ` +
  `HIGHEST-VALUE, non-gated, CLEANLY-BUILDABLE Phase-A items, each in a DISJOINT file domain (no two items touch ` +
  `the same file; at most ONE may touch src-tauri/src/lib.rs). EXCLUDE: gated items (Phase B mutation / C ` +
  `telemetry / D money), feasibility-walled items (CPU temp, OSD/strobe detection, anything needing a kernel ` +
  `driver or vendor SDK), and ${includeMarginal ? 'include marginal advisory items only after higher-value ones run out' : 'skip marginal/low-value items unless nothing better remains'}. ` +
  `For each: title, domain, the exact files it touches, and why it is worth building. READ-ONLY: do not edit anything.`,
  { schema: TRIAGE_SCHEMA, phase: 'Triage', effort: 'low', agentType: 'Explore' }
)
const items = ((triage && triage.items) || []).slice(0, fleet)
if (!items.length) {
  log('Triage: no buildable non-gated items — Phase A is complete or the remainder is gated/walled.')
  return { shipped: [], note: 'nothing buildable; remaining work is gated or walled', spent: budget.spent() }
}
log(`Triage selected ${items.length}: ${items.map(i => i.title).join(' | ')}`)

// ---------- Build (parallel, budget-gated, isolated worktrees) ----------
phase('Build')
const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'status'],
  properties: {
    title:  { type: 'string' },
    status: { type: 'string', description: 'landed | failed | skipped' },
    commit: { type: 'string' },
    note:   { type: 'string' },
  },
}
const results = await parallel(items.map((it) => async () => {
  if (budget.total && budget.remaining() < COST_PER_ITEM) {
    return { title: it.title, status: 'skipped', note: 'budget guard — stopped to stay under the cap' }
  }
  return agent(
    `Build ONE Compy feature on your isolated worktree. ITEM: "${it.title}" (domain: ${it.domain}). ` +
    `Touch ONLY these files plus their tests: ${it.files.join(', ')}. It MUST stay read-only/advisory — no new ` +
    `Windows mutation, no capability/CSP/updater/remote-fetch change, nothing gated. Full rigor: write tests FIRST ` +
    `(TDD), implement, run /check and /security, and confirm cargo test + npm test + npm run build are GREEN. ` +
    `If it is a UI change, self-review it. THEN land on main: git add only your files, commit (after a ` +
    `git branch --show-current + git status check), git fetch origin, git rebase origin/main, re-confirm green, ` +
    `then git push origin HEAD:main — if rejected, re-fetch/rebase/retest and retry until it lands. Keep ledger ` +
    `edits to ONE line in docs/BACKLOG.md. If the item turns out gated, walled, or already-done, do NOT build it — ` +
    `return status:skipped with why. Return {title, status: landed|failed|skipped, commit, note}.`,
    { schema: BUILD_SCHEMA, phase: 'Build', label: `build:${it.domain}`, isolation: 'worktree', effort: 'medium' }
  )
}))
const ok = results.filter(Boolean)
const landed = ok.filter(r => r.status === 'landed')
log(`Build: ${landed.length} landed, ${ok.filter(r => r.status !== 'landed').length} skipped/failed`)

// ---------- Verify ONCE on the merged result ----------
phase('Verify')
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['green'],
  properties: {
    green:  { type: 'boolean' },
    cargo:  { type: 'string' }, vitest: { type: 'string' }, build: { type: 'string' },
    problem:{ type: 'string', description: 'culprit + which commit, if red' },
  },
}
const verify = await agent(
  `On the main checkout: git fetch origin && git merge --ff-only origin/main. Then run ONE integration check: ` +
  `cargo test --manifest-path src-tauri/Cargo.toml ; npm test ; npm run build. If exactly one test file fails, ` +
  `RE-RUN it in isolation before calling it red (heavy tests flake under load). Report {green, cargo, vitest, ` +
  `build, problem}. READ-ONLY: report only, do not fix.`,
  { schema: VERIFY_SCHEMA, phase: 'Verify', effort: 'low' }
)

return {
  shipped: landed.map(r => ({ title: r.title, commit: r.commit })),
  skipped: ok.filter(r => r.status !== 'landed'),
  verify,
  spent: budget.spent(),
}
