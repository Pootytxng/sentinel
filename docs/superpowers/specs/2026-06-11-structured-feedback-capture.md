# Spec — Structured feedback capture in Export (read-only, optional, local)

**Date:** 2026-06-11 · **Lane:** Cowork-specced → CC builds · **Class:** read-only/advisory, reversible
**Source:** owner feedback #4 — "gather structured beta feedback to refine copy + priorities."
Testers are live NOW; their input comes back freeform. Bake 3 optional prompts into the
Export report so every tester's reply is comparable, and rides the file they already share.

## Why backend (not clipboard-only)

Testers share the SAVED Export file (per the board), not just a clipboard paste — so the
feedback must land in the written report, not only the copy button. That's a small param on
the existing read-only `export_report`; it still only writes a report, mutates nothing.

## Hard lines (do not cross)

- **Read-only / no mutation.** Export writes a report file — unchanged. No actions.rs, no
  apply/rollback, no system change. Rides the existing Export QA surface.
- **Optional + honest.** Empty fields → NO feedback section in the report (no empty headers).
  Never pre-fill or fabricate answers. The standing privacy note ("you choose where to
  share this file") already covers it — feedback is user-typed, stays local until they share.
- **No telemetry.** Nothing auto-sends. The answers only exist in the file the user chooses
  to share. Do not add any network/upload path.
- **Frozen catalog untouched** — this is advisory capture, not a tweak.

## Backend (`export.rs`)

- `export_report` gains an optional param: `feedback: Option<String>` (Tauri command arg;
  frontend passes `null` when blank). Thread it into `build_markdown_report(... feedback: Option<&str>)`.
- `build_markdown_report`: when `feedback` is `Some(non-empty after trim)`, append a final
  section: `## Tester feedback\n\n<feedback>\n`. When `None`/empty → append nothing.
- One unit test each: feedback present → section appears; `None` → no `## Tester feedback`
  header anywhere. Keep `build_discord_block` summary unchanged (feedback is full-report only).

## Frontend (`App.tsx` Export modal)

- Add an OPTIONAL "Before you share — help us improve" mini-form ABOVE the report preview,
  3 short textareas (newcomer-plain labels):
  1. **In one sentence, what is Compy to you?**
  2. **Anything confuse you or feel off?**
  3. **What would you want next?**
- Collect into local state; format only the filled ones into a block like
  `**In one sentence:** …\n\n**Confusing/off:** …\n\n**Want next:** …`.
- The export already runs on modal open; add a **"Add my feedback & re-export"** button that
  re-invokes `export_report(feedback)` and refreshes the preview + saved file. (Or: invoke
  with feedback only when the user clicks it — don't silently re-write on every keystroke.)
- Copy buttons keep working (full report now includes the section once re-exported).

## Verification

cargo green (+2 export tests) · clippy clean · `tsc` + `vite build` clean · `npm test` green
(modal renders the 3 fields; blank submit yields no feedback section) · grep: no network/
upload added, actions.rs untouched · /check + /security (read-only, no new mutation primitive).

## Owner eyeball (visual + behavioral)

After commit, CC runs `npm run tauri dev` so the owner can open Export, type a test answer,
click "Add my feedback & re-export," and confirm the `## Tester feedback` section appears in
the preview (and the saved .md). Blank → no section.
