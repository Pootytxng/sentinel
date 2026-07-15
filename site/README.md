# site/ — Compy content pages (curated debunks + Blackbook library + legal)

**The LANDING no longer lives here.** As of the Mission Control makeover (2026-07-14, spec
`docs/superpowers/specs/2026-07-14-site-makeover-research-spitball.md`) the landing is an Astro
app in `site-app/` — built at staging time and overlaid onto the deploy tree. This folder owns
only the CONTENT pages, all generated:

- `node site/generate.mjs` renders:
  - `site/<id>.html` — curated debunk pages (committed; picks in `site/debunks.config.json`)
  - `site/library/` — the FULL Blackbook with site chrome (gitignored artifact)
  - `site/privacy.html` + `site/eula.html` — legal, rendered from `docs/PRIVACY.md` / `docs/EULA.md`
  - `site/library.css`
- Content comes from the SHARED rendering core (`scripts/lib/library-render.mjs`) — the same
  core the in-app Library uses, so storefront and app can never drift. Re-run after Library edits.
- `site/src/` is build tooling (templates + the session/proof receipt provenance JSONs the
  landing's replay demo and receipts section pin to) — excluded from staging via
  `STAGING_EXCLUDE` in `scripts/stage-dist-site.mjs`.

## Staging & deploy

`node scripts/stage-dist-site.mjs` (npm run stage:site) is the ONLY way `dist-site/` gets built:
it reruns this generator, builds `site-app/`, mirrors `site/` (minus tooling), overlays the Astro
landing (index.html + `assets-app/`), and copies `functions/` (the same-origin `/api/waitlist`
Pages Function). Guard: `scripts/dist-site-staleness-guard.test.mjs` fails on any stale tree.

**DEPLOY IS OWNER-GATED** — only on the owner's explicit "deploy":
`wrangler pages deploy dist-site --project-name compy`. Building publishes nothing.

## Content rules (inherited from the app's kernel)

Never lie: no invented user counts, no fake reviews, no "up to X% FPS" promises. Numbers on the
pages are real measured provenance (the receipt JSONs) or framed as *examples of what Compy
shows*, never guarantees. Every page makes zero third-party requests (no webfonts/analytics/CDN
— the landing self-hosts its one font) — keep it that way; it's the privacy posture made
structural. The pages must never be ahead of the product's truth (NVIDIA verification status,
pricing language).
