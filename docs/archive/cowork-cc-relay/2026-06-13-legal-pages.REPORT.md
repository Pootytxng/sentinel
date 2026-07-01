# CC RETURN REPORT — Publish legal pages on the site

**Status:** ✅ SHIPPED · rendered from the .md source · linked everywhere · deployed live · all verify green.

**Commits:**
- `654b0dc` — `feat(site): publish Privacy + Terms as linked pages (rendered from the .md source)` (the feature)
- `971fa9d` — `fix(site): _headers — also no-store the pretty URLs /privacy and /eula` (post-deploy refinement, see decisions)

**Live deployment:** `29b082d7` on `compy-bd6.pages.dev` (production alias; commit `971fa9d`). Pushed to origin.

## What shipped
- **`site/privacy.html` + `site/eula.html`** — rendered from `docs/PRIVACY.md` (v0.2) and `docs/EULA.md` (v0.3) by a tiny **zero-dependency markdown→HTML renderer added to `site/generate.mjs`** (headings, paragraphs, **bold**, *italic*, `code`, `- ` lists with wrapped continuation, `> ` blockquotes, `---` rules; all inline text HTML-escaped). They use the existing `page.template.html` chrome + `library.css`, so they match the site (wordmark, aurora wash, glass). Single source of truth = the .md, so they can't drift. Title tags exactly "Compy — Privacy Policy" / "Compy — End-User License Agreement".
- **Footer `Privacy · Terms`** added to the landing creed footer + the debunk + library page templates (`HOME_HREF`-relative, so every page — landing, curated, library, the legal pages themselves — reaches them).
- **Waitlist note → Privacy:** appended "· Read our Privacy Policy" linking `privacy.html` to the waitlist sub-copy, keeping the disclosure one click away at the point of collection.
- **`_headers`:** `privacy.html`/`eula.html` **and** the pretty URLs `/privacy` `/eula` added to the no-store rule (HTML stays fresh).
- **`.foot-legal` + legal-content CSS** (blockquote/hr/`code`/lists) added to `src/library.css`.
- Ships the owner-finalized **source content** atomically (else the committed .html would drift from the committed .md): `LICENSE` proprietary/all-rights-reserved, `EULA.md` §2 strict all-rights-reserved + §12 US law with the **`[STATE]` venue blank left VERBATIM** for the owner.

## Verify (each result)
- **`npm test`:** ✅ **304 passed** (62 files). Extended `site-landing.test.mjs`: landing now asserts the footer `Privacy`/`Terms` links + the waitlist→privacy link; a new **legal-pages block** pins the titles, the **verbatim `[STATE]` placeholder**, zero external origins (no external `href`/`src`, no `<script>`, no CDN/tracker domains, no `<img>`, only self-hosted `library.css`), and same-origin reachability.
- **`/privacy.html` live:** ✅ `200` (after CF's pretty-URL `308` → `/privacy`), body contains "Privacy Policy". **`/eula.html` live:** ✅ `200`, body contains "End-User License Agreement".
- **Landing footer/waitlist live:** ✅ `href="privacy.html"` ×2 (footer + waitlist note), `href="eula.html"` ×1 (footer).
- **Zero-third-party (work-order grep) — local & live:** ✅ `grep -oE 'https?://[^"]+' site/privacy.html site/eula.html | grep -v compy` → empty; live grep across landing + both legal pages (compy/w3 excluded) → empty. The contact GitHub URLs render as **plain text** (they contain "compy" and are not `<a href>`), so the pages add **zero external origins** and make zero third-party requests (only `library.css`).
- **No stale / current build:** ✅ bare apex still serves the blackbook hero (`og-card.mp4` ×2) + the new "Read our Privacy Policy" link; pretty URLs `/privacy` `/eula` now return `Cache-Control: no-store`. Blackbook hero, waitlist Function, D1, frozen refs untouched.
- **Purge:** as before, `*.pages.dev` has no account-level "Purge Everything" (unlocks with a custom domain); the fresh deploy + `no-store` on the HTML pages means every visitor gets the current build — the work-order's no-stale goal is met.

## Decisions / judgment calls (flagged for your audit)
1. **External contact URLs render as PLAIN TEXT, not `<a href>`.** The legal docs contain `https://github.com/Pootytxng/compy/issues` etc. To hold the **zero-third-party / zero-external-origin** hard line strictly (and the project's `href="https://"` ban culture), the markdown renderer emits bare http(s) URLs as readable text, never anchors. The URLs stay visible/copyable; only relative header/footer links are clickable. The legal **wording is unchanged** (the URL text is preserved verbatim) — only its link-ness is dropped, which is a formatting choice the hard line permits. *If you'd rather GitHub be clickable, that's a one-line renderer change + owner call on the external-origin stance.*
2. **Committed the source `.md` + `LICENSE` with the feature.** They were modified on disk (your finalized content) but uncommitted; committing the rendered `.html` without them would leave committed source ≠ committed output (drift, and a future regen would change the pages). I committed them together so the feature is atomic and reproducible. **Legal text untouched** — rendered faithfully, `[STATE]` verbatim.
3. **Added a post-deploy `_headers` fix (`971fa9d`)** once I saw CF serves the pages at the pretty URLs `/privacy` `/eula` (308 from `.html`); the original rules only matched the `.html` paths, so the *served* page wasn't no-store. Added the pretty-URL rules.

## Hard lines — all held
Zero third-party (self-hosted CSS only; no web-font CDN, no analytics, no external href/src — re-verified local + live) · legal wording rendered faithfully, `[STATE]` placeholder verbatim · landing copy / blackbook hero / waitlist Function / D1 / frozen refs untouched except the footer + the one waitlist-note link · `_headers` no-store covers the new pages (incl. pretty URLs).
