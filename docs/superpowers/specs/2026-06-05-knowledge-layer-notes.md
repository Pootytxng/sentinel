# Knowledge Layer — implementation notes (2026-06-05)

Companion to `2026-06-05-knowledge-layer-chapter.md` (the owner directive). Records the schema
decisions, how the future gated tier slots in, debt knowingly taken, and edge cases the next
session should know. Source of truth for facts remains `docs/ADVANCED_PERFORMANCE_BLACK_BOOK.md`
and the shipped datasets.

## What shipped
- **Content** — `src/data/terms.json` (54), `tricks.json` (13), `guides.json` (7, all `tier:"safe"`).
  `tweaks.json` (the frozen 42) is **byte-for-byte unchanged**.
- **Model** — `src/data/knowledge.ts`: unified `KnowledgeEntry` discriminated union, `KNOWLEDGE`
  index, `KNOWLEDGE_BY_ID`, `relatedIds` (forward+reverse union), `foldText`, `entryBody`,
  `KNOWLEDGE_VERSION = 1`.
- **Pure cores** — `knowledge-search.ts` (matcher), `knowledge-autopsy.ts` (Guide Autopsy).
- **UI** — `surfaces/TweakEncyclopedia.tsx` is now the unified **Library** (browse + autopsy modes);
  `design/Term.tsx` is the inline glossary tooltip; `surfaces/library-context.ts` lets any surface
  open the library focused on an entry.
- **Tests** — dataset lint, matcher, autopsy, model, Library surface, Term — all under
  `src/data/*` and `src/{surfaces,design}/*`.

## Schema & versioning
- **One version field on the dataset root**: `KNOWLEDGE_VERSION` in `knowledge.ts`. Bump + migrate
  on any shape change. Per-file versioning was deliberately **not** added — a single unified version
  is enough today. If one file ever needs independent migration, wrap that file as
  `{ "version": n, "entries": [...] }` and special-case it in the normalizer.
- **Per-type JSON files, normalized at load.** Authoring is cleaner per type; `knowledge.ts` injects
  the `type` discriminator and defaults `aliases`/`related` to `[]`. The raw files stay free of the
  `type` field so they read clean.
- **Unique ids across ALL types** (lint-enforced). For concepts that exist as both a verdict and a
  definition, the term id deliberately differs from the tweak id: term `xmp` ↔ tweak `xmp-expo`,
  term `gpu-scheduling` ↔ tweak `hags`, term `hpet` ↔ tweak `useplatformclock`, term `mpo` ↔ tweak
  `mpo-disable`, term `c-states` ↔ tweak `cstates-disable`, term `core-parking` ↔ tweak
  `core-unparking`, etc. **`<Term id=…>` tooltips reference TERM ids.**

## Cross-links
- `related` is authored on the new entries only. The UI renders `relatedIds` = the entry's own
  `related` **plus** any entry that lists it (reverse links), so `term xmp ↔ tweak xmp-expo` chips
  appear both ways **without editing `tweaks.json`**. Lint fails on any dangling `related` id, or on
  any entry that lists **its own id** (self-reference).

## Alias policy (Cowork audit, 2026-06-05)
- **Generic descriptive phrases are valid aliases; distinctive coined product names are never valid —
  even as search keys.** A coined product name ties a whole category to one vendor and can misclassify
  a legitimate tool. (Fix this audit: removed `process lasso gaming mode` from `dll-injectors` —
  Process Lasso is a real, non-injecting product; the alias was a dataset error.)

## Search & Autopsy behavior
- **Search**: diacritic-fold + lowercase, multi-word AND (every word must match name/alias/body),
  ranked exact-alias > prefix > substring > body. Pure + tested. UI defers the query for snappiness.
- **Autopsy**: longest-alias-first with a claimed-span overlap guard (per-entry dedupe; a short
  alias inside a longer matched span is not double-counted), word-boundary lookarounds
  (`(?<![a-z0-9])…(?![a-z0-9])`) so `ram` doesn't match inside `program`, tie-break
  `tweak < trick < guide < term` so a shared word credits the verdict-bearing entry. `unknown` =
  content lines containing no recognized term (never a guessed verdict). Input capped at 100 KB.
- **KNOWN, DELIBERATE behavior** — when a guide/term has a *longer* alias than a tweak for the same
  concept (e.g. guide alias `enable xmp` (10 chars) vs tweak alias `xmp` (3)), longest-first means
  the **guide** claims the span. So "enable XMP" in a pasted guide surfaces the *guide row* (which
  links to the safe how-to) and does **not** add to the `real` count. This is on purpose — the guide
  implies legitimacy and gives the steps. Don't "fix" it by deleting longest-first (the directive
  mandates it). If a future call wants verdict-bearing entries to always win overlaps, that's a
  conscious rule change, not a bug.

## The gated tier (Black Book Part 8) — slots in later, no migration
- `GuideEntry.tier` is already typed `"safe" | "gated"`; only `"safe"` ships and the lint asserts it.
- A future gated annex can: add `"gated"` guides (and/or a new entry type), gate them in the UI
  behind the Part-8 trust score + explicit consent screen, and surface them via a new filter or a
  separate locked section. The unified model, search, autopsy, related-links, and lint already handle
  arbitrary entries — only the **UI gate + trust-score + consent** are new. No schema migration, no
  catalog change, no mutation primitive (Part 8 is advisory / links-out only, per the Black Book).
- **Recommendation**: keep gated content in its own file (e.g. `blackbook.json`) and import it only
  when unlocked, so the safe library can never accidentally bundle risky how-tos.

## Debt / conscious choices
- `foldText` strips the literal combining-diacritics range (U+0300–U+036F). Functionally correct,
  slightly opaque in source; left as-is.
- Tooltip is simple CSS (fixed below the term, max-width 280px); no edge collision / flip logic. Fine
  for short inline labels; a term hard against the right edge could clip. Add flip/clamp only if it
  shows up in practice.
- vitest has no global RTL auto-cleanup here, so component tests add `afterEach(cleanup)` locally. A
  future test-infra pass could set test globals + a single cleanup in `src/test/setup.ts` instead
  (left out now to avoid touching unrelated suites).
- Autopsy grades on an explicit **Grade** click, not live — live grading would run ~600 candidate
  regexes over up to 100 KB on every keystroke. If live is wanted, precompute one combined matcher.
- Tooltips wired to **8 static sites only** (debrief tiles + capture context, comparison card,
  monitoring explainer). Readiness rows and most labels are **backend strings**, intentionally not
  auto-wrapped (that's the carpet-bomb the directive warned against). If specific backend rows want
  tooltips later, add a small curated `string → term-id` map for just those rows.

## Edge cases for future sessions
- Adding a term whose id collides with a tweak id → **lint fails** (unique ids). Pick a distinct slug.
- Every `related` id must resolve → **lint fails** otherwise. Add both ends.
- Banned-word lint fails on `simply` / `obviously` / `basically` (whole word). **`just` is NOT
  linted** — it's handled in the manual tone pass; watch for trivializing "just" in review.
- The **no-unexplained-acronym** rule is manual, not automated. CMOS and POST were the two gaps fixed
  this chapter (added a `clear-cmos` term; reworded POST). Any new acronym in prose needs its own term
  entry (the lint won't catch it).
- `DebriefTile`'s `label` prop is now `ReactNode` (was `string`) to host a `<Term>`. Keep that if
  refactoring the debrief.
- The Library file is still named `TweakEncyclopedia.tsx` (default export consumed by `App`); the
  surface is the full library. Renaming would touch App's import — not worth it.
