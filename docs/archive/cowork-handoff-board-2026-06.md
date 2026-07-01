# COWORK_HANDOFF — archived board log + resume points

> Split out of `docs/COWORK_HANDOFF.md` on 2026-06-28 — it was ~370 lines of reverse-chronological
> point-in-time board log embedded in what is meant to be durable onboarding doctrine. Kept verbatim as
> history. **Current status → `docs/BACKLOG.md`; current gate/build state → `docs/RELEASE_STATE.md`.**

---

## Current board (update as you go)

- **🟢 BLACK BOX v2 GATE FLIPPED ON (owner-authorized 2026-06-14, `f43e047`).** `blackbox_v2_gate()` now
  ships ON in release/dev — v2 triage + v2.1 measured-payoff are LIVE (read-only; cfg-split keeps the
  test default OFF so all guard tests stay green). cargo 398 · /security clean · every honesty guard
  enforced. **NO installer cut — reaches testers only on the owner's next rebuild.** All OTHER gates
  (gaming_mode/receipts/remote_fetch/restore/licensing) remain default-OFF; frozen refs untouched. Also
  this session: the **Compy Pro licensing path is solo-complete** (verify `19af35b` + dark UI `129108e`
  + owner-side $0 minting tool `39ba40b`; arming + model/price/split stay owner-queued in
  `docs/MONETIZATION.md` + `STATE_OF_COMPY_2026-06-14.md`). Content engine at **174**.
- **✅ R10 LANDED + R11 AUTONOMOUS COUNCIL-OVERSEEN SPRINT LANDED (2026-06-13/14).** Site at **159
  entries**, deployed + live (`compy-bd6.pages.dev`, latest deploy `3eff58e0`, apex no-store/fresh, zero
  third-party). **R10** (`0d76675` content 147→153 · `a4894ac` Black Box copy-clarity polish — "bugcheck"→
  "stop code", WHEA/XMP/EXPO/DDU glossed, NO behavior change, all guards green · deploy `3cb5fea2`).
  **R11 autonomous sprint** (owner: "consult the council + initiate persistent self-sufficient mode, back
  in an hour"; log: `docs/superpowers/AUTONOMOUS_SPRINT_2026-06-14.md` with the full guardrail block +
  council strips): `36fb224` content 153→157 (set-refresh-rate [real] + bigger-psu-fps / registry-cleaners
  [risky] / monitor-response-time-fps [placebo]) · `d123c91` round-2 157→159 (ram-capacity-fps / pcie-gen-fps
  [placebo]) · `dcce3d4` Black Box **honesty-guard test hardening** (test-only: machine-bans causal
  vocabulary + irreversible-action headlines + non-word strengths across every rule; cargo 386→389, npm
  →318). **Mode guardrails held:** council/automated-suite proxied only the owner's REVERSIBLE quality
  review; everything owner-gated (gate flip, installer, send, spend, security-setting, taste, physical QA)
  was LOGGED, never done. **Gate `blackbox_v2_gate()` UNTOUCHED + default-OFF · NO installer cut · frozen
  refs untouched.** 🔴 **OWNER hour-back item:** the **Black Box gate-flip decision packet** (in the R11
  log) — preview the v2 copy (`COMPY_BLACKBOX_V2_PREVIEW=1 npm run tauri dev` → Lab → Black Box), then
  flip/soften; the honesty is now fully test-pinned, the only un-automatable check is you reading the live
  copy once. ORQ also: verbatim-tag since-line phrasing · `instant-replay-fps`/`registry-cleaners` grades ·
  the standing lever = **you sending the waitlist link** (build is ahead of the funnel). Earlier detail —
