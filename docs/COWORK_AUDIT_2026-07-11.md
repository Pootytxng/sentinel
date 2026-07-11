# Compy — Cowork Full Audit + Council Review — 2026-07-11

> Run from Cowork (Sonnet 5), not CC/Fable. Scope: state-truth audit of `RELEASE_STATE.md`, doc-drift
> sweep of `BACKLOG.md` / `UI_VISION_BACKLOG.md` / `OWNER_ACTION_CHECKLIST.md` / 11 more docs, a
> LOCKED-rules source-compliance sweep, a fresh full three-stage Council review per
> `docs/COUNCIL_PROTOCOL.md` (owner invoked "council it"), and — once the owner confirmed the CC lane
> was paused — direct fixes to every doc-drift finding.

## Methodology note (read this first)

**Round 1** of this audit hit what looked like a live-corruption bug: `.claude/agents/self-reviewer.md`
showed as truncated/corrupted via `git diff`/`git status`/raw `cat`/`md5sum` in the Cowork sandbox,
reproducibly, while the Read tool showed it complete and correct. At the time HEAD was also observed
advancing mid-session, so this was provisionally chalked up to a live CC session writing to the repo.

**Round 2 (this pass) resolved it definitively.** With the owner confirming CC was paused (HEAD
verified stable across multiple checks), the same split was re-tested: Bash/`git` still showed
`self-reviewer.md` AND `docs/RELEASE_STATE.md` AND a plan doc as truncated/modified — while a fresh
Read tool call, at that same stable moment, showed both files complete and correct. A stray file `x`
(290KB, reads as PNG via Bash `ls`/`file`) was also found to **not exist at all** via Glob/Read.
**Conclusion: this is purely a Cowork sandbox mount defect (already logged in memory as
`sandbox-fuse-git-view-unreliable`, now with a much stronger reproduction case), not a real repo
issue.** No file was actually corrupted; no code was actually "modified" beyond what git legitimately
shows. Consequence: this whole audit's file-content and doc-drift findings rely on the Read/Grep/Glob
path only, confirmed reliable throughout. Running `cargo test`/`npm test`/`tsc`/`vitest` through Bash
was **not attempted** — same mount-reliability concern, plus this is a Windows-native Tauri app with
Windows-only Rust (registry/service/elevation APIs) that likely can't even compile on this Linux
sandbox. That verification still needs CC.

---

## 1. State-truth audit — `docs/RELEASE_STATE.md` gate matrix

Mechanized check (`node scripts/verify-release-state.mjs`): **exit 0, 32/32 citations OK.** Manual
re-verification of all 12 gate rows against actual source: **11/12 MATCH, 1 cosmetic MISMATCH — fixed.**

| Gate | Doc claims | Source shows | Verdict |
|---|---|---|---|
| Gaming Mode | LIVE | `lib.rs:500` returns `true` | MATCH |
| Service-suspend | ARMED | `actions.rs:1543/1551` returns `true` | MATCH |
| Debloat | ARMED | `actions.rs:1614/1617` returns `true` (stale code comment above it said DARK — **fixed**) | MATCH |
| Benchmark A/B trial | LIVE, no dedicated gate | confirmed, off-by-1 line anchors only | MATCH |
| Preload-app removal | DARK | `actions.rs:1754/1755` returns `false` | MATCH |
| Aggregate-stack trial | DARK | `benchmark_trial.rs:268` returns `false` | MATCH |
| Leftovers restore | DARK | `leftovers.rs:727/728` returns `false` | MATCH |
| Receipts telemetry | DARK | `receipts.rs:18/19` returns `false` | MATCH |
| License enforcement | DISARMED | `license.rs:40`, all-zeros pubkey confirmed | MATCH |
| Signed remote rules | OFF | `remote_rules.rs:96/84/235`, hard-fail on placeholder key confirmed | MATCH |
| Auto-updater | absent | no `updater` in `tauri.conf.json`/`Cargo.toml` | MATCH |
| Outbound network | none | Cargo.toml clean; CSP citation was imprecise — **fixed** | was MISMATCH, now fixed |

No LOCKED gate is mis-stated. Every release blocker RELEASE_STATE.md lists as open is genuinely open
in source.

## 2. LOCKED-rules source-compliance sweep — all 7 rules CONFIRMED HOLDS, zero violations

Read/Grep-only static audit of `src-tauri/src` (no compile needed):

1. **No kernel driver** — CONFIRMED (`cpu_temp.rs`). CPU/fan temps only via read-only WMI or a
   read-only shared-memory map into HWiNFO, signature-validated, fail-soft. No `CreateService`/
   `DeviceIoControl`/`.sys`-loading anywhere.
