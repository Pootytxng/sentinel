# Compy landing page — parked & deploy-ready (money-last)

Single static file (`index.html`), zero dependencies, zero build step. Built 2026-06-06 by
Cowork in the Halfway Home design language (neutral walls, teal accent, whisper ambient,
inner-pulse mark). It costs nothing until the domain trigger fires.

## The trigger (recorded in docs/superpowers/plans/2026-06-04-beta-build-order.md)

Deploy at the **first PUBLIC / stranger exposure of the name** — a Reddit recruit, a public
post — NOT for the trusted-friends invite beta. At that moment, and not before:
register `compy.gg` (+ `getcompy.com`), auto-renew on, WHOIS privacy on.

## Deploy (free)

Either host serves this folder as-is:

- **GitHub Pages:** repo Settings → Pages → deploy from branch, folder `/site`
  (or copy to a `gh-pages` branch). Custom domain: add `compy.gg`, create the
  CNAME/A records the Pages UI shows, enforce HTTPS.
- **Cloudflare Pages:** create project → direct upload or git → build command none,
  output dir `site`. Add the custom domain in the dashboard.

Preview locally any time: double-click `index.html`.

## Before going live — placeholder checklist (all marked `[KUYA: …]` in the HTML)

1. Invite CTA href (×2) → real channel (Discord invite / form / email).
2. Privacy + EULA footer links → published docs (legal gate must be closed for PUBLIC anyway).
3. `og:image` meta → a 1200×630 banner render (optional but good for Reddit/Discord embeds).
4. Testimonials section → uncomment and fill from the beta harvest (the "sentence you'd
   tell a friend" answers). Real sentences only — the honesty laws apply to the storefront.
5. Sanity-pass the FAQ claims against the shipped build (NVIDIA verification status,
   pricing language) — the page must never be ahead of the product's truth.

## Content rules (inherited from the app's kernel)

Never lie: no invented user counts, no fake reviews, no "up to X% FPS" promises. Numbers on
the page are framed as *examples of what Compy shows*, not guarantees. The anti-snake-oil
positioning only works if the storefront itself contains none.