- **🩺 BLACK BOX FEATURE-COMPLETE THROUGH v2.1 + AUDITED; v3 GATED; R10 momentum lane queued (2026-06-13).**
  v2.1 (`da20fb4`, frontend-only) audited CLEAN: `blackbox-resolution.ts` reports measured ABSENCE ("No
  {kind} recorded in N days since"), NEVER "fixed/solved/worked" — machine-enforced by a banned-word test
  CC widened (`fixed|solved|worked|cured|because|caused|resolved|guaranteed`); recurrences reported plainly;
  ≥1-day gate stops fabricated reassurance; did-this-help is localStorage-only, zero outbound; flag-OFF =
  v1. **MILESTONE:** Black Box now reads evidence → triages (consistent-with, never a verdict) → suggests
  reversible steps → proves results by measured absence, zero fabricated claims. **CEILING:** v3 (fleet
  crash-brain + affiliate) is GATED — new outbound/telemetry boundary, needs owner sign-off + `/security`.
  **Owner forks:** preview+flip v2 (`COMPY_BLACKBOX_V2_PREVIEW=1 npm run tauri dev`) → installer cut to
  testers · greenlight v3 (council the telemetry first) · new mountain (latency module candidate) · send
  the link. **R10 queued** (safe momentum): content growth + Black Box copy-clarity polish + site deploy —
  `docs/cowork-cc-relay/2026-06-13-R10-content-polish.cc.md`. Earlier v2 detail —
- **(v2)** v2 LANDED + COWORK-AUDITED (`4e87a3e`). v2 audit CLEAN
  against the triage-not-verdict law, verified in code: rule copy is all "consistent with…" (never asserts
  a cause; the power rule openly says "Windows didn't get to record why"), `Strength` is words not %,
  `NextStep.reversible` hard-wired true (irreversible fixes = `research_only` only), `assess()` returns
  None when no rule clears its bar (refuses to guess), and **`blackbox_v2_gate()` is COMPILED OUT OF
  RELEASE** (hard-false except `#[cfg(test)]` + a debug-only `COMPY_BLACKBOX_V2_PREVIEW=1` env) — a shipped
  binary can't emit an assessment. No installer cut, actions.rs/mutation/outbound untouched, frozen ref
  intact, flag-OFF = byte-identical v1. **Owner preview:** `COMPY_BLACKBOX_V2_PREVIEW=1 npm run tauri dev`
  → Lab → Black Box (read the copy before ever flipping the gate). **R9 = v2.1 queued** (measured "none
  since" proof + local did-this-help tally; honesty trap = report measured ABSENCE, never "the fix
  worked"): `docs/cowork-cc-relay/2026-06-13-R9-black-box-v2.1.cc.md`. Still flag-OFF, app-only, no
  installer cut, zero outbound. Council-approved train; the original R8 council/decision detail —
- **(R8 origin)** Full 3-stage council REFRAMED causal crash diagnosis: **triage + safe-next-step engine, NOT a
  verdict engine.** Full 3-stage council REFRAMED causal crash diagnosis: **triage + safe-next-step engine, NOT a
  verdict engine** — never asserts a cause, says "evidence is CONSISTENT WITH X → reversible step to
  confirm is Y," strength in WORDS (Strong/Partial/Weak) not percentages, **refuses to guess** on thin
  evidence, irreversible fixes (BIOS/RMA/repaste) only as "research," never "do this." 3–4 starter rules
  (overheating / graphics-driver / power-hard-lock / app-specific) + a "Did this help?" honesty loop.
  Spec: `docs/superpowers/specs/2026-06-13-black-box-v2.md`; work order:
  `docs/cowork-cc-relay/2026-06-13-R8-black-box-v2.cc.md`. **Built behind a default-OFF
  `blackbox_v2_gate()`, app-only, advisory TEXT only (no mutation/outbound/affiliate), NO installer cut** —
  reaches no tester until owner flips the flag + reviews the causal copy + cuts an installer. Affiliate +
  fleet brain = v3 (gated, only after rules field-proven). Return: `2026-06-13-R8-black-box-v2.REPORT.md`.

- **✅ R6 + R7 MARATHONS LANDED + COWORK-AUDITED + SITE LIVE @ 147 (2026-06-13).** R7 done:
  `fe1f026` Black Box WER+Reliability read sources (read-only, 45 tests, ZERO causal claims — merge only
  de-dups evidence) · `fa7624e` Lab `<h3>` a11y · `24af024` 5 entries 142→**147** + footer AA contrast
  (3.2→5.3:1). Deploy `0a2933ab` LIVE-verified by Cowork: apex fresh (no-store) serving **147**, Privacy
  footer+waitlist link, blackbook hero intact, zero third-party. cargo **374** / npm **308**; frozen refs
  + locked gates + appliable catalog untouched. **Cowork called STOP on reflexive R8** — build is ahead of
  the funnel; next levers are owner-only (send the waitlist link · Black Box v2 go/no-go). Earlier R6 audit
  below. R6 all 4 lanes clean
  (`c22aecb` Black Box v1 · `25b013f` 6 content entries 136→142 · `590d347` polish/a11y · `a0b8221`
  guards); cargo **356** / npm **308**. Cowork audited from disk + git: Black Box genuinely read-only
  (`blackbox.rs` no network/mutation/driver, `actions.rs` untouched), frozen appliable catalog untouched
  (the tweaks.json + disable-defender.html flags were FALSE alarms — Library explainers + a regen
  count-line, verified), frozen refs intact. **CC correctly HELD the R6 site deploy** (outward-facing) for
  owner review — good gate instinct. **Owner then said "decide what's best and continue" → Cowork
  RELEASED the deploy** (dark site, reversible, owner-greenlit-pattern) and queued **R7**:
  `docs/cowork-cc-relay/2026-06-13-R7-marathon.cc.md` — L1 Black Box v1 completeness (WER+Reliability read
  sources, still ZERO causal claims; app-only, no installer cut) · L2 the two logged a11y fixes · L3 4–6
  more honest entries · **L4 deploy R6+R7 site live + verify**. Explicitly NOT queued: **Black Box v2**
  (causal claims — gated on owner sign-off; honesty risk lives there). Return:
  `2026-06-13-R7-marathon.REPORT.md`. **Director's standing note: build is now AHEAD of the funnel — the
  real next lever is the owner SENDING the waitlist link, not feature #20.**

- **⚖️ LEGAL SURFACE COMPLETED (content) + RELAY-HANDED FOR SITE WIRING (2026-06-13, Cowork; owner
  decisions captured).** Owner: "get all the legal shit done." Owner calls taken via AskUserQuestion:
  **license = strict all-rights-reserved**, **governing law = United States** (specific state = the one
  `[STATE]` blank left for the owner). Cowork completed the CONTENT (docs/copy lane): `docs/EULA.md`→v0.3
  (§2 strict all-rights-reserved; §10 reconciled to disclose the website/waitlist email+hashed-IP; §12 US
  law + `[STATE]` venue placeholder), `docs/PRIVACY.md`→v0.2 (NEW "website & waitlist" section: email for
  one launch msg + SHA-256-hashed IP for spam, Cloudflare D1, zero third-party, retention/deletion; short
  version + contact reconciled), `LICENSE`→finalized proprietary (placeholder clause removed). **Gap that
  drove this: the live waitlist collects PII but the site linked NO policy.** SITE WIRING handed to CC via
  relay: `docs/cowork-cc-relay/2026-06-13-legal-pages.cc.md` (render PRIVACY/EULA as linked site pages +
  footer + link Privacy from the waitlist note + deploy; zero-third-party hard line). **🔴 OWNER TO-DOs
  (not blocking the beta, blocking PUBLIC launch):** fill the `[STATE]` venue blank · reconcile the
  copyright-holder name (LICENSE says "Kuya", EULA/Privacy say "Pootytxng" — pick the real legal name) ·
  get a professional legal review before public app distribution. Not legal advice — Cowork wired existing
  owner-authored drafts + the owner's two decisions.

- **🛟 BLACK BOX v1 SPEC'D + COUNCILED + RELAY-READY (2026-06-13, Cowork; owner away, council = sign-off).**
  Owner wants Paramedic Mode to diagnose crashes/freezes — "pinpoint exact cause + fix." Full 3-stage
  council REFRAMED "foolproof/exact" (it collides with the never-claim-unmeasured law) → **honest
  evidence reader, not divination.** Decisions (owner delegated naming; may veto on return): name
  **"Black Box"** (flight-recorder — records, never editorializes; dodges the scam-repair-app optics),
  pre-crash telemetry overlay = **"last vitals,"** placement = a **`LabSection` card in Lab, NO new tab**
  (honors owner's "don't pollute with a tab"). v1 = read-only / no kernel driver / anti-cheat-safe /
  zero outbound / **zero causal claims** — reads Event Log (Kernel-Power 41, WHEA, Display 4101/TDR,
  App Error 1000…), WER, minidump headers, + overlays `sessions.rs` pre-crash vitals; honest about
  gaps + elevation. Spec: `docs/superpowers/specs/2026-06-13-black-box-v1.md`. UI mock built (Cowork
  outputs). **Phasing:** v1 now · v2 probable-cause+confidence+fix (evidence-gated) · v3 fleet "crash
  brain" (NEW outbound → telemetry security gate, owner sign-off). **CC HANDOFF = file relay** (see
  below). Owner-parked: naming veto · always-on watcher posture · v3 telemetry greenlight.
- **🔁 COWORK→CC FILE RELAY ESTABLISHED (2026-06-13).** Since Cowork has no channel to CC's session and
  the IDE blocks typing, handoffs now go through disk: Cowork writes a self-contained work order to
  `docs/cowork-cc-relay/<date>-<feature>.cc.md`; owner's ONLY manual step is a one-line kickoff pointing
  CC at it; CC executes autonomously and writes its report to a `…REPORT.md` sibling, which Cowork reads
  + audits against git (no chat copy-paste either direction). First work order live:
  `docs/cowork-cc-relay/2026-06-13-black-box-v1.cc.md` (return file:
  `2026-06-13-black-box-v1.REPORT.md`). Cowork stays DIRECTOR-only — never writes app code (owner
  directive 2026-06-13); CC owns all build/compile/test/git.

- **🚀 SITE SEND-READY — WAITLIST VERIFIED LIVE + BLACKBOOK HERO + ASSETS SLIMMED (2026-06-12, Cowork,
  Chrome-verified end-to-end).** The whole landing train is closed and the link is owner-shareable:
  **https://compy-bd6.pages.dev**.
  - **Living-Blackbook hero LIVE** (`3016a73`) — the `og-card.mp4` is now the centerpiece (glass frame +
    breathing glow + verdict ribbon w/ desktop hover labels + proof strip "judge→measure→receipt→undo");
    the old CSS receipt + `.chip-motifs` retired. Audited from git: 5 site files, zero third-party,
    waitlist/`functions/` untouched, OG metas unchanged, reduced-motion gated. Mock deleted.
  - **Hero assets slimmed ~8.7 MB → ~123 KB** (`07482ed`) — Cowork fetched the DEPLOYED bytes: `og-card.mp4`
    **1.5 MB → 107 KB** (854×480 H.264 + faststart), poster **1.8 MB PNG → 15.7 KB WebP**
    (`og-card-poster.webp`), the unreferenced **5.3 MB `og-card.gif` deleted**. `og.png` (1200×630 social
    card) untouched. Hero renders correct; the heavy-video screenshot freeze is gone. Hero renders are
    intentionally gitignored ($0 ffmpeg pipeline); only `og.png` is tracked.
  - **Waitlist Function LIVE + PROVEN** (`93dfd3c` GET→405; wiring `28765db`/`58232a2`). Cowork drove the
    owner's Chrome on the LIVE site: submitted a test email → page returned **"You're on the list"**;
    `GET /api/waitlist` → empty/405 (no more SPA fallback); deployed `/api/` is bound. The earlier
    "emails silently drop" bug is DEAD. (No autoresponder by design — it just stores the address for the
    one launch email.)
  - **Stale-apex gremlin permanently cured** (`b6d5c3a`) — a `_headers` rule forces the landing HTML to
    `no-store`, so first-time visitors always get the current build (the "looks like the old page" reports
    were browser/edge cache of the HTML; this kills the class, better than a one-time purge).
  - **Owner has the share kit** (link + ready-to-send doctrine-voice copy). **DARK no more for testers —
    seeding is OPEN; the send itself stays the owner's** (friends + his Discord, per zero-budget seed plan).
  - **🔴 ONE tiny hygiene item PENDING:** delete the two Cowork test rows from D1
    (`cowork-test@compy.gg`, `audit@compy.gg`) so the real list starts empty — one-liner handed to CC.
  - **KPI clock (waitlist signups, COUNT in D1) starts on first real signup.** Next Cowork: confirm the
    test rows are cleared, then watch the count; offer the live-artifact tracker once signups arrive.

- **🌐 SITE IS LIVE — DEPLOYED 2026-06-12 22:26 (CC, wrangler direct upload, owner OAuth'd).**
  **https://compy-bd6.pages.dev** — bare `compy.pages.dev` was TAKEN on Cloudflare, project landed as
  `compy-bd6` (stops mattering when `compy.gg` attaches). 147 files from `dist-site/`; verified live:
  root 200 + R4b hero · `/library/index.html` 200 ("All 130 Compy Blackbook entries") · curated +
  deep library pages 200 via Pages' pretty-URL 308s — the folder-flattening failure mode absent.
  No GitHub connection (repo stays private); OAuth token in wrangler's local config only. **DARK —
  no announce; the send is the owner's.** Cowork next: live re-audit + the owner's live-glow
  taste-gate; freshen 130→136 entries (regen+redeploy) only AFTER the owner skims R5's six new
  Blackbook entries (R5 log Review Queue #2).
- **▶ RESUME POINT (fresh session — incl. a new Fable 5 Cowork session — read this FIRST).** You are
  the Cowork lane on Compy: strategy, specs, docs, and REVIEW. You do NOT build (CC does) — you audit
  CC's commits directly via git (never relay blindly), write paste-ready CC prompts, keep reports terse,
  self-apply the 5-lens council, and end every response with the next move. The dark site is LIVE at
  https://compy-bd6.pages.dev (136-entry Blackbook, council copy, og:image, living-Blackbook video hero).
  **✅ THE WAITLIST OPEN ITEM IS CLOSED (2026-06-12) — site is SEND-READY.** The Function is live + proven
  (Chrome-verified: test submit → "You're on the list"; `GET /api/waitlist` → 405, no SPA fallback), the
  blackbook hero shipped (`3016a73`), the hero assets are slimmed to ~123 KB (`07482ed`), and a `_headers`
  no-store rule (`b6d5c3a`) cures the stale-apex cache for good. See the top "🚀 SITE SEND-READY" board
  entry for the full verified rundown. **Only loose thread:** clear two Cowork D1 test rows
  (`cowork-test@compy.gg`, `audit@compy.gg`) before the list fills — one-liner already handed to CC.
  Everything below = full current state + history.
- **🔎 SITE-PASS AUDIT (2026-06-12, Cowork) — publish-grade EXCEPT the waitlist swallows emails.**
  Live (cache-bust-verified — the bare-URL "old copy" was stale fetch cache): council copy
  (kicker/Blackbook teaser/waitlist) · corpus **136** · the 6 R5 entries present + spot-checked clean
  (gpu-overclocking honest/plain/all-original) · og:image wired + card viewed (text correct, on-brand) ·
  living-still og-card.mp4 (1.6MB)/.gif (5.6MB) generated (not deployed, marketing) · frozen ref intact ·
  zero third-party outbound. **🔴 BUG: the waitlist Function was NOT in the deploy artifact** —
  functions/api/waitlist.ts is correct (onRequestPost · honeypot · SHA-256+IP_PEPPER hash · D1 INSERT
  ON CONFLICT DO NOTHING), but dist-site/ shipped with NO functions/ dir → GET/POST /api/waitlist falls
  through to static index.html → zero D1 writes, emails silently lost. KPI mechanism dead; NOT
  tester-ready until a curl-POST proves a D1 row. Fix prompt handed (carry functions/ in dist-site +
  D1 binding DB + IP_PEPPER secret + curl-POST/GET/d1-count proof).
- **🏛️ COUNCIL MANDATE EXPANDED (2026-06-12, owner decree):** the council may **overrule pre-existing
  PROCESS gates** (zero-outbound, default-off, deploy-timing, etc.) where the mission needs it and the
  move is reversible. Cowork still holds the MOAT lines (no fabricated/unmeasured claims · no anti-cheat
  injection/kernel driver · secrets out of repo · no security/system-setting flips · nothing
  irreversible to other machines without a heads-up) — those protect the owner/funnel, not constrain
  them. Recorded in COUNCIL_PROTOCOL spirit; supersedes the strict "advises-never-rules on gates" line
  for process gates.
- **✅ WAITLIST WIRING SPEC'D — CF-NATIVE (2026-06-12, Cowork; owner GO).** Spec:
  `docs/superpowers/specs/2026-06-12-waitlist-wiring.md`. Decision: same-origin Pages Function + D1
  (NOT a third-party embed) — $0, zero THIRD-PARTY outbound preserved (POST to our own backend, no
  tracker), owns the data, foundation telemetry/Pro reuse. Honeypot+rate-limit (no Turnstile → no
  third-party script). Honest copy: email IS stored by us for the one launch email (scoped away from the
  app's "sends nothing"). `/security` review required (new network+PII boundary). KPI clock starts on
  go-live (COUNT in D1). Send-at-launch deferred. CC build prompt handed; owner step = confirm one live
  test signup. **OG card = Blackbook-themed (owner greenlit), Higgsfield lane, before announce.**
- **✅ LANDING COUNCILED + COPY BAPTIZED (2026-06-12, Cowork, owner "council it").** Full 3-stage
  council on the live landing → 3 in-bounds copy edits to `site/src/index.template.html`: kicker
  de-drifted ("rollback-first safety layer" → "Know which PC tweaks actually help your rig" — retires
  the retired identity) · Blackbook sub now teases the snake-oil grading · waitlist sub de-conflicts
  "invite-only" vs "waitlist" (= your spot in line for public launch). CC regen+verify+redeploy teed
  (bumps corpus 130→~136 — R5's 6 new entries ride along; lint+council-passed, reversible; Cowork vets
  them LIVE post-deploy). DEFERRED (council, owner-gated): **wire the waitlist** (it's the KPI
  mechanism but the form collects nothing today; $0 Tally/Formspree, but a NEW outbound boundary →
  needs spec + owner GO + zero-outbound-test update) · OG image (Higgsfield §D) · name/screenshots/
  Blackbook-co-hero (taste / CC-structural).
- **✅ DARK SITE LIVE + COWORK-VERIFIED at https://compy-bd6.pages.dev (2026-06-12).** Owner ran the
  wrangler deploy; Cowork re-audited the LIVE url (not relayed): root 200 serving our R4b glow landing,
  `/library` resolves over all **130** entries (51 tweaks + 57 terms + 14 tricks + 8 guides = 130),
  honest placeholders intact, all links internal (zero-outbound holds in prod). **⚠️ `compy.pages.dev`
  is NOT ours — it's a stranger's app ("amantes30"); our URL is `compy-bd6.pages.dev` (bare name taken,
  moot once compy.gg attaches). Never announce/link the bare name.** DARK — no announce (owner's send).
  Pre-announce queue: owner live-glow taste-gate · OG image (Higgsfield §D, 1200×630 — no `og:image` set
  yet) · freshen 130→134 (regen+redeploy) AFTER owner skims R5's 6 new entries.
- **✅ dist-site AUDIT CLEAN — DEPLOY-READY + R5 MARATHON HANDED TO CC (2026-06-12, Cowork).**
  CC's `dist-site/` verified on the REAL disk: index.html + library.css **byte-identical to audited
  `ebf87fc`** (CR-normalized), `library/index.html` resolves over **130** entry pages, landing renders
  "all 130 entries" (count is COMPUTED from `KNOWLEDGE.length` via `{{ENTRY_COUNT}}`, not asserted — the
  earlier 130-overclaim flag is RESOLVED), zero outbound across all 130+ pages, no source leak, 632KB.
  **Deploy teed for owner's return** (dark URL, non-urgent; pair the `compy.pages.dev` upload with his
  live-glow taste-gate eyeball). **DEPLOY PIVOTED → wrangler/CC (2026-06-12):** the Chrome-dashboard
  route is blocked — Claude-in-Chrome screenshot tool erroring (`clip.scale` deserialize bug) AND a
  dashboard folder-upload can't preserve `dist-site/library/` subpaths (130 pages → flattened →
  broken Blackbook link). So CC deploys via `wrangler pages deploy dist-site --project-name compy`
  (direct upload, no GitHub connection, repo stays private); owner does the one-time `wrangler login`
  Allow-click. Then Cowork re-audits the LIVE url (200 + Blackbook door resolves) + owner eyeballs the
  live glow. Freshen 130→134 entries (regen+redeploy) only AFTER owner skims CC's R5 new Blackbook entries. **R5 unattended marathon** spec'd at
  `docs/superpowers/specs/2026-06-12-R5-unattended-marathon.md` (Lanes: §B visual refinement non-taste ·
  Blackbook content growth · hardening/a11y/law-guards · doc nits; all reversible/gated; council strip +
  Review Queue per lane; log → `AUTONOMOUS_SPRINT_2026-06-12-R5.md`) — handed to CC while owner rests.
- **✅ R4b AUDIT CLEAN + TASTE PASS — DEPLOY BLOCKER FOUND (2026-06-12, Cowork).** Commit `ebf87fc`
  audited vs §B0b; all six hard lines verified from commit BYTES (not CC's say-so): CSS-only (one
  `<script>` = IO reveal + waitlist), ≤60KB (14.6KB HTML + 20.3KB CSS ≈35KB), reduced-motion fully
  static (motion is opt-IN under `prefers-reduced-motion:no-preference` + JS guard), copy unchanged
  (R4b's own diff `7baf678→ebf87fc` = zero visible-copy delta; Library→Blackbook is the prior
  owner-approved `5f25d3e`), zero outbound (only local `library.css` + inline `data:` SVG grain; the
  lone `http:` hit is the SVG `xmlns` identifier), app untouched (5 `site/` files only — the ~60
  "modified" files in `git status` are the known stale-mount/CRLF phantom). Taste: restrained on-brand
  luminous noir, conservative opacities, de-synced GPU-cheap motion — ships. **DEPLOY BLOCKER:** the
  landing links `library/index.html` (the full Blackbook the copy bills as "130 entries"), which
  `site/generate.mjs` writes as a **gitignored** artifact — NOT on the committed tree, and sandbox-mount
  writes are unreliable. So a clean complete deploy folder must be regenerated on the REAL disk (CC lane)
  before Cowork drives the `compy.pages.dev` direct upload. CC artifact-build prompt handed. ALSO flag:
  confirm the real library page count == the "130" the copy claims (pre-existing; reconcile before announce).
- **🚀 LIVE HANDOFF (2026-06-12, thread swap): R4b GLOW-UP IN FLIGHT + DEPLOY GO BANKED.**
  State for the incoming session: (1) **R4b landing glow-up** (spec §B0b in
  `2026-06-12-doctrine-voice-baptism-design-refresh.md`, incl. owner's silk-streak ambient
  motif) is pasted/running in CC — on "CC done": audit vs §B0b hard lines (CSS-only, ≤60KB,
  reduced-motion static, copy unchanged, zero outbound), then taste-check, then **DEPLOY WITHOUT
  ASKING — the owner's GO is already given** (recorded here). (2) Deploy plan: owner's
  **Cloudflare account is created + logged in** in his Chrome; use Claude-in-Chrome tools →
  dash.cloudflare.com → Workers & Pages → create Pages project via **direct upload** (project
  name `compy` → compy.pages.dev; repo stays private, no GitHub OAuth), upload the generated
  site output (run `npm run export:library` for library pages + site/ for the landing — verify
  what the exporter outputs vs site/ static pages and upload the coherent set). Owner is
  non-technical: present the live URL as a clickable link. (3) **Queue after deploy:** Tally
  waitlist swap-in (owner signup, $0) → Cowork generates Higgsfield OG art (1200×630; hero may
  stay CSS) → Cowork drafts the Discord announcement (OWNER sends) → 14-day waitlist KPI starts →
  telemetry spec owner-read (`2026-06-12-receipts-telemetry-spec.md`) → R4 app visual marathon
  (§B). (4) Frozen refs `16069fa` verified this session; suites last green cargo 329 · npm 296+.

- **🏛️ COUNCIL INSTITUTIONALIZED (2026-06-12, owner decree).** `docs/COUNCIL_PROTOCOL.md` is
  standing law: 6-line COUNCIL STRIP closes every marathon log + Cowork audit; full 3-stage
  council at money gates / KPI readouts / owner's "council it"; eagle-eye memo runs as a
  scheduled Cowork task EVERY OTHER DAY at 9am (owner cadence call 2026-06-12; task id
  "weekly-council-eagle-eye" — read-only, advisory).
  Pointer added to CLAUDE.md NEW CORE. Advises, never overrides laws/gates/owner territory.
- **✅ OWNER TASTE DECISIONS #2 (2026-06-12): Learn → "Blackbook"** (rail label + plain doorknob
  descriptor "what actually works — measured"; site hub = "The Compy Blackbook") **+ the
  Sarah & Caleb plain-language law** (standing: jargon never defined with jargon; jargon-list CI
  guard; plain ≠ vague). Spec: `2026-06-12-blackbook-rename-plain-language-law.md`. Handed to CC.
- **✅ FOUR TRAINS LANDED 2026-06-12 (CC, `69c5dbd..83b91af`):** (1) tailored-tuning spec —
  §A evidence-gated tuning offers (`efa740b`: the one ungated push closed; offers quote the
  measured signal; NVIDIA pinned) + §B walkthrough single-panel stepper (`53f4855`) + §C
  compile-time build stamp in About + dev title (`f0cb41d`); (2) **doctrine baptism §A DONE**
  (`9996d49`: 8 B1 strings rebaptized w/ old→new log, voice-guard CI test bans the retired
  phrases, B3 → `2026-06-12-naming-proposals.md` for the owner's pass); (3) **R4a publish-grade
  landing** (`e9c4fc6`: hero "Measured, not promised.", 3 receipts value cards, creed footer,
  mobile-first 380px, §D art slots documented, zero-outbound smoke suite — site stays DARK,
  owner taste-gates `site/index.html`); (4) **Fix → "Tune" EXECUTED** (`83b91af`: label-only via
  homeRail, persisted id kept, "Measured changes for YOUR rig" sublabel). Suites: cargo 329 ·
  npm 296 · clippy/tsc clean. Still queued: §B app visual marathon (R4) → owner verdict → §C
  gated; §D Higgsfield art (Cowork lane: hero 960×720 webp + OG 1200×630 png into site/assets/).
- **🏃 RECEIPTS MARATHON R3 LAUNCHED (2026-06-12, owner GO — longest CC run yet).** Spec:
  `docs/superpowers/specs/2026-06-12-receipts-marathon-R3.md`. Lanes: A dark-site build-out
  (generator unification + landing + curated debunks + share-card loop) · B affiliate advisory
  (copyable/export-only, disclosure law) · C telemetry groundwork (spec + dark build, zero
  network) · D local KPI counters · E Pro dark scaffold · F library growth. All hard-false-gated
  or static; capabilities/CSP/network/mutation untouched by hard line. Cowork audits on "CC done."
- **💰 RECEIPTS DOCTRINE ADOPTED (2026-06-12) — the grand re-opening.** Owner blessed the full
  monetization pivot: `docs/RECEIPTS_DOCTRINE.md` is canonical product law (CLAUDE.md + this doc
  aligned same day; council + transformation plan in `docs/superpowers/specs/2026-06-12-*.md`).
  Phase 0 (doc alignment) + Phase 1 (Library→web exporter) ✅ LANDED 2026-06-12 (`f3b2f2e`..`421dd13`:
  doctrine committed, pointer sweep, `npm run export:library` → 126 entries/127 pages to
  `dist-web/library/`, 8 tests, /check + /security clean — hosting stays owner-gated). Next:
  Phase 2 = compy.gg one-pager + waitlist (Cowork drafts copy; owner hosts; KPI = 14-day signups).
  Owner errands queued for later phases: affiliate accounts, entity + merchant-of-record, cert.
- **✅ v2-RESTORE LIVE UAC QA PASSED — W32PS + MPO field-proven (owner-present, 2026-06-11 night)**
  — harness `20ffe35` (§4-precedent #[ignore] tests; #[cfg(test)]-only gate-bypass seam, compiled
  out of shipped binaries; `restore_gate()` still false + test-pinned). Both loops: seed → flagged →
  restore (receipt `leftover_adopted` + exact rotted snapshot) → rollback restores the rotted value
  EXACTLY → cleanup to stock. Memcompress non-elevated refusal confirmed honest; its elevated-
  prior-read design need is in the R2 Review Queue. QA log `526aeaf`. Before any gate flip: the
  remaining resolvers' loops (fixture values need owner sanction) + owner sign-off. Six `QA ·`
  ledger receipts remain (cleanup offered).
- **🛠️ Same-night overlay pair (owner-found + owner-asked):** density dead-knob lockout FIXED
  (`48ee900` — stale `compy_overlay_v2="0"` pinned the overlay to the classic layout that ignores
  density; CDP-probed live, a335f13 self-heal pattern, stale-flag class closed codebase-wide) ·
  **Background On/Off** landed (`1aaa342` — see-through overlay, RTSS-outline legibility, control
  in Play + Settings). Suites cargo **313** · npm **257**.
- **🌙 R2 UNATTENDED MARATHON LANDED (2026-06-11, owner was napping)** — full log + Review Queue in
  `docs/superpowers/AUTONOMOUS_SPRINT_2026-06-11-R2.md`. Landed reversible: Leftovers Learn layer
  (`5e8fb98`) · charter law-guards in CI, caught+fixed real copy (`9a163f5`) · NIC driver win-source
  v1 (`7dc1478`) · pure-module edge tests (`5f737b6`) · **Leftovers v2 restore BUILT DARK** — 3
  resolvers, double-gated, adversarially audited, Defender resolver deliberately ABSENT per the
  security rail (`9cfec24`) · a11y semantics (`d00ae34`) · M3 retirement spec READY (execution =
  fresh attended session). **Review Queue for the owner:** v2 remaining-resolver decisions (esp.
  Defender), gate-flip QA plan, R2-7 bundle-split skip recommendation. Nothing flipped, nothing
  hosted, gates/refs untouched.

- **🟢 Tree-truncation scare (2026-06-11) — RESOLVED, false alarm:** root cause was a stale
  sandbox-mount view on Cowork's side, not real corruption. CC verified the four named files INTACT
  at HEAD before acting (zero diff; cargo 268 · npm 240 · tsc + vite green) — NO restore was run,
  nothing was lost. Standing lesson: verify the working tree directly before any destructive restore.
- **🌊 OWNER-FEEDBACK WAVE #2 LANDED + OWNER-EYEBALLED (2026-06-11, `main` @ `69e91fe`)** — all
  Cowork-specced, CC-built, audited green: Fix-tab reword (`f1a1f27`) · Lab welcoming pass (`7d9f52a`,
  doorknob-test-pinned) · Fix consent-note dedup (`9958c48`) · driver-freshness advisory in Check
  (`078bc1d`, owner-confirmed 13-day pass renders) · structured feedback capture in Export (`bd7520d`
  +`cc2a1ba` 4000-char cap, honest empty→no-section, owner-verified) · **overlay stranded-monitor FIX
  (`f6c0fce`)** — FreeSync OSD toggle swapped primary; corner math now anchors to `primary_monitor`
  (fallback current), shared `position_overlay` helper, 3 tests. **Owner LIVE-CONFIRMED both eyeballs:
  overlay returns to main monitor + Export report carries the new feedback section.**
- **✅ KIT RE-CUT FROM `69e91fe` (2026-06-11) — verified, ready to host, NOT yet sent.** NSIS
  `Compy_0.1.0_x64-setup.exe` **SHA-256 `39F08D75A939CF722B52CCC7E5BF9010F7C8377744E2ACF08E3703600C7FFE93`**
  (2,775,197 B) + MSI (4,149,248 B). Triple-hash-verified (bundle = loose `beta-kit/` copy = inside
  `Compy-Beta-Kit.zip`); frozen refs (`16069fa`, `beta/private-beta-001`) re-verified untouched.
  SUPERSEDES `5F2549E7…` everywhere. Owner-side from here: set the new zip's Drive share to "Anyone
  with the link · Viewer", replace the old Drive file, DM testers. **Re-download DM drafted:**
  `beta-kit/redownload-message.txt` (leads with overlay fix + new Export feedback box). **Drive heads-up
  to include:** the zip is too big for Drive's virus scan → testers see "Download anyway", pairs with
  the expected SmartScreen warning.
- **Cowork project-instructions rewrite drafted** (`beta-kit/cowork-project-instructions.txt`) — owner
  to paste into the project's instruction field (relay + shorthand-audit + NEEDS-YOU flag + persist-to-disk).
- **🚀 BETA IS SENDING (2026-06-10/11)** — owner hosted the send-ready kit (`5F2549E7`, from `fc940fe`)
  on **Google Drive** (link live) and is DMing testers the link + `beta-kit/invite-message.txt`. Drive,
  NOT Discord, because a tester's MalwareBytes Browser Guard blocked Discord's CDN (`cdn.discordapp.com`
  — false "phishing" over-block, NOT Compy). **FPS self-measurement fix is FIELD-CONFIRMED** — owner's
  live game test shows the overlay now reads ≈ the in-game/Steam counter (the msedgewebview2 self-measure
  bug is dead). Kit fully field-validated. Owner-side from here: collect Export reports + the "describe
  Compy in one sentence" answers.
- **Next Cowork task (teed up)** — spec the **Fix-tab reword**: read more inviting/outcome-framed WITHOUT
  promising FPS gains (no-snake-oil law — we just killed that exact over-promise on the site). Target:
  "the changes actually worth making for your rig" — earned, tailored, reversible. THEN a separate **Lab
  welcoming pass** (make the instrument-heavy Lab comprehensible/inviting for newcomers). Owner's
  roadmap-overview take is recorded: filter every future item through reversible + honest + catalog-frozen;
  most self-sequence (signing/legal = public gate, NVML/Intel = vendor-honesty rule #5, remote rules =
  triple-gated arming plan, mobile/paramedic/per-game = post-beta).
- **Tuning-guides feature** — BUILT + pushed (HEAD ~272f195); static audit passed (zero mutation,
  schematic-only, honest-measurement invariant coded). ✅ CC re-verified 2026-06-09 (the lost
  report is replaced): cargo 232 / npm 225 / clippy + tsc clean / /security clean; the 4 Fix-path
  comparison regression tests are diff-proven byte-identical and passing. The one medium /check
  finding (Lab.tsx fed the unfiltered latest comparison into `measureTuning`) is FIXED same day:
  the kind+game filter now lives inside `measureTuning` so no caller can get it wrong, pinned by a
  regression test (npm 226 green). Spec-built; NOT shipped.
- **Owner live checks** (his eyes only) — tray loop, overlay over a real game at each density, the
  VRR walkthrough, and Hearth's candlelight → send the hexes to lock kernel §4.
- **Beta path** — installer rebuild + the tray manual QA + the §4 apply-all per-item-rollback QA
  before any tester ship. §4 one-elevation batching is a parked fresh-session job (audited boundary).
- **Post-beta (unblocked)** — retire the now-redundant classic surfaces (parity closed, hub removed).
- **Installed app** is current; the dev build hot-reloads (relaunch via CC to watch changes).