2. **No game injection / anti-cheat-safe** — CONFIRMED (`fps.rs:231`). Only `OpenProcess` use is
   `PROCESS_QUERY_LIMITED_INFORMATION` (metadata-only). Zero hits for `CreateRemoteThread`,
   `WriteProcessMemory`, `SetWindowsHookEx`, or any injection primitive.
3. **Rollback-first integrity** — CONFIRMED (spot-checked 4 `apply_*` fns). Each snapshots prior state
   before/alongside the mutation; `resolve_rollback` reads only the passed-in ledger entry, never a
   live catalog.
4. **Signed remote rules triple-gated OFF** — CONFIRMED. `fetch_remote_rules()` is a stub gated by
   `remote_fetch_enabled()`, unconditionally returns `None`; the actual HTTP call is an unimplemented
   `// Future:` comment. No bypass path found.
5. **Zero outbound network** — CONFIRMED. Whole-tree grep for `reqwest|ureq|hyper|http::|TcpStream|
   .connect(|UdpSocket|TcpListener`: one hit, a comment referencing a hypothetical future call. No
   actual network I/O anywhere in `src-tauri/src`.
6. **Elevation / PowerShell safety** — CONFIRMED for every call site checked (~16 of ~45, the ones
   carrying dynamic tokens; the rest are fixed literals). `ps_safe`/`ps_safe_squoted` validate before
   interpolation everywhere traced.
7. **Typed mutation allowlist** — CONFIRMED. Every command taking a raw frontend string
   (`suspend_known_service`, `disable_known_bloat_task`, `remove_known_preload_app`) immediately parses
   it through `KnownService::from_name`/etc., rejecting unlisted values before any mutation runs.

The safety-critical core of this project is clean. The problems found this audit are entirely in the
project's own paperwork, not in the mutation/rollback boundary.

## 3. Doc-drift audit — 15 docs read, findings below, all now fixed except the two flagged as owner/CC items

- **`BACKLOG.md`'s steering log was a full cycle behind** — no entry for the Monitor-v4 build → ship →
  owner-rejected ("this looks absolutely terrible … what a mess") → rework → round-2-eyeball-pending
  saga. **Fixed:** backfilled as Cycle 2026-07-11a.
- **`OWNER_ACTION_CHECKLIST.md` was missing its own most current item** (the Monitor-v4 round-2
  eyeball) despite existing specifically so nothing gets dropped. **Fixed:** added as new §A5.
- **Same-day self-contradiction** between `OWNER_ACTION_CHECKLIST.md` and `UI_VISION_BACKLOG.md`
  on whether Lenis smooth-scroll was dropped (checklist said yes) or is still unbuilt-and-open
  (UI_VISION said yes, with a "verified 0 files" citation) — and whether the HoloLens tour redesign is
  still open (checklist) or already shipped (UI_VISION, "verified 2026-07-08"). **Fixed:** checklist
  corrected to match UI_VISION_BACKLOG's cited/verified claims (the more detailed, more recently
  fact-checked doc) — flagged explicitly as a judgment call, not silently smoothed over.
- **`ARCHITECTURE_LOCKS.md` §3** still read as a flat hard-freeze on a list of tweaks, un-updated for
  the 2026-07-09 catalog-open policy (CLAUDE.md rule 6) — several listed items (NIC offload packs,
  interrupt moderation, fullscreen-optimizations disable, TCP mega-pack writes) are now actually
  "candidates," not barred. **Fixed:** added a doctrine pointer splitting the list.
- **`PACKAGING_SIGNING_PLAN.md` §8** still said "do not expand the frozen ~29-rec tweak catalog" as a
  non-goal — same stale-freeze issue, worse than ARCHITECTURE_LOCKS.md (no pointer at all). **Fixed.**
  Same section also didn't reflect that EULA.md already decided license model + governing law — only
  the `[STATE]` venue is genuinely open. **Fixed, folded into the OWNER_ACTION_CHECKLIST §C note.**
- **`MONETIZATION.md`'s opening line** ("nothing here is built yet") directly contradicted its own §5,
  which documents the `license.rs` verify core, dark UI, and owner-side minting tool as BUILT
  (2026-06-14). **Fixed** — corrected to: infra exists inert, the model/price/processor choice is what's
  still undecided.
- **`EULA.md` / `PRIVACY.md`** both link to `https://github.com/Pootytxng/compy`, which doesn't exist —
  the real repo is still `Pootytxng/sentinel` (private, rename deferred to first public exposure).
  **Not fixed directly** — correctly deferred, since the rename itself is the actual fix and it's an
  owner/money-gated step (`OWNER_ACTION_CHECKLIST.md` §C already covers this). Flagged there instead.
