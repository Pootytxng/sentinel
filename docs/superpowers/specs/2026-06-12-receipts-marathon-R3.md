# 2026-06-12 — RECEIPTS MARATHON R3 (CC autonomous long-run, owner GO)

> The first marathon under the Receipts Doctrine (`docs/RECEIPTS_DOCTRINE.md` — governs every
> item; Zero-Budget Law §6 — nothing requiring an account or a dollar; placeholders + single-
> constant swap points instead). Protocol = R1/R2 precedent (`AUTONOMOUS_SPRINT_2026-06-11*.md`):
> per item build → verify → commit → push; /check + /security per lane; running log + owner
> Review Queue in `docs/superpowers/AUTONOMOUS_SPRINT_2026-06-12-R3.md` (CC creates).
> Owner mandate: longest run yet, maximum doctrine progress, all reversible.

## §1 GLOBAL HARD LINES (any item that can't fit them → Review Queue, skip, continue)

1. `src-tauri/capabilities/`, CSP, `tauri.conf.json`, opener allowlist: **UNTOUCHED.**
2. **Zero outbound network code. Zero endpoint URLs/secrets.** The verified zero-outbound
   property must hold at every commit of this marathon.
3. Every money surface ships behind a **hard-false gate** (test-pinned, gaming_mode pattern) or
   as **copyable / export-only links** (driver-freshness pattern). Nothing armed.
4. `actions.rs` + all mutation/rollback paths untouched. Locked gates + frozen refs (`16069fa`,
   `beta/private-beta-001`) untouched.
5. **No fabricated numbers anywhere** — site copy, UI copy, tests' fixture names included.
   Receipts law: time-and-sample-qualified or absent.
6. Site stays **DARK** — built, committed, never hosted/published (hosting = owner).
7. Rigor floor: cargo + npm + tsc + `clippy -D warnings` green per item; suites never skipped.
8. **STOP-AND-LOG, never do:** anything needing a capability/CSP/network/gate/mutation change or
   new privilege; and if the model auto-switches on a security classifier, halt the lane (per
   CLAUDE.md precedent).

## §2 LANES (priority order — deepest doctrine value first)

### LANE A — Dark site build-out (Phase 2 seed; static only)
- **A1. Unify the two generators** (audit flag from 2026-06-12): `site/generate.mjs` and
  `scripts/export-library.mjs` share ONE rendering core (one source of truth for page HTML);
  curated debunk pages and the full-library export both come from it. No duplication left.
- **A2. Full dark site structure:** `site/` gains a landing `index.html` (hero copy DRAFT per
  doctrine §5 voice — owner taste-gates before any publish), the full library section (consumes
  the exporter), an email-waitlist **placeholder slot** (provider-agnostic comment block — no
  provider chosen, no account needed), a Ko-fi **placeholder slot**, and a single
  `SITE_URL`/`WAITLIST_EMBED`/`KOFI_URL` constants module so real values swap in ONE place later.
- **A3. Curated debunk growth:** promote 5–8 more high-search-intent Library entries to curated
  pages (config-driven like `debunks.config.json`). All-original law; receipts law on every claim.
- **A4. Share-card → site loop:** exported share card + web report footer carry the `SITE_URL`
  constant ("Measured, not promised — Compy") so every shared artifact points home once a real
  URL exists. Frontend/export-template only.

### LANE B — Affiliate advisory surface (Phase 4 groundwork; advisory-only)
- **B1. Spec first** (short, in the sprint log): which Priorities/limiter verdicts qualify
  (ONLY rows where the verdict already names hardware as the limiter — right-room law).
