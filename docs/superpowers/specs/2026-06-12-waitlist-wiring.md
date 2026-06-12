# 2026-06-12 — Waitlist wiring (Cowork spec; owner GO + council gate-override granted)

> Owner GO'd wiring the waitlist and granted the council authority to overrule pre-existing process
> gates where the mission needs it. KPI = 14-day waitlist signups; today the form collects NOTHING
> (the funnel's one conversion action is dead). This spec makes it real, $0, and on-brand.

## Decision — Cloudflare-native, not a third-party form

Form POSTs **same-origin** to our own Cloudflare **Pages Function**, which writes to **D1**. NOT a
Tally/Mailchimp/ConvertKit embed. Why:

- **On-brand:** Compy's whole pitch is "no tracking, sends nothing to third parties." Handing signups
  to a newsletter SaaS (with its tracking script) would undercut that on the very page that sells it.
- **Zero THIRD-PARTY outbound preserved:** the POST goes to OUR backend, same origin — no tracker, no
  third-party script. The site's "no third-party / no tracking" invariant stays TRUE. (This is why the
  council's gate-override is barely needed here — we bend nothing a stranger could see.)
- **$0:** D1 free tier (5 GB) + Pages Functions free tier (100k req/day) + Turnstile not used. No spend.
- **Foundation reuse:** this is our first Worker+D1 — the exact stack Receipts telemetry ingest and
  Compy Pro will reuse. One waitlist, three payoffs.
- **Data ownership:** the email list lives in our CF account, exportable, ours.

## Architecture

- **Form** (`WAITLIST_SLOT` in `site/src/data/site.ts` / template): plain
  `<form method="POST" action="/api/waitlist">` — email input + a **hidden honeypot** field. Works
  with **NO JavaScript** (native POST → Function → 303 redirect back to `/?waitlist=ok`, show a thanks
  state). Progressive enhancement: the EXISTING page script intercepts submit → same-origin
  `fetch('/api/waitlist')` → inline success/error, no navigation. No third-party script either way.
- **Pages Function** `functions/api/waitlist.ts`: validate email shape · reject if honeypot non-empty ·
  rate-limit by hashed IP (D1/KV) · `INSERT` `{email UNIQUE, created_at, ip_hash}` into D1 (idempotent
  on dupe) · return `{ok:true}` (fetch) or 303 (no-JS). Never logs the raw IP (hash only).
- **Storage:** D1 `compy_waitlist`, one table.
- **Spam:** honeypot + IP rate-limit ONLY. **No Turnstile** (it loads `challenges.cloudflare.com` JS =
  a third-party script + JS we don't want on a zero-JS page). Upgrade to Turnstile only IF spam appears
  (KPI/observation-triggered).
- **Send-at-launch:** DEFERRED. Collection is the KPI now. At public launch, export D1 → send the ONE
  honest launch email via Resend free tier (100/day) or the owner's mail. Not built this pass.

## Honesty (no-fabrication law applies to the new boundary)

The email now leaves the browser → our server, so the copy must say so plainly (the app's "sends
nothing off your PC" line is about the APP, keep it scoped to the app). Waitlist copy →
**"Your email is stored only to send that one launch message — nothing else, no third parties, no
tracking."** Don't imply the waitlist sends nothing; it sends to us, and we say so.

## Gate crossing (council-authorized, minimal)

Update the zero-outbound smoke suite to: (a) keep asserting **zero third-party requests** (unchanged
invariant — still true), (b) allow the same-origin `/api/waitlist` endpoint. The brand property
("no third-party, no tracking") is PRESERVED, not waived.

## Build order (CC — use the new Cloudflare skills/MCP for the CF specifics)

1. `wrangler d1 create compy_waitlist` → schema (email TEXT UNIQUE, created_at, ip_hash) · bind to the
   `compy` Pages project.
2. Add `functions/api/waitlist.ts` (validate · honeypot · rate-limit · insert · ok/303). Include the
   `functions/` dir in the deployed artifact.
3. Wire the real form in `site/src/data/site.ts` `WAITLIST_SLOT` + the honest copy; keep the existing
   page-script interceptor doing the same-origin fetch.
4. Update the zero-outbound smoke test per the gate-crossing note above; keep voice/jargon/landing
   tests green.
5. **`/security` review REQUIRED** — this is a new network + PII boundary (the doctrine's stop-rule for
   outbound boundaries): no PII in logs, email validated/escaped, rate-limited, D1 binding scoped, no
   secrets in repo.
6. Regen + redeploy the `compy` Pages project (carries the R5 corpus + the council copy edits too).

## Verify

`npm test` green (incl. updated zero-outbound + landing + voice/jargon) · `/security` clean · a live
test signup at `https://compy-bd6.pages.dev` lands one row in D1 and the page shows the thanks state ·
a second identical submit does NOT duplicate · the page still loads ZERO third-party requests.

## KPI

Signups = `COUNT(*)` in `compy_waitlist` over the 14 days from go-live. (Counter/readout can be a
later tiny admin query — not in this pass.)

## Owner step (minimal)

CF auth is already done; no new account, no spend. After CC deploys: eyeball the live form + confirm
one test signup landed. Turnstile/keys NOT needed (honeypot). Spend only if the free tier is ever
exceeded (a good-problem KPI trigger), owner-gated per the zero-budget law.
