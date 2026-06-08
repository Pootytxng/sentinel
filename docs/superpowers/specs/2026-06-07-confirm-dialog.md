# Themed Confirm Dialog — kill the native "tauri.localhost says" popup

*2026-06-07, Cowork, owner-flagged from a live screenshot. The rollback/apply confirmation uses
the webview's native `window.confirm()` → renders the unbranded OS dialog titled "tauri.localhost
says." It exposes the framework, breaks the Instrument language entirely, and is a doorknob-law
failure (a generic box where a Compy surface should be). Cosmetic but important — it's the one
place the brand drops its mask.*

---

## Scope — replace ALL native confirms (5 sites, grep-verified)

`src/App.tsx:971` (apply), `src/App.tsx:1020` (rollback), `src/surfaces/Check.tsx:57`,
`src/surfaces/FirstCheck.tsx:44`, `src/surfaces/SessionDebrief.tsx:348`. Also sweep for any
`window.alert()` and route those through a themed info variant. No native `confirm`/`alert`
may remain in `src/`.

## The component

- One shared **`ConfirmDialog`** reusing the EXISTING modal styling (`.modal` / `.modal-backdrop`
  from ReportModal, or the §4 apply-all sheet's treatment — do NOT invent a new visual; match
  what's already shipped). Obsidian glass, tokens-only.
- Props: title (plain-English question), optional one-line detail, confirm label, cancel label,
  variant (default / destructive-tinted if ever needed), onConfirm/onCancel.
- **Buttons obey the ink law:** confirm = accent fill with `--ix-accent-ink` label (never white);
  cancel = ghost/outline. Both are `.cmp-door`-grade obvious (this is a doorknob surface).
- **Honesty in the copy:** state the outcome, not just the action — the rollback row already
  knows the destination ("rolls back to Off"), so the dialog says *"Roll back Windows Game Mode?
  It'll return to Off."* Reuse the data the row already has; never a bare "are you sure?".

## Behavior

- Esc = cancel, Enter = confirm, focus traps in the dialog, focus returns to the trigger on
  close; backdrop click = cancel. Focus ring on both buttons (existing tokens).
- Reduced-motion: no scale/slide; instant show/hide.
- Replaces `window.confirm`'s synchronous boolean with a promise/state pattern (the apply &
  rollback handlers become async-gated on the dialog result) — behavior identical, just themed.

## Design note (record, default = keep confirms)

Rollback is the reversible/undo direction, so a confirm there is arguably optional — but apply
(system mutation, sometimes elevated) warrants one. DEFAULT this pass: keep all five confirms,
just themed. If the owner later wants rollback to skip the modal (since it's itself the undo),
that's a one-line follow-up — not this pass.

## Acceptance

- [ ] Zero native `confirm`/`alert` in `src/` (grep-verified); no "tauri.localhost says" box
      ever appears.
- [ ] All 5 sites use the shared themed ConfirmDialog; visual matches existing modals.
- [ ] Ink-law buttons; Esc/Enter/focus-trap/backdrop-cancel; reduced-motion clean.
- [ ] Copy states the outcome (destination state), not a bare confirmation.
- [ ] Tests/guards green; frontend-only; zero new IPC; copy locks untouched.
