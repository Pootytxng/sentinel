# AUTONOMOUS SPRINT 2026-06-12 — RECEIPTS MARATHON R3 (running log)

> Spec: `docs/superpowers/specs/2026-06-12-receipts-marathon-R3.md` (owner GO; Fable 5 lane).
> Governing law: `docs/RECEIPTS_DOCTRINE.md` incl. §6 Zero-Budget. Protocol: per item
> build → cargo + npm + tsc + clippy `-D warnings` green → commit → push; /check + /security
> per lane. Global hard lines spec §1 — STOP-AND-LOG over doing.

## Running log

- (start) Spec + COWORK_HANDOFF.md committed (`78768f1`); this log created.
- **LANE A COMPLETE** — `3a13cc3` A1 shared rendering core (scripts/lib/library-render.mjs; both
  generators are thin wrappers; one chip vocabulary from the glossary) · `38d5c4b` A2 dark site
  (landing regenerated w/ doctrine-voice hero DRAFT + glossary-fed verdict key; waitlist/Ko-fi
  placeholder SLOTS swap via src/data/site.ts; full 126-page library under gitignored
  site/library/) · `e4b091c` A3 curated debunks 3→11 (search-intent picks, deliberate verdict mix)
  · `d8b46d3` A4 report+card footers from paired SITE_URL/SITE_TAGLINE consts (export.rs ↔ site.ts,
  test-pinned). /check + /security clean (0 new IPC; zero network; escaping consistent; Rust-side
  consts keep the webview out of footer content). cargo 317 · npm 267 · tsc + clippy clean.

- **LANE B COMPLETE** — `44c3c33` upgrade-path advisory (+`b9714af` Cowork hosting decision
  committed). B1 spec (recorded here): qualifying verdicts are EXACTLY the two that already name
  hardware — the GPU-limited session verdict (shared `GPU_LIMITED_PCT=95` const with the session
  hint) and the install-drive HDD attention; no new detection. ONE pure Rust source
  (`priorities::build_upgrade_path`) feeds both the existing get_priorities payload (zero new
  IPC) and the export's real MD anchors; the retailer-link table (plain Amazon/Newegg searches,
  no tags — test-enforced) lives in priorities.rs = the single future tag-swap point. Engineering
  fork recorded: the spec's `retail-links.ts` became a Rust table — exported reports must never
  render webview-supplied URLs, and one source beats two-language drift. In-app links are
  COPY-only buttons + mandatory disclosure. /check + /security clean (read-only, static consts,
  capabilities untouched). cargo 322 · npm 269.
- **LANE C COMPLETE** — `099647c` Receipts telemetry GROUNDWORK, built dark. C1 spec
  (`2026-06-12-receipts-telemetry-spec.md`) queued for OWNER review — authorizes nothing. C2:
  `receipts_gate()` hard-false test-pinned · pure payload builder (anonymous by SCHEMA: basename
  sanitization, buckets not exact values, catalog ids only — adversarial tests pin that paths/
  usernames cannot survive serialization) · 2 read-only IPC (gate probe + preview that refuses
  while dark) · ReceiptsConsent surface in Settings renders NOTHING today (fail-dark). Zero
  network primitive/endpoint/queue in the binary — grep-verified (the only reqwest/connect hits
  repo-wide are word fragments + the disabled remote-rules comment). /check + /security clean.
  cargo 328 · npm 271.
- **LANE D COMPLETE** — `d14b627` local KPI counters (localStorage; corruption-proof reads,
  best-effort writes) + the quiet Export-modal stats line, hidden until non-zero, "(counted
  locally, only on this PC)". Zero IPC/network. Spec's "debunk pages exported" counter skipped —
  no such in-app event exists (the Library export is build tooling). npm 274.
- **LANE E COMPLETE** — entitlements.ts dark scaffold: `Tier = free|pro`, `proGate()` hard-false
  test-pinned, `entitled()` = the single future gating primitive; NOTHING imports it for gating
  yet (gating is a future Phase 5 commit). Runtime byte-identical. **Pro-surface inventory
  (candidates, owner curates at Phase 5):** session history beyond last-20 · cross-session
  comparisons/multi-rig profiles · overlay customization (density/backdrop presets, themes) ·
  deep monitoring charts (MonitoringTab embedded views) · benchmark scoreboard history depth.
  Free FOREVER (trust engine, per doctrine §1): all safety/rollback, the Library, Check/Fix,
  readiness, basic monitoring + overlay, Export.

## Review Queue (owner)

- **Landing copy taste-gate (Lane A2):** the 2026-06-06 money-last landing was SUPERSEDED by the
  generated doctrine-voice landing (old version preserved in git history at `e390b1f`). Hero/sub
  copy is a DRAFT — eyeball before any publish. Site remains dark.
- **Curated picks (Lane A3):** CC-provisional 11; swap freely in site/debunks.config.json.
- **Receipts telemetry spec (Lane C1):** `2026-06-12-receipts-telemetry-spec.md` awaits your
  read/edit — it's the gate-flip ladder's step 1. Nothing ships without it.
- **Affiliate disclosure wording (Lane B):** "If you buy through Compy links we may earn a
  commission — it never affects verdicts." Copy/taste call if you want different words.
- **Pro-surface inventory (Lane E):** candidate list above — curate whenever Phase 5 nears.

## Owner eyeball list (visual surfaces)

- site/index.html landing (open the file in a browser — dark, not hosted).
- Check → "Upgrade path (advisory)" block (Lane B): needs a GPU-limited session or an HDD
  install-drive verdict to appear; copy buttons + disclosure.
- Export modal → quiet "This rig's Compy stats" line (Lane D; appears after the first export).
