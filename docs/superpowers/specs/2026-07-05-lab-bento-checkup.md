# Lab bento checkup — the Lab as a checkup room (owner directive 2026-07-05)

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04 (#369).** This pre-rebirth Lab product/UI directive is
> historical and cannot independently authorize redesign or implementation. Current experience and
> journey law come from `docs/PRODUCT_CONSTITUTION.md`; useful implementation observations below are
> bounded provenance only.
>
**Owner ask (verbatim intent):** rework the Lab's face into a bento-style menu (React Bits
MagicBento, already vendored) ordered **chronologically left→right in the proper execution
order** for benchmarking/assessment; annotate everything into a **summary the user can easily
comprehend** — what the results entail *for them specifically*. Metaphor: **taking your PC to
the doctor's office for a checkup** — comprehensive, with clear reasons for importance, but
never scary ("the patient doesn't run away when they see the needle"). Fun + interactive so
anyone can tinker and **learn things about their PC just by playing around**.

## What already exists (build ON it, not beside it)

The guided bench (`compy_lab_guided`, spec 2026-07-05-lab-linear-guided-bench) already owns the
semantics: `LAB_STATION_ORDER` (diagnostics → benchmark → latency → tuning → blackbox — the
know-your-rig → prove-change → chase-lag → tame-heat → explain-failure story), the four-line
station contracts, and `stationReading()` (live, one-source, honest "No reading yet"). This
train adds the **presentation + synthesis** the owner asked for:

1. **Bento face** — a MagicBento-interaction grid of station cards replaces the router/welcome
   as the Lab's opening screen. Cards run left→right in `LAB_STATION_ORDER` (numbered 1..N over
   the stations this rig has — same vendor/diagnostics gates, never adds/removes an
   instrument). Each card: station number + status LED (read / not yet) · name · what-it's-for
   line · the LIVE reading line (same `stationReading()` source) · a one-line **lab note**
   (educational, static, factual — the "enlightening to discover" layer). Click = the existing
   router jump (scroll + expand that station below — navigation never teleports).
2. **Checkup report** — a synthesized summary panel under the grid: honest coverage headline
   ("3 of 5 stations have readings"), per-station annotated lines (the same live readings,
   never a second derivation), and ONE next-step ("Next: station 2 — Benchmark…") pointing at
   the first unread station in bench order. Zero readings = an honest, welcoming
   "checkup hasn't started" state — never fabricated results.
3. **One detail at a time** (CORRECTED same-day — owner feedback: the grid IS the menu, a
   second standing list of the same five stations below it is clutter). Bento-on renders NO
   station accordion list; clicking a card opens exactly one detail panel (station header +
   the identical instrument body) below the report — click again closes, another card swaps.

## Flag + rails

- `compy_lab_bento`, **DEFAULT OFF**, Settings → Appearance "Lab checkup bento (preview)",
  live-reactive (`compy:lab-bento-changed`), P-series contract: flag off ⇒ today's Lab
  byte-identical (both guided states), test-pinned. Bento takes precedence over the guided
  face when both are on (it subsumes the router).
- **Honesty:** reading lines and checkup lines come from `stationReading()` — one source, no
  drift, no invented numbers. Lab notes are static generic facts (no rig-specific claims).
- **Motion:** all gsap effects behind the app's resolved reduced-motion (`useReducedMotion`);
  tilt + magnetism stay OFF (restraint rails — never template-y); particles small; glow =
  THEME ACCENT (computed at mount), never the vendor purple.
- **Needle rule:** the read-only promise leads the room copy — nothing here changes the PC;
  every station card says what it's for and why it matters in plain words.
- Zero src-tauri, zero new IPC — same reads Lab already makes.

## Out of scope (follow-on)

Stepper (owner's second prompt) — vendor Compy-tokenized, wire to Setup/guide flows. Separate
commit(s) on the same train.
