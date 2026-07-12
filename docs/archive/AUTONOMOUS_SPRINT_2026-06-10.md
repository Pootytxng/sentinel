# Autonomous Improvement Sprint — 2026-06-10

> Owner-mandated autonomous sprint (broad reversible mandate, locked gates + security/system
> settings + outward/irreversible actions excluded). This is the running log: what was done
> (commit hashes), what was found, what was self-verified, and the ranked owner-deferred list.
> Worked by the HQ (Claude Code) lane on `main`, pushed as it goes.

## Baseline (Stage 0)

- Start point: `main` @ `229882b` (post-§4-QA, security rule recorded, tree clean).
- Orientation read: CLAUDE.md, docs/COWORK_HANDOFF.md, docs/superpowers/plans/2026-06-04-beta-build-order.md.
- Green baseline: (recorded below when the run completes).

## Stage log

**Baseline:** cargo 243 · npm 226 · tsc clean (`229882b`).

**Stage 1 — design-law sweep: ZERO violations.** Audited the app against every law. Findings:
the doorknob law is held (interactive `<div onClick>` are all modal backdrops/stop-propagation
wrappers, not fake buttons); "stable" appears only inside the honest-measurement copy that
*forbids* a bare "stable"; decorative SVGs/dots/auroras are consistently `aria-hidden`; the
shimmer/contrast/rail-parity guard tests are green. `word-break: break-all` on adapter/path/cmd
strings is intentional (long-token wrap fix, commented). No fixes needed — the laws are enforced.

**Stage 2 — hardening (2 commits):**
- `4d01be9` — `gpuRunningHot` recency window (14d) + `measureTuning` zero-session honesty
  ("Nothing measured yet" instead of an invented null verdict). +4 tests. Closes the recorded
  LOW from the 2026-06-09 /check.
- `2ab405d` — receipt-title cap (200 chars) at the webview trust boundary (defense-in-depth so a
  compromised UI can't bloat history.json). +1 test. cargo 244.

**Stage 3 — accessibility (`19c4fbb`):** added `role="dialog"`/`aria-modal`/`aria-labelledby` to
the three content modals that lacked them (export report, Learn quick-look, Knowledge library);
ConfirmDialog + GamingMode already had it. Reduced-motion honored in 20 CSS blocks; rail labels
are visible text; decorative glyphs `aria-hidden`. No icon-only unlabeled buttons found.

**Stage 4 — performance (`387958f`):** the main monitoring tick is already visibility-gated
(`if (!active) return`); backend polls are standard 1s. Found + fixed one real ambient-cost waste:
`AmbientBackdrop` polled `get_fps_status` every 1.5s whenever ambiance was on, but the result feeds
ONLY the step-aside guard — with step-aside-on-game off, that IPC ran forever unused. Now gated on
`freezeOnGame`. Numbers: removes ~40 IPC calls/min on the main window for users who haven't enabled
step-aside (and the aurora is Home-only, so most of the time).

**Stage 5 — beta doc double-check: PASS with copy flags.** `BETA_TESTER_README` matches the shipped
six-home IA (Home·Check·Play·Fix·Learn·Lab), the theme names (Halfway/Midnight/Hearth match
`theme.ts`), NVIDIA honesty, no-CPU-temp, and Gaming-Mode-dark are all accurate. `site/index.html`
is honest on anti-cheat/no-telemetry/undo/NVIDIA. Findings are all COPY on the outward-facing site +
tester doc → deferred to owner/Cowork (voice/taste lane), see below. Packaged smoke not re-run this
sprint (needs an owner-present UAC machine for the apply/rollback legs; the `AF10BEC1` build is
current).

**Stage 6 — upward growth (2 commits):**
- `63e8a54` — 3 honest Library debunks in THE VOICE (all-original): `disable-smt-gaming` (placebo),
  `nvidia-prefer-max-performance` (real/narrow), `cpu-affinity-games` (placebo). These are graded
  EXPLAINERS, not appliable recs — Compy applies none, so the ~29 appliable-catalog freeze + the
  optimizer-rot blocklist are untouched. The Library's exact-count curation drift-guard bumped 43→46
  (same mechanism the owner used for aim-tweaks). Lint green (no dupes/dangling-links/empties/banned
  words). **✅ RATIFIED by the owner (2026-06-10):** the 3 debunks stay — they're knowledge, not
  appliable catalog.
- `d51f6f0` — SCOPE-ONLY spec `2026-06-10-tuning-followons-and-share-card-SCOPE.md`: NVIDIA undervolt
  (guide-only now, measurement gated on a verified NVML session), AMD CPU PBO (measures 1% low not CPU
  temp; stability proves over days), wave-2 local-only share card. Nothing built; each names its home
  room + affordance + verification milestone.

**Stage 7 — consistency.** Fixed one active inaccuracy the sprint created: CLAUDE.md's tuning banner
called the `gpuRunningHot` no-recency-window a "known-accepted LOW, don't re-raise" — now closed by
`4d01be9`, so the banner is corrected. Added a sprint banner at the top of CURRENT STATE pointing here.
Did NOT rewrite the historical test counts (68/68, 81/81, …) lower in CLAUDE.md — they're point-in-time
records framed as history, and the file header already says to treat them as such; rewriting = churn.

## Self-verification summary

Every commit rode `cargo test` and/or `npm test` + `tsc` green before push; clippy clean on the Rust
change; the knowledge lint (dupes/dangling/empties/banned-words) green on the content add. End state:
**cargo 244 · npm 230 · clippy 0 warnings · tsc clean.** No /check or /security primitive was added
(the title cap reduced attack surface; the rest is frontend/content/docs). Locked gates, security/system
settings, frozen beta refs (`16069fa` / `private-beta-001`), `gaming_mode_gate`, remote-fetch + updater,
capabilities/CSP — all untouched and unread-only-diagnosed where relevant.

## Commits (this sprint)

`4d01be9` tuning recency+zero-session · `2ab405d` receipt-title cap · `19c4fbb` modal a11y ·
`387958f` ambient poll gating · `63e8a54` 3 library debunks · `d51f6f0` scope-only spec ·
(+ CLAUDE.md/log consistency commit).

## Owner-deferred (ranked)

1. **[Site copy · brand-honesty] Hero headline "Faster frames."** — ✅ RESOLVED by the owner
   (2026-06-10): headline is now **"Faster where it's real. Zero snake oil."** (owner's wording),
   mirrored into the `<title>` + `og:title` tags that carried the same phrase. The site no longer
   promises frames the product explicitly doesn't (BETA_TESTER_README §1).
2. **[Site copy · factual] "116 entries"** — ✅ FIXED this sprint (`site/index.html` → "120+ entries and
   counting", drift-proof). The real count is now ~124 (tweaks 46 · terms 55 · tricks 14 · guides 7 ·
   +1 tuning · +1 grading). A factual correction on a parked asset, within the "polish site/" grant —
   distinct from the hero-headline brand call (#1), which stays the owner's.
3. **[Tester doc · low] README §5 wording** — step 3 ("Apply the #1 fix … and chose 'compare next
   session'") slightly conflates a plain Fix/Check apply with the debrief's combined
   "Apply the #1 fix — compare next session" button (`SessionDebrief.tsx:385`); arming is offered in
   the debrief, not the standalone apply. Minor; Cowork's voice lane.
