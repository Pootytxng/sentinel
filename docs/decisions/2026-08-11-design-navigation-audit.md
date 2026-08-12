# Design & navigation audit — Compy 3155c7a0, captured live 2026-08-11

Owner ask, verbatim: *"do a self review of the design and layout of anything in the app and give a
genuine general consumer and or professional app designer opinion on how intuitive and easy to
navigate the app is and tell me what changes youve decided that would be an improvement without any
limitation ... this includes Wording, font, format, color scheme, color coded mechanisms,
accesibility"*.

**Method.** The installed release build `3155c7a0` launched with a WebView2 debug port, real OS
window at 1484×971 (`docs/ui-sweep/resize-main.ps1`), captured natively with
`docs/ui-sweep/cdp-shot.mjs`, and measured with `docs/ui-sweep/cdp-eval.mjs`. Every number below is
measured on the running app, not estimated from source. Rooms covered: the first-run tour, Home,
Monitor, Blackbook, Lab.

**Headline.** The *content* is better than almost anything in this category — the Blackbook record and
Home's "what are you here to do?" band are genuinely excellent product thinking. The *presentation*
undercuts it in three specific, fixable ways: the app is written almost entirely in microtype, the
room accent colours collide with the status colours that are supposed to carry meaning, and the
largest text on the most important screen is the least informative word on it.

---

## 1. Accessibility — measured, not eyeballed

A contrast sweep of every leaf text node in one room (Blackbook) found **27 nodes below their WCAG AA
floor**, and a token-scoped recount found **32 nodes** carrying the third text tier below 4.5:1.

The cause was a single token. `--v2-faint` was `#626a80`, tuned to the **AA-large 3.0** floor on the
theory that it was a caption tier. It was not: every rule in `src/` that paired it with an explicit
size set that size at **9–11px**, so the whole tier shipped at **3.44–3.63:1**. The repo already knew
— `tokens-v2-guard.test.ts` carried a 29-site ratchet freezing the violations, whose own stated
retirement condition was "raise the token past 4.5:1".

**DONE this train.** `--v2-faint` → `#7a8397`: 4.65:1 on the lightest v2 surface (`--v2-panel-2`),
4.94:1 on `--v2-bg`. Live re-measurement: **32 failing nodes → 0**. The palette floor for `faint` was
raised 3.0 → 4.5 and the 110-line ratchet deleted — it is unnecessary once no failing class exists.

The honest cost, recorded because it will come up again: on a near-black ground **three text tiers
cannot all clear AA at 9px**. `faint` now sits close to `muted`. The third tier has to be carried by
**size and weight**, not by dimming further.

**Second a11y defect, DONE.** Every rail tab's accessible name was the room name **plus the shortcut
digit** — a screen reader announced "Home 1", "Blackbook 3". The `<kbd>` is now `aria-hidden` and the
shortcut declared via `aria-keyshortcuts`. Pinned by an exact-name test in `ShellV2.test.tsx`.

### Still open (decided, not yet built)

- **A 12-size type scale is not a scale.** One screen renders text at 8, 9, 10, 10.5, 11, 12, 12.5,
  13, 13.5, 16, 19 and 32px. **57% of all text nodes (47 of 83) are 11px or smaller**, and exactly one
  element on the page is above 19px. *Decision: collapse to a 6-step token scale and raise the floor
  to 11px — delete 8px and 9px entirely.* The target user is a non-technical gamer, often sitting
  further from a 1080p screen than a designer sits from a laptop.
- **Five font families on one screen** — Geist Sans, Geist Mono, Segoe UI Variable Display, Cascadia
  Mono, and **Arial**. Arial means a stack is falling through; it is why the tour's `✓` renders like a
  square-root sign. *Decision: bundle the glyphs, kill the Arial fallthrough.*

## 2. Colour — the room accents collide with the status palette

This is the most consequential finding and it is not a matter of taste. `tokens-v2.css` states the
rule itself: *"Status — color is information, never decoration."* The room identities break it.

| | room accent | status token | collision |
|---|---|---|---|
| Lab | `#27e08a` emerald | `--v2-ok: #3ddc97` | **near-identical green** |
| Blackbook | `#f0b878` amber | `--v2-warn: #f5c542` | **both amber** |
| Monitor | `#3fd9c2` teal | — | teal also draws the live data |
| Home | `#a78bfa` violet | — | clean |

Consequences a consumer actually feels: the entire Lab glows the same hue as "this is good", so
green stops meaning good there. The entire Blackbook glows the same hue as "warning" — **a room that
exists to reassure you reads as an alert**, including its active tab pill. On Monitor the accent is
simultaneously the room, the healthy state, and the plotted data.

**Decision: rooms stop owning hue.** Give each room its identity through the **glyph, the masthead
eyebrow and a single hairline**, and return `ok / warn / info` to being the *only* things in the app
allowed to use green, amber and blue. If rooms must stay tinted, move their accents off the status
hues entirely (violet, indigo, slate, rose) — never emerald and never amber.

