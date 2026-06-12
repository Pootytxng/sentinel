# 2026-06-12 — Learn → "Blackbook" rename + the Sarah & Caleb plain-language law

> Owner taste decisions (2026-06-12): (1) Learn renamed toward "The Blackbook" — rail label
> **"Blackbook"** + plain doorknob descriptor; the site's debunk hub brands as **"The Compy
> Blackbook."** (2) Standing law, named for his two non-technical testers: **the Sarah & Caleb
> bar** — every description/definition/guide must be comprehensible to a non-technical reader;
> jargon may never be defined with more jargon.

## §A Rename (Tune-rename pattern: label-only, id preserved)

- homeRail: `{ id: "learn", label: "Blackbook" }` + always-visible plain descriptor where the
  rail/room header allows: "what actually works — measured" (CC drafts placement per doorknob
  law; owner eyeballs live).
- Sweep every user-facing string referencing the Learn room (WhatsThis links, walkthrough copy,
  quick-look overlay, Check/Tune cross-links, export text).
- Site: debunk hub/index section titled "The Compy Blackbook"; page footers may carry it.
- naming-proposals doc updated: Learn row marked DECIDED (Blackbook) + executed hash.

## §B The Sarah & Caleb bar (plain-language sweep + guard)

1. **The law (record in design kernel):** every entry, guide, verdict, tooltip, and advisory
   passes the bar — a smart non-technical reader gets it on first read. Every technical term is
   either avoided, explained in everyday words at first use, or carries its glossary chip.
   Plain ≠ vague: numbers, qualifiers, and receipts stay (receipts law unchanged).
2. **Sweep:** all Library/Blackbook entries, verdict glossary, walkthrough captions, advisory
   strings. Rewrite circular definitions (terminology reiterating terminology). Analogies
   welcome; condescension never (bathroom law).
3. **Guard (pragmatic, automatable):** curated jargon list (e.g. HPET, mV, VBS, MPO, swapchain,
   ETW, SMT, XMP/EXPO, frametime, 1% low…) — a test asserts no Blackbook entry uses a listed term
   without an inline plain-words gloss or glossary link in the same entry. Extends the existing
   voice-guard pattern.

## Hard lines

Copy/labels only — zero behavior/logic/IPC changes · ids/routes preserved (`learn` stays
internally) · receipts law on every rewritten line (plain wording never weakens or inflates a
claim) · doorknob/bathroom/foam-pit laws · frozen refs (16069fa) untouched.

## Verify

npm + tsc + cargo green (rail parity + voice/jargon guards green); /check clean. Then
`npm run tauri dev` — owner eyeballs the Blackbook room + reads one rewritten entry as the
Sarah & Caleb litmus.