- **B2. Build:** an "Upgrade path" advisory block on qualifying verdict rows — **copyable** plain
  retailer search links (no affiliate tags; single `retail-links.ts` module = later tag swap),
  mandatory disclosure line ("If you buy through Compy links we may earn a commission — it never
  affects verdicts."), tooltip-honest. Exported HTML/MD reports render the same links as real
  anchors (user's browser opens them — zero opener-allowlist change). In-app stays copy-only.
- **B3. Tests:** qualifying-row logic pure + pinned; disclosure always renders with links;
  zero links on non-hardware verdicts.

### LANE C — Receipts telemetry GROUNDWORK (Phase 3; dark, zero network)
- **C1. The spec** (CC drafts `docs/superpowers/specs/2026-06-12-receipts-telemetry-spec.md` for
  OWNER review + the future security pass): opt-in, default-OFF, anonymous (no PII/serials/paths),
  payload schema (measured results + hw class only), user-inspectable payload before any send,
  kill-switch, retention stance. This spec does NOT authorize network code — it queues for owner
  sign-off per doctrine §2.
- **C2. Build dark:** pure payload-builder module (serialize a session/fix outcome to the schema)
  + consent UI behind `receipts_gate()==false` hard-false (test-pinned) + "inspect your receipt"
  preview surface. **No network primitive, no endpoint, no capability change** — the send path
  simply does not exist yet. Mirror of the Ed25519/remote-rules pattern: logic wired, ammo absent.
- **C3. Tests:** gate false pinned; payload builder rejects/strips anything PII-shaped; preview
  renders exactly what would send.

### LANE D — Local KPI counters (doctrine "money plan runs on receipts"; local-only)
- **D1.** Count locally (existing local storage, zero new IPC if possible): exports created,
  share-cards copied, walkthroughs opened, debunk pages exported. Surfaced as a quiet line in
  Export ("this rig's Compy stats") — honest, local, and the future opt-in telemetry's seed data.

### LANE E — Compy Pro dark scaffold (Phase 5; lowest rank, cheap now)
- **E1.** Pure entitlements module: `Tier::Free | Pro`, `pro_gate()==false` hard-false test-pinned,
  everything-free semantics unchanged at runtime; inventory doc (in sprint log) of which surfaces
  would gate later (history depth, multi-rig, overlay themes). NO user-facing change.

### LANE F — STRETCH: Library knowledge growth
- **F1.** +3–5 honest debunk entries (knowledge growth, 63e8a54 precedent — NOT appliable-catalog
  growth) chosen to pair with Lane A site pages. Receipts law absolute.

## §3 HOSTING DECISION (Cowork deep-research, locked 2026-06-12)

**Default host: Cloudflare Pages (free plan).** Verified 2026-06-12: no bandwidth cap on any
tier and NO overage-billing mechanism (a surprise bill is structurally impossible — the
zero-budget law's nightmare scenario removed), deploys from PRIVATE repos (our repo stays
private until first-public-exposure law), free `<project>.pages.dev` subdomain now, 5 custom
domains/project with auto-SSL when `compy.gg` is bought, 500 builds/mo + 20k files (site ≈130
pages — ample). Decisive synergy: the Phase 3 telemetry endpoint can ride Cloudflare Workers'
free tier (100k req/day) on the SAME $0 account — one platform carries Phases 2 AND 3.

Rejected: **Vercel Hobby** (terms prohibit commercial use — affiliate links qualify; account
terminable without notice) · **GitHub Pages free** (requires a PUBLIC repo; ours is private by
law until public exposure) · **Netlify free** (2026 credit model ≈ 15 GB effective + documented
surprise-bill history + account-wide pausing). Forms gap on Cloudflare is covered by the Lane A
provider-agnostic embed slot (Tally-class free form, decided at publish time).

**Lane A consequence:** the `SITE_URL` placeholder default shape is `https://<project>.pages.dev`
(single-constant swap to `https://compy.gg` later). Owner account creation (free, no card) is
deferred to publish time — nothing needed during the dark build.

## §4 Per-lane verify + report

Per item: one commit, pushed. Per lane: /check + /security, then a one-line report entry
(hashes · what · one verify line). Final report: lane lines + Review Queue summary + suite
counts. After the final commit: `npm run tauri dev` for the owner's eyeball pass (Lane B block,
Lane D stats line). Anything visual goes on the owner eyeball list in the log.