**Also decided:** stop dimming zero-value stats. Blackbook's "GUIDES FACT-CHECKED · 0" is greyed
below its three neighbours, which reads as *disabled/broken* rather than *none yet*. A zero is data.

## 3. Wording

- **"Home" is the wrong name and the wrong H1.** On the diagnostic screen, `Home` is set at 32px —
  the largest text in the app — while the actual verdict, *"You're ready to play"*, sits under it at
  24px. **The least informative word on the page is the biggest.** *Decision: the verdict becomes the
  H1; the room name shrinks to the eyebrow it already has ("RIG DIAGNOSTIC"). Rename the room to
  something that answers a question — "Health" or "Diagnosis".*
- The topbar sets `Blackbook · what actually works — measured`, `Monitor · watch it live`,
  `Lab · benchmarks, latency, diagnostics`. This is the **title-header law** violation the project
  already wrote down (header = room name, status goes in the body) — and each room then repeats its
  own name as an H1 90px below. *Decision: drop the topbar tagline; keep one name per room.*
- **Engineer-speak in consumer surfaces.** `ETW · external · anti-cheat safe — no injection, no
  kernel driver` (Monitor) and `no temp — Compy won't ship a kernel driver` (Home) are honesty notes
  written in the vocabulary of the person who built it. *Decision: keep the honesty, change the
  voice* — "CPU temperature needs a driver we won't install."
- `NO SIGNAL` on Monitor's empty charts reads as a fault, not an invitation. *Decision: say what to
  do* — "Press Start capture, then play."
- `DRIVES` as a section label on the tour's Power Supply step means the verb, but in a hardware app
  every reader parses it as **hard drives**.
- `1 / 10` + ten numbered dots + a progress line + Back/Next = **four** renderings of the same
  progress. `ledger 3`, `16/16 clean`, and `SAFE STACK 0` are all jargon on the consumer path.
- The wordmark's accessible text is **"ompy"** — the `C` is a graphic and is not in the name.

## 4. Format & layout

- **The first thing a new user meets is a 10-step hardware lecture.** Compy's own identity is *the
  first place you go after a crash*. Someone whose PC just crashed does not want to be taught what a
  power supply does, and step 5's left panel is a 640×500 placeholder whose own caption admits it
  cannot read the part. The flow is also called two different things — `GUIDED SETUP` on step 1,
  `HARDWARE TOUR` on step 5. *Decision: the tour stops being the front door. Land on the diagnosis;
  offer the tour as a card the user can choose.*
- **Corner-scatter wastes the middle.** Home and Lab both push four gauges into the four corners of a
  large frame with the hologram floating in the centre, leaving ~300px of empty space on each side.
  It reads as an aircraft HUD and costs the most valuable real estate on the screen.
- **Visual weight is inverted on the tour's controls** — `Back` is a filled button, `Next` (the
  primary) is outline-only.
- **`MEASURED` is stamped four times per screen.** It is the brand's best idea, expressed as noise.
  *Decision: one legend, not one badge per number.*
- **Six stations, smallest type on the screen.** Lab's `OPTIMIZE / DIAGNOSTICS / BENCHMARK / LATENCY
  / TUNING / CRASH & FREEZE` bar carries the room's actual functions at ~11px letterspaced caps, and
  `CRASH & FREEZE` — the one a crashed user needs — is styled dimmest of the six.
- **Three of Home's five intake rows point at the Lab.** The 4-room nav does not match where the work
  actually is.
- **The same event repeats three times** in Blackbook ("Compy applied Enable Windows Game Mode",
  twice rolled back). It reads as a malfunction. *Decision: group repeats — "applied 3×, currently
  on".*
- **A raw OS `<select>`** ("Choose a change…") sits inside an otherwise fully custom UI.
- **Build identifiers in consumer chrome** — `0.9.13` beside the wordmark and `3155c7a0 · release` in
  the topbar. A git short hash is dev furniture. *Decision: move it into Settings / the About panel.*
- The nav rail's shortcut digits are styled as pills at the right edge of each row — the exact
  position and shape of an unread-count badge. *Decision: strengthen the keycap read, or show the
  digits only while a modifier is held.*

## 5. What is genuinely good (do not "fix" these)

- Home's **"WHAT ARE YOU HERE TO DO?"** band is the best navigation idea in the product: it routes by
  the user's problem instead of by feature name. It should be the front door, not the third element.
- The **Blackbook record** — typed badges, timestamps, plain-English sentences, `undo returns to Off`
  — is the clearest surface in the app.
- **`still on` / `rolled back` on every change**, and the footer's outbound + reversibility lines, are
  the trust engine working exactly as designed.

## Order of work

1. ~~Contrast token + rail accessible names~~ — **done this train, guarded.**
2. Type scale + 11px floor. Highest remaining accessibility value; mechanical.
3. Home hierarchy: verdict as H1, drop the topbar taglines.
4. Colour: rooms release the status hues.
5. First-run: diagnosis first, tour by choice.
6. Copy pass: the jargon list in §3.

Items 2–6 are logged in `docs/UI_VISION_BACKLOG.md`.