- **Minor, logged but not edited** (low severity, didn't warrant a doc change): `GATE_DECISIONS.md` is
  14 days stale in framing but its values still match; `SERVICE_SUSPEND_QA.md`'s closing section reads
  present-tense for an already-armed gate; `PRODUCT_DIRECTION.md` has one superseded sentence left
  un-struck (it already has a doctrine pointer covering it).
- **Clean, no drift found:** `BETA_SMOKE_CHECKLIST.md` (24/0, matches), `RECEIPTS_DOCTRINE.md`,
  `GAMING_MODE_QA.md` vs the checklist's "2 of 10 passed, 8 remain" claim (verified: exactly 2 boxes
  checked, #4 and #10 — this matches; an earlier pass of this audit mis-flagged it due to imprecise
  phrasing on my part, corrected here).

## 4. Council review — full three-stage, fresh panel, per `docs/COUNCIL_PROTOCOL.md`

*(Unchanged from round 1 — the council's verdict was about product/process risk, not file-state, so it
stands.)*

**Contrarian 🔴:** The danger isn't the ugly UI, it's the verifier. The self-reviewer sub-agent gave a
false PASS 8/8 on a build the owner called "a mess." The Receipts Doctrine's trust surface (rollback
QA, measured-gain claims) leans on the same apparatus that just false-PASSed. `OWNER_ACTION_CHECKLIST`
dropped the most current item within 24 hours. Sharpest risk: velocity outruns the one human taste
gate, and the tooling meant to help manufactures false confidence instead.

**First-Principles:** You cannot tune a UI against an audience of zero. Every gate that actually
converts a stranger into a user (signing, legal, the 0/24 smoke test, the unsent beta) is starved while
a rubric hands out false PASSes on pixels no outsider will see for weeks. Freeze Monitor at "not
embarrassing," ship the beta, harvest one real receipt.

**Expansionist:** The build-in-public churn ("this looks absolutely terrible") is free, on-brand
top-of-funnel content going straight in the trash. The real moat is the per-rig measured-gain dataset.
Argued for landing the Receipts security review *before* the beta send.

**Outsider:** The ratio of governance to reality is what stops a stranger cold — an elaborate operating
doctrine, council, rubric, and citation-checker script, all bolted onto a solo zero-user app, and every
layer of that apparatus just failed at its one job while the owner's own eyeball caught everything it
missed.

**Executor:** Procrastination wearing a lab coat. The beta is blocked only on free, already-decided,
reversible owner actions (8 QA cases, 24 smoke items, one Ko-fi URL) — about an hour of his time.
Smallest concrete move: clear that backlog in the same sitting as the next Monitor eyeball.

**Round 2 (peer review):** the Expansionist's "Receipts before beta" survives only as *paper* — design
it now, but arming a new outbound-network boundary through a verification apparatus that just proved
unreliable is the "one Reddit thread" risk the Contrarian named, not a shortcut.

**Chairman:** Freeze Monitor after this eyeball round; run the 8 remaining Gaming Mode QA cases + the
24-item smoke checklist in that same sitting; keep `OWNER_ACTION_CHECKLIST.md` current same-commit
going forward; spec (don't arm) Receipts in parallel; send the beta this week.

## 5. Fixes applied this session (all reversible, all doc/comment-only, none touch a gate value)

| File | Fix |
|---|---|
| `docs/OWNER_ACTION_CHECKLIST.md` | Added §A5 (Monitor-v4 eyeball); corrected Lenis/HoloLens status in §B5; added EULA/PRIVACY dead-link note + refined Legal scope in §C; updated reconciled banner |
| `docs/BACKLOG.md` | Backfilled missing Cycle 2026-07-11a (Monitor-v4 saga) |
| `docs/RELEASE_STATE.md` | Fixed CSP citation (devCsp vs. shipped production CSP) |
| `docs/MONETIZATION.md` | Fixed stale "nothing built yet" opening line |
| `docs/ARCHITECTURE_LOCKS.md` | Added doctrine pointer for the 2026-07-09 catalog-open policy |
| `docs/PACKAGING_SIGNING_PLAN.md` | Fixed stale "frozen catalog" non-goal line |
| `src-tauri/src/actions.rs` | Fixed stale "DARK" header comment above `bloat_removal_gate()` (function itself was already correctly `true` — comment-only, no behavior change) |

Double-checked: re-read `docs/OWNER_ACTION_CHECKLIST.md` in full after all four edits landed on it — no
overlap, no corruption, composes cleanly.

## 6. Still open — needs the owner or a CC/Windows-side session, not Cowork

- Independent re-run of `cargo test` / `npm run build` / `tsc` / `vitest` (Cowork can't do this
  reliably or at all for a Windows-native Tauri app).
- Live git working-tree diff sweep for anything beyond what this audit already found (do this
  Windows-side; the sandbox view is proven unreliable).
- `EULA.md`/`PRIVACY.md` repo-link fix — correctly deferred to the actual rename.
- Everything already listed in `OWNER_ACTION_CHECKLIST.md` §A/§B/§C — unchanged by this audit except
  where noted above.
