# CC WORK ORDER — funnel go-live to-do (parked; owner initiates)

> A small, off-to-the-side list queued by the owner (2026-06-15) to run **when he initiates it** — not
> a live marathon. Scope = the funnel/go-live mechanical steps surfaced in the 06-15 council session.
> Most lanes are BLOCKED on an owner-provided input (account URL / explicit deploy-or-send GO) — do the
> unblocked verify work; for blocked lanes, do nothing until the named input lands. All reversible.

## Global hard lines (unchanged)
Reversible only · no kernel driver/injection · rollback-first untouched · **frozen appliable-tweak catalog
untouched** · remote-fetch/updater/signing OFF · all locked gates DEFAULT-OFF (`blackbox_v2_gate` is the
only owner-flipped one; leave the rest) · no secrets · no security/system-setting changes · honest-
measurement absolute · **zero third-party on the site** · frozen refs `16069fa` / `beta/private-beta-001`
UNTOUCHED · verification never skipped. **No spend, no send, no installer cut** without explicit owner GO.

## Lane 1 — Wire Ko-fi (BLOCKED on: owner's Ko-fi profile URL)
The $0 tip-jar bridge (Receipts Doctrine §6). The site slot is already built — only the URL is missing.
- **Blocker:** owner creates a Ko-fi (or BuyMeACoffee) account and pastes the profile URL here.
- When unblocked: set `KOFI_URL` in [src/data/site.ts](src/data/site.ts) to that URL → `node site/generate.mjs`.
- Verify: the footer "Support Compy ☕" link appears and points at the URL; **it's a static `href`, NOT a
  script/fetch** — confirm the page still makes ZERO third-party *requests* on load (the outbound link is
  fine; a tracker/script would not be). npm/lint green; committed-site regen diff = just the footer link.
- Deploy is **owner-gated** — log it as ready, don't push live without GO.

## Lane 2 — Pre-send waitlist proof (UNBLOCKED — highest value; do this first)
The 14-day-signups KPI is worthless if the form silently drops emails. Prove the pipe end-to-end BEFORE
the owner sends the link.
- Confirm `/api/waitlist` Pages Function → D1 actually persists a submission (test a throwaway email; then
  remove the test row). Confirm the no-JS 303 round-trip (`/?waitlist=ok`) AND the JS fetch path both land.
- Confirm the honeypot drops a bot row (filled `website` field → silently ignored, no D1 write).
- Confirm: site serves the honest count (174 today, computed — never hardcode), Privacy link present,
  blackbook hero intact, **zero third-party** (grep clean local + live).
- Report PASS/FAIL per check. A FAIL here is a 🔴 — the owner must NOT send on a broken form.

## Lane 3 — Deploy refresh (BLOCKED on: explicit owner deploy GO)
Only if the owner says "deploy." Rebuild `dist-site/` from `site/`, `wrangler pages deploy dist-site
--project-name compy`. Verify live: apex new count · privacy footer/link · hero intact · zero third-party
(grep empty). Dark site; the tester **send stays the owner's**.

## What stays OWNER-ONLY (do not attempt — log only)
Ko-fi account creation · the actual waitlist SEND · domain purchase (`compy.gg`) · signing · monetization
model/price/free-Pro split · any gate flip · installer cut.

## RETURN FILE → `docs/cowork-cc-relay/2026-06-15-funnel-golive-todo.REPORT.md`
Per lane: what-changed / commit hash (if any) · verify results · blockers still open · 5-line council strip
(🔴 Contrarian opens) · Owner Review Queue. Confirm frozen refs/gates untouched, no unauthorized spend/send/
deploy/installer.
