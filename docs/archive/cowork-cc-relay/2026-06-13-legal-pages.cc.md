# CC WORK ORDER — Publish legal pages on the site + link them

> File-based Cowork→CC relay. Cowork completed the legal CONTENT (the source docs below); CC does the
> site WIRING + deploy, then writes its report to the RETURN FILE at the bottom. Owner's only manual
> step is the one-line kickoff pointing CC here.

## Why
The waitlist is LIVE and collecting emails + a hashed IP, but the site links **no** privacy policy or
terms — a real gap now that we hold user data. The source docs are finished and owner-decided
(license = strict all-rights-reserved; governing law = United States, with a `[STATE]` blank the owner
will fill). Get them published as linked site pages.

## Source docs (already complete — DO NOT rewrite the legal content)
- `docs/PRIVACY.md` — v0.2, now covers the website/waitlist (email + SHA-256-hashed IP, Cloudflare D1,
  retention/deletion, zero third-party).
- `docs/EULA.md` — v0.3, strict all-rights-reserved (§2), US governing law (§12, with `[STATE]`
  placeholder — leave the placeholder text intact; it's the owner's to fill).
- `LICENSE` (repo root) — finalized to proprietary/all-rights-reserved.

## Build
1. **Render two site pages from the markdown** (single source of truth — render from the .md so they
   never drift): `site/privacy.html` and `site/eula.html`. Reuse the existing site generator
   (`site/generate.mjs`) + the debunk/content page template + `library.css` so they match the site's
   look (same header wordmark, aurora wash, glass styling). A small markdown→HTML step in the generator
   is fine; keep headings/lists/links intact. Title tags: "Compy — Privacy Policy" / "Compy — End-User
   License Agreement".
2. **Footer links.** Add a simple footer (or extend the existing one) with **Privacy · Terms** links to
   those two pages, on the landing page (`site/src/index.template.html`) AND the debunk/content + library
   page templates so every page reaches them.
3. **Link Privacy from the waitlist note.** In the landing waitlist sub-copy ("Your email is stored
   only to send that one launch message…"), turn it into a link to `privacy.html` — e.g. append
   "· Read our Privacy Policy" linking the page. (Keeps the disclosure one click away at the point of
   collection.)
4. Regenerate: `node site/generate.mjs`. Rebuild `dist-site/`, `wrangler pages deploy`, Purge cache.

## HARD LINES
- **Zero third-party** — the legal pages and footer must add no external origins (self-hosted CSS only;
  no web-font CDN, no analytics). Re-verify after build.
- **Do not alter the legal wording** in PRIVACY.md / EULA.md — render it faithfully. Keep the EULA
  `[STATE]` placeholder verbatim (owner fills it). If markdown rendering forces minor structural tweaks,
  change formatting only, never the legal text.
- Landing copy, blackbook hero, waitlist Function, D1, frozen refs — all untouched except the footer +
  the one waitlist-note link.
- `_headers` no-store rule for HTML stays in place (and should cover the new pages).

## Verify (report each)
- `npm test` green (update/extend the site-landing test if it asserts page set or footer).
- `curl -s https://compy-bd6.pages.dev/privacy.html | grep -i "Privacy Policy"` → 200 + content; same for
  `/eula.html` → "End-User License Agreement".
- `curl -s https://compy-bd6.pages.dev/ | grep -iE "privacy.html|eula.html"` → footer links present;
  waitlist note links privacy.
- Zero-third-party check on the new pages: `grep -oE 'https?://[^"]+' site/privacy.html site/eula.html |
  grep -v compy` → only schema/w3 identifiers, no trackers/CDNs.
- Bare apex + new pages serve the current build (no stale cache) after purge.

## RETURN FILE — write your report here
`docs/cowork-cc-relay/2026-06-13-legal-pages.REPORT.md`: commit hash(es) · what shipped · each verify
result · anything you had to decide. Cowork audits it against git + these hard lines from disk.
