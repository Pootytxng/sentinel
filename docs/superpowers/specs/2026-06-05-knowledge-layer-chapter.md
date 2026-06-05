# Knowledge Layer Chapter — owner directive (pinned spec)

*2026-06-05. This directive was delivered to the executing session by paste; this file is the
canonical, compaction-proof copy. If you are the executing session: treat THIS FILE as the source
of truth, and re-read it after any context compaction or restart. If anything in your memory of
the pasted prompt conflicts with this file, the file wins.*

---

KNOWLEDGE LAYER CHAPTER — "Reveal the magician's tricks" (owner directive, 2026-06-05)

You are building Compy's knowledge layer: one searchable, offline, bundled-in-app library where a
gamer can type any word they heard on YouTube/Reddit and get the honest answer — definitions,
tweak verdicts, scam-pattern education, and safe guides. This chapter is CONTENT + read-only UI
only. It grows the product upward (understanding/proof/confidence), never sideways into new
switches. Read these before writing any code:
  - docs/ADVANCED_PERFORMANCE_BLACK_BOOK.md  (the research source of truth — especially Part 0's
    taxonomy, Part 8's gated-access design, and the golden rules)
  - src/data/tweaks.json                      (42 shipped tweak-verdict entries — the seed)
  - src/surfaces/TweakEncyclopedia.tsx/.css   (the shipped search surface you're extending)

────────────────────────────────────────────────────────────────────────
THE VOICE (owner's #1 requirement — this is law for every user-facing string)
────────────────────────────────────────────────────────────────────────
Every description must read like a sharp friend explaining something at a LAN party: familiar,
relatable, analogy-flavored when an analogy genuinely speeds understanding, fun enough that
learning feels like a perk — and NEVER at accuracy's expense. Rules:

1. Accuracy outranks the joke. If the analogy bends the fact, cut the analogy, keep the fact.
2. One analogy max per entry, and only where it earns its keep. No analogy pile-ups.
3. Short sentences. Define a term before using it. No unexplained acronyms anywhere — if an
   acronym appears inside another entry's text, it must exist as its own term entry.
4. Banned words: "simply", "obviously", "just" (as in "just do X"), "basically". If it were
   simple they wouldn't be searching it.
5. When the honest answer is "it depends," say it charmingly — never fake certainty.
6. No fear-tone, no hype-tone. Risky things get calm, specific warnings, not sirens.
7. Sentence case. Compact: term entries ≤ 2 sentences of "what" + ≤ 3 of "more". Respect the
   reader's brain budget — mitigating information overload is a design goal, not a nice-to-have.

Calibration examples (match this energy):
  TERM xmp — BAD: "XMP (Extreme Memory Profile) is an Intel SPD extension enabling operation
  beyond JEDEC baseline frequencies."
  GOOD: what: "Your RAM ships running slower than the speed printed on the box. XMP is the BIOS
  switch that unlocks the speed you already paid for." more: "AMD boards call it EXPO (or DOCP on
  some ASUS boards). One BIOS toggle, real gains in CPU-heavy games — the rare tweak that's
  actually free money. If the PC won't boot after, clearing CMOS puts everything back."
  TERM 1-percent-lows — GOOD: what: "The average of your worst 1% of frames — the number that
  measures stutter. Average FPS is your highlight reel; 1% lows are your bad days." more: "Two
  PCs can both say '144 FPS average' while one feels silky and one feels like a slideshow with
  good PR. The lows are the difference."
  TRICK fake-deep-scan — GOOD: pattern: "The optimizer runs a dramatic 45-second 'deep scan'
  with a throbbing progress bar. The work it's pretending to do takes under a second — the delay
  is theater to make the result feel earned." honest_version: "Compy shows the real elapsed time
  on its checks (usually ~3 seconds) because the truth doesn't need a costume."

────────────────────────────────────────────────────────────────────────
ACCURACY RULES (non-negotiable)
────────────────────────────────────────────────────────────────────────
- Every factual claim must trace to ADVANCED_PERFORMANCE_BLACK_BOOK.md, to the existing
  tweaks.json verdicts, or be uncontroversial definitional knowledge. NO invented percentages,
  NO invented benchmark numbers, NO claims the Black Book contradicts.
- Contested or hardware-dependent claims get hedged language in-entry ("on some boards",
  "a minority of systems measure...").
- Tricks teach PATTERNS, never name competitor products or brands. Scams rebrand; tricks don't.
- After drafting, run a dedicated ACCURACY SELF-AUDIT pass: re-read every entry against the
  Black Book and flag/fix anything asserting more confidence than the source supports. Log what
  you changed in the final report.

────────────────────────────────────────────────────────────────────────
WORKSTREAM A — dataset architecture
────────────────────────────────────────────────────────────────────────
Extend the knowledge data model to four entry types behind ONE search:
  tweak (exists, 42 entries — do not regress these), term, trick, guide.
Implementation freedom is yours (separate JSON files per type or one file with a `type` field),
but requirements: single search index across all types; per-type card styling; `related` field
(array of entry ids) for cross-links rendered as tappable chips (term xmp ↔ tweak xmp-expo);
a `version` field on the dataset root for future migrations; everything bundled + offline — no
network, no remote fetch, no new capabilities.
Add a dataset lint as a UNIT TEST (not a loose script): validates schema keys per type, unique
ids across all types, verdict enums, every `related` id resolves, no empty strings, and — voice
guard — fails on banned words ("simply", "obviously", "basically") in user-facing fields.

────────────────────────────────────────────────────────────────────────
WORKSTREAM B — the TERMS dataset (~50–70 entries, the jargon dictionary)
────────────────────────────────────────────────────────────────────────
Fields: id, name, aliases[], what (≤2 sentences), more (≤3 sentences), related[].
Cover at minimum: xmp/expo/docp, vrr, g-sync/freesync, v-sync, frametime, 1% lows / 0.1% lows,
input latency / click-to-pixel, hz vs fps, frame generation, upscaling (dlss/fsr/xess), native
resolution, hags, mpo, hpet, c-states, pbo / curve optimizer, undervolting, thermal throttling,
vram, resizable bar / sam, nvme vs ssd vs hdd, raid, pagefile / virtual memory, secure boot,
tpm/ftpm, uefi vs bios, csm, kernel / user space, kernel driver, dll injection, anti-cheat
(vanguard/eac/battleye as concepts), etw, overlay, exclusive fullscreen vs borderless, dpc
latency, interrupts / msi mode, polling rate, ppi/dpi, shader compilation, traversal stutter,
ue5, drivers / driver age, ddu, telemetry, debloating, registry, restore point, power plans,
core parking, noise floor, benchmark, 'run-to-run variance', placebo effect (yes, as an entry —
it's the most important term in the whole product).
Voice rules apply to every single one. Write them as if each entry might be the only thing the
user ever reads in Compy.

────────────────────────────────────────────────────────────────────────
WORKSTREAM C — the TRICKS dataset (~12–15 patterns, the magician's secrets)
────────────────────────────────────────────────────────────────────────
Fields: id, name, aliases[], pattern (what the trick looks like, ≤3 sentences), tell (how to
spot it, 1–2 sentences), honest_version (what an honest tool does instead — this is where the
Compy contrast lives WITHOUT naming Compy as flawless or competitors by name), related[].
Cover at minimum: the fake deep scan; the invented issue counter ("847 problems found!"); the
fake optimization score; fear-tone scareware UX; the RAM-cleaner sold as a game booster; paid
"driver updater" subscriptions; the tweak mega-pack with no undo; "+40% FPS" claims with no
noise floor / no measurement methodology; the fake before/after with mismatched scenes;
subscription traps on local-only functionality; "secret Windows settings Microsoft hides from
you" framing; bundled bloat installers; testimonial walls instead of measurements.

────────────────────────────────────────────────────────────────────────
WORKSTREAM D — the GUIDES dataset (SAFE tier only, ~6–8 entries)
────────────────────────────────────────────────────────────────────────
Step-by-step only for entries the Black Book rates green-gain/safe-risk: the VRR sync stack
(vrr + v-sync + cap), fps caps, startup cleanup, shader cache size, driver update done right
(vendor-direct + when DDU is actually warranted), fan curve basics (via vendor software), xmp
(with the strong framing: every BIOS looks different, here's the concept + the universal recovery
path — clear CMOS — and "if this paragraph made you nervous, that's a fine reason to skip it").
Every guide opens with the Black Book golden rules in one line (one change at a time · restore
point first · measure, don't vibe) and ends with how to undo. Fields: id, name, aliases[],
goal (1 sentence), steps[] (each ≤2 sentences, voice rules apply), undo (1–2 sentences),
related[].
EXPLICITLY OUT OF SCOPE THIS CHAPTER: the gated Black Book annex (Part 8 trust-gated risky
how-tos). Do not build the gate, the trust score, or any risky-tier guide content. Read Part 8 so
the architecture doesn't paint it into a corner (e.g., guides carry a `tier: "safe"` field so a
"gated" tier can exist later), but ship nothing gated.

────────────────────────────────────────────────────────────────────────
WORKSTREAM E — UI: unified library + Guide Autopsy + inline tooltips
────────────────────────────────────────────────────────────────────────
1. Evolve TweakEncyclopedia into the unified library: one search bar, type filter chips
   (All / Tweaks / Terms / Tricks / Guides), per-type card design consistent with the design
   system, related-chips navigation, honest empty state ("No entry for that yet — we only answer
   what we've verified" — and make the no-result state log-free/local, obviously).
   Search must match name + aliases + reasonable substrings, case-insensitive, diacritic-safe,
   debounced; with ~120 entries everything stays instant — but write the matcher as a PURE
   function with unit tests (exact alias hit, partial, multi-word, no-hit).
2. GUIDE AUTOPSY: a paste box ("Paste a tweak guide — get the autopsy"). Local-only parsing:
   match pasted text against ALL entry aliases (longest-alias-first to avoid substring
   double-counts; dedupe per entry), then render the grade: "This guide: 3 real · 5 placebo ·
   2 risky · 4 things we don't recognize." Per-hit rows link into the library. The unmatched
   line is mandatory honesty: unknown items get "no verdict", never a guessed one. Pure matching
   core with thorough unit tests (overlapping aliases, repeated mentions, case soup, empty
   paste, 100KB paste — cap input length gracefully).
3. INLINE GLOSSARY TOOLTIPS: a small component (e.g. <Term id="vrr">VRR</Term>) rendering a
   subtle dotted underline; hover/tap shows the term's `what` with a "more" link into the
   library. Wire it into HIGH-TRAFFIC existing copy only this pass: the first-check verdict
   strings, debrief tiles/insight, and readiness check copy where jargon already appears
   (1% low, VRR, driver age, power plan). Don't carpet-bomb every string — ≤ ~12 call sites,
   tasteful. Tooltip must be keyboard-accessible and not break existing tests.

────────────────────────────────────────────────────────────────────────
QA, SELF-REVISION & DILIGENCE (the owner wants this chapter EARNED)
────────────────────────────────────────────────────────────────────────
Work in this order: (1) propose your build sequence + any schema decisions in a short plan
message, then proceed (sport mode — don't wait on approvals for reversible work); (2) build;
(3) DATASET DRAFT pass; (4) SELF-REVISION PASS A — tone: re-read every user-facing string
against THE VOICE rules, rewrite violations, log a before/after sample; (5) SELF-REVISION PASS
B — accuracy audit vs the Black Book (log corrections); (6) tests: dataset lint test, matcher
tests, autopsy tests, tooltip render test, plus the full existing suites (cargo + npm + tsc +
vite) green per commit — clippy -D warnings stays clean; (7) integration self-QA: search each
of 10 random entries, autopsy a real pasted guide text you write as a fixture, click every
related-chip path, verify empty states; (8) FUTURE-INSIGHT notes: write a short
docs/superpowers/specs/2026-06-05-knowledge-layer-notes.md recording schema versioning
decisions, how the gated tier slots in later, any tech debt knowingly taken, and edge cases
future sessions should know about.

Commit hygiene: feature-scoped commits, tests green per commit, no behavior change outside this
chapter's scope. Batch all questions to the end of the run.

STANDING CONSTRAINTS (unchanged, non-negotiable): gaming_mode_gate() stays false · remote fetch
stays off · updater off · recommendation catalog frozen (this chapter adds KNOWLEDGE, never new
appliable tweaks) · no new capabilities/permissions · no network calls of any kind · beta refs
16069fa untouched · verification never skipped.

FINAL REPORT FORMAT: what landed per workstream · entry counts per type · test counts before/
after · tone-pass sample (3 before/afters) · accuracy-audit corrections list · known gaps ·
questions batched.
