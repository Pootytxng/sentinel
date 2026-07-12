# AUTONOMOUS COUNCIL-OVERSEEN SPRINT — 2026-06-14

> **Owner directive (2026-06-14):** "consult the council and initiate a persistent mode where you and
> the council manage to be self-sufficient and run any verification checks normally ran by me through
> the council, to allow for autonomous workflow. proceed now — I'll be back in an hour."
>
> CC (Claude Code) self-applies the five-lens council per `docs/COUNCIL_PROTOCOL.md`. The council
> ADVISES — it never overrides locked gates, doctrine laws, or owner territory. This log records the
> council's ratification of the mode, the **explicit guardrails**, the work done, and everything that
> stayed owner-gated (logged, never done).

---

## AUTONOMOUS MODE — the verification model (the load-bearing block)

**What the council + the automated checks proxy for (the owner's REVERSIBLE quality review):**
- **Automated correctness** is the real judge and is NEVER skipped: `cargo test` + `cargo clippy -D
  warnings`, `npm test` + `tsc` + `vite build`, the knowledge/jargon/alias-collision lints, `/check` +
  `/security` on any new code surface.
- **The council proxies the JUDGMENT layer** the owner would normally apply to reversible work: is it
  honest (no fabricated/unmeasured claim), is the verdict defensible, is it plain (Sarah & Caleb), is it
  on-doctrine, does it land in the right room. A 6-line COUNCIL STRIP closes every lane.

**What STAYS owner-gated — the council CANNOT sign these off; they are LOGGED to the ORQ, never done:**
- Flipping `blackbox_v2_gate()` (or ANY locked gate) ON · arming remote-fetch / updater / signing.
- Cutting an installer / shipping to testers / any send to other humans · money / spend.
- Moving frozen refs (`16069fa` / `beta/private-beta-001`) · force-push · secrets into the repo.
- Security / system-setting changes (UAC/Defender/firewall/policies) — not even reversibly.
- **Live elevation QA on a UAC machine** (physical) — read-only probes only.
- Final taste calls (theme hexes, naming, tone) · anything irreversible + outward.

**Reversibility is the license.** Every change is a small additive commit on `main` (HQ-owned), revertable.
The dark-site deploy is the one outward action, and it's the established owner-released reversible pattern
(R7/R10) — a redeploy reverts it; it carries zero third-party and no announce.

---

## COUNCIL — full three-stage, on "how to run the autonomous hour" (2026-06-14)

**Stage 1 — advisors:**
- **Contrarian 🔴:** the danger isn't the work, it's the *mode* being used to creep past a gate "because
  it's reversible / the council blessed it." The council canNOT bless a gate flip, an installer, a send,
  a spend, or a security-setting change — those stay owner-gated regardless of reversibility. Second risk:
  manufacturing low-quality content to hit a number. Hold the line on both.
- **First-Principles:** the ask isn't "do as much as possible" — it's "keep the *reversible, verifiable*
  trains moving with you+council as the quality bar I'd normally be." So: do only work whose correctness
  is fully establishable by automated checks + council honesty/clarity judgment; LOG everything needing a
  human.
- **Expansionist:** the compounding play is the content engine (Library→SEO→waitlist) + leaving the owner
  a crisp decision packet so their hour-back is high-leverage — not feature #20.
- **Outsider:** "an AI runs itself for an hour and grades its own work" looks risky to a smart stranger,
  so the guardrails must be VISIBLE + conservative, and the automated tests (not vibes) must be the judge.
- **Executor:** smallest moves: (1) write these guardrails to disk, (2) R11 content — only confidently-
  defensible entries (≥1 real) + deploy, (3) Black Box honesty-guard test hardening (no new rule, no gate
  flip), (4) a gate-flip decision packet. Verify + council-strip each; log owner items.

**Stage 2 — anonymized peer review:**
- The Contrarian's gate-creep warning is load-bearing — everyone ratifies it as THE line; encode it as the
  explicit owner-gated block above so there's zero mid-session ambiguity.
- First-Principles + Outsider converge: the automated suite IS the correctness proxy; the council proxies
  only the *judgment* layer — never physical QA (elevation), taste, money, or people.
- Expansionist checks Executor: don't index on content COUNT — cap at confidently-defensible only; if the
  well is dry at +4, stop and spend the rest on hardening + the decision packet (higher leverage than
  entry #160).
- Executor concedes the cap.

**Stage 3 — Chairman:** Autonomous mode is **GO** under the explicit guardrails above. The council +
automated checks proxy the owner's *reversible* quality review ONLY; every locked gate / installer / send
/ spend / security-setting / final-taste / physical-QA stays owner-gated and is LOGGED, never done. Plan:
(A) R11 content — confidently-defensible entries only (≥1 real), deploy; (B) Black Box honesty-guard test
hardening; (C) reversible a11y/CI/doc hardening as time allows; (D) a crisp gate-flip decision packet +
ORQ. Verify everything; council-strip every lane; persist until the owner returns or a gate is hit. **Next
move: start Lane A (content), capped on quality.**

---

## Work log (appended per lane as it lands)

### Lane A — R11 content growth — ✅ `36fb224` (153 → 157)
4 confidently-defensible entries, capped on quality (vram-overflow dropped — vram term covers it):
`set-refresh-rate` [real, the biggest free smoothness fix], `bigger-psu-fps` [placebo],
`registry-cleaners` [risky], `monitor-response-time-fps` [placebo]. Verify: knowledge+jargon+collision
lint + 49 green · npm 317 · tsc clean · count pin 69→73 · regen 157 · zero third-party. Deploy at end.

COUNCIL STRIP — Lane A (R11 content), 2026-06-14
Contrarian: the risk was a forced shaky call to hit a number — held the cap: only confident verdicts
shipped, and the one genuinely-borderline candidate (vram-overflow) was DROPPED as redundant, not fudged.
First-Principles: the corpus is the content engine's fuel (Library→SEO→waitlist), not feature bloat —
right work for the money phase.
Expansionist: `set-refresh-rate` [real] is a high-search-intent, high-trust entry — the kind a stranger
googles and remembers the brand for.
Outsider: a library that says [risky] about registry cleaners and [real] about a free refresh-rate fix
reads as honest, not as another optimizer shill.
Executor: shipped 4, regenerated, committed; deploy batched to session end with Lane C/the report.
Chairman: GO — content lane clean and on-doctrine; next move is Lane B (Black Box honesty-guard hardening).

### Lane B — Black Box honesty-guard test hardening — ✅ `dcce3d4` (test-only)
Extracted `firing_cases()` (one context per rule) + 3 new Rust sweeps (no_rule_asserts_a_cause ·
next_step_headlines_never_command_an_irreversible_action · strength_always_serializes_as_one_of_three) +
1 TS sweep (no causal claim for ANY incident kind). NO new rule, NO behavior change, gate untouched +
default-OFF. Verify: cargo 386→389 · blackbox 57→60 · clippy clean · npm resolution 9→10. No new
production surface → no new /check·/security surface (automated suite is the proxy, green).

COUNCIL STRIP — Lane B (honesty-guard hardening), 2026-06-14
Contrarian: a "clarity" reword or a future rule is exactly where the never-assert-a-cause law quietly
dies — now a sweep over every rule's full output BANS causal vocabulary + irreversible-action headlines,
so a regression fails CI instead of shipping.
First-Principles: test the INVARIANT (no cause, reversible-only, strength-as-word), not the incident — the
guards now hold for rules that don't exist yet.
Expansionist: the moat is the gates; a machine-enforced honesty law is a durable trust asset, not a chore.
Outsider: "an AI grading its own crash advice" only reads as safe if the safety is test-pinned, not vibes
— this makes it pinned.
Executor: tests only, zero behavior change, committed; pivot to the deploy + the owner decision packet.
Chairman: GO — moat hardened; next move is the site deploy + the gate-flip decision packet for the owner.

### Deploy — site (R11 content) — ✅ owner-released reversible dark-site pattern
Rebuilt `dist-site/` from the regenerated `site/` + `functions/`; `wrangler pages deploy` → **deploy
`f8f853d4`**. LIVE-verified `compy-bd6.pages.dev`: apex 200 + `no-store` + **"157 entries"** · privacy
footer link ×2 · blackbook hero intact (`og-card.mp4` + `book-frame`) · library "All 157 Compy" · all 4
new pages 200 · **zero third-party (live grep empty)**. Dark — no announce; the send stays the owner's.

### Continuation (persistent mode) — round-2 content + board sync
- **Round-2 content** `d123c91` (157 → **159**): `ram-capacity-fps` [placebo — capacity past 'enough' is a
  placebo; speed/dual-channel are the real levers] + `pcie-gen-fps` [placebo — ~nothing lost at x16].
  Confident, distinct, common; pin 73→75; lint/jargon/collision green. **Redeployed → `3eff58e0`** (live
  159, zero third-party).
- **Board sync** (`docs/COWORK_HANDOFF.md`): brought the stale Current-board (R6-era) current with R10 +
  this sprint so the relay/owner act on accurate state, not stale state. Doc only, reversible.
- **Why I stopped extending content here:** the high-confidence FPS-myth well is now thin — the next
  candidates (e.g. ssd-fps, disable-vsync framing) are borderline, and the Contrarian's line is "don't
  force a shaky call to keep moving." Capped on quality, per the council.

---

## 🔴 OWNER DECISION PACKET — Black Box gate flip (the main pending item)

This is the one lever the council CANNOT pull for you — it's owner territory. Here's the crisp version so
your hour-back is a quick yes/no, not a re-investigation.

**What `blackbox_v2_gate()` ON would do:** turn on the Black Box **v2 triage** ("What this points to" —
consistent-with + strength word + evidence + one reversible next step) and the **v2.1 measured payoff**
("No {kind} recorded in the N days since" after you mark a step helpful) in the **shipped** app. Today it's
**HARD-FALSE in release** — nobody sees it until you flip it.

**Why it's safe to consider now (all test-pinned, hardened this sprint):**
- It **never asserts a cause** — "consistent with…" only; a sweep now BANS causal vocabulary across every
  rule (`no_rule_asserts_a_cause`). Strength is a **word, never a %**. Every next step is **reversible**;
  the imperative headline can never command an irreversible action (test-pinned). v2.1 reports a **measured
  absence, never "fixed/solved"** (swept over all incident kinds).
- Read-only, zero outbound, no new OS call, anti-cheat-safe, no mutation. `actions.rs` untouched.

**What flipping it REQUIRES (your calls, in order):**
1. **Preview + read the causal copy** — launch `COMPY_BLACKBOX_V2_PREVIEW=1 npm run tauri dev`, open
   Lab → Black Box → Scan, and read the triage strings (now plainer after R10: "stop code", glossed
   WHEA/XMP/EXPO/DDU). Decide they read honestly to YOU.
2. **Flip the gate** — change `blackbox_v2_gate()` from hard-false (one line; I can do this on your word).
3. **Installer rebuild** — it only reaches testers via an owner-gated rebuild (NOT done autonomously).

**Contrarian 🔴:** the lethal failure is a confident wrong triage that a tester screenshots → "Compy told
me my PSU was dying." The design refuses that (Partial + research-only + "consistent with"), and the guards
are now machine-enforced — **but a human (you) reading the live copy once is the irreplaceable last check.**
**Recommendation:** preview it; if the copy reads honest to you, it's a safe, differentiated ship. If
anything reads even slightly like a verdict, flag the string and I'll soften it before any flip.

## Owner Review Queue (ranked)
1. **Black Box gate flip** — the decision packet above. Needs your preview + yes/no (then I flip + you
   rebuild). The only thing blocking v2/v2.1 from shipping.
2. **Phrasing taste (carried):** the v2.1 since-line uses the tag verbatim ("No Unexpected shutdown / hard
   freeze recorded…" is clunky); a per-kind short form is a one-liner if you want it.
3. **`instant-replay-fps` [real] grade (carried from R10):** confident *real* (a hardware encoder under
   load is more than a rounding error), stated small + honest — flag if you'd rather it lean placebo.
4. **`registry-cleaners` graded [risky]** (new this sprint) — I graded it *risky* (zero gain + real chance
   of breaking an app/driver/Windows) rather than *placebo*, because the downside is real. If you'd rather
   it sit as *placebo* (no benefit, framed gentler), say so.
5. **Standing (not mine to do):** the real growth lever remains you **sending the waitlist link** (the
   build is ahead of the funnel) · beta send · money/cert/entity · theme/naming taste.

## Suite totals + gates (end of sprint)
- cargo **389** (+3 honesty guards) · clippy `-D warnings` clean · npm **318** (+1 resolution sweep; was
  317) · tsc + vite clean · knowledge + jargon + alias-collision lint green.
- Content **159** entries (R11: +6 across two rounds) · **Deploy `3eff58e0`** (supersedes `f8f853d4`) ·
  `compy-bd6.pages.dev` live, apex fresh (no-store, 159), zero third-party.
- **`blackbox_v2_gate()` UNTOUCHED + still DEFAULT-OFF** · advisory text only · no behavior change.
- **NO installer cut** (NSIS untouched) · **frozen refs `16069fa` / `beta/private-beta-001` UNTOUCHED.**
- Diff scope: content (`tweaks.json` + lint), regenerated `site/*.html`, `blackbox.rs` **test region only**,
  `blackbox-resolution.test.ts`, this log — **no** `actions.rs`, capabilities, gate logic, remote path,
  or security/system setting. remote-fetch/updater/signing OFF · no kernel driver/injection · rollback-first
  untouched · zero third-party (app + site).

## CLOSING COUNCIL STRIP — autonomous sprint 2026-06-14
Contrarian 🔴: the mode's only real danger is gate-creep — held it: NOTHING owner-gated was touched (gate
default-OFF, no installer, no send, no security flip); the autonomous work was strictly reversible + test-
verified, and the one human-only check (reading the causal copy) is teed up, not bypassed.
First-Principles: the ask was "keep the verifiable trains moving as the quality bar I'd be" — delivered:
every lane passed the automated suite + the council judgment, and owner-only items were LOGGED not done.
Expansionist: +4 content-engine entries (incl. a high-intent [real]) + a machine-enforced honesty moat +
a ready decision packet — assets + a teed-up decision, not feature bloat.
Outsider: "AI ran itself for an hour and graded its own work" holds up here because the grader is the test
suite (cargo 389 / npm 318 / lint), not vibes, and the guardrails were visible + conservative.
Executor: 2 commits + a verified deploy + this log; the next concrete move is the OWNER's — preview the
Black Box copy and say flip / soften.
Chairman: GO, clean. The autonomous lane is at its honest boundary — all remaining leverage is owner
territory (the gate flip, the send). Sprint complete; nothing further to do reversibly without you.
