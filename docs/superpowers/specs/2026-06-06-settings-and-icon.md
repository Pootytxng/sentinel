# Settings/Appearance surface + the pulse-C app icon (fifth live pass)

*2026-06-06, Cowork. Two nav-independent pieces while the six-home decision is pending: a proper
Settings surface (consolidating the scattered controls per the approved Appearance mock) and
Compy's real face — replacing the stock Tauri icon with the pulse-C. Kernel:
`2026-06-05-compy-design-system.md`.*

---

## Part A — Settings surface

### A0. Honesty + control rules
- Appearance controls change pixels only — one line of copy on the surface says so:
  "Make it yours. None of this touches what Compy measures."
- **Step-aside split rule:** the reduced-motion and hidden-document freezes are UNCONDITIONAL
  (a11y/efficiency, not preferences). The freeze-during-game behavior is a user preference,
  **default ON**, toggleable — honest subtext: "Freezes the backdrop while a game runs. Compy
  never steals your frames." (Mandatory-by-default, not paternalistic-forever.)

### A1. Placement
New `src/surfaces/Settings.tsx` behind `compy_settings_v2` (default ON in dev), reachable from the
rail gear (bottom). Consolidates controls currently scattered in footers; the footer toggles stay
until this surface is at parity (per the surface-default governance rule), then footers can thin.

### A2. Sections (per the approved Appearance mock)
1. **Appearance:** theme picker — Velocity / Nova / Ember swatch cards (live recolor; persists
   `compy_theme`) · ambiance segmented Off / Calm / Full (persists `compy_ambiance`) · a small
   LIVE PREVIEW tile (signal ring + backdrop) reflecting both choices in real time.
2. **Behavior:** "Step aside when I play" toggle (default ON, per A0) · "Respect reduced motion"
   row — display-only status ("Follows your Windows setting"), not a toggle (we never override OS
   a11y).
3. **Preview flags:** the `compy_*_v2` toggles (home / fix / learn / arc / settings itself)
   grouped as "New look (preview)" rows — one place to flip any surface old↔new.
4. **About:** app name + version (from the existing version source) · one-line privacy statement
   ("Fully local. No account, no telemetry, nothing leaves your PC.") · link affordances only to
   the existing allowlisted ms-settings deep links if already present elsewhere — NO new external
   links this pass.

### A3. Constraints
Frontend-only, localStorage-only state, tokens-only, Calm/static ambiance on this surface,
reduced-motion honored, no new capabilities/network/Rust. Additive + flagged + revertable.

---

## Part B — The pulse-C app icon (Compy's face)

### B1. Source of truth
Master SVG committed at `docs/superpowers/specs/assets/pulse-c-icon-master.svg` (1024 viewBox:
obsidian tile, teal ring-C with a soft under-stroke, accent pulse). Geometry is the approved mark.

### B2. Pipeline
1. Render the SVG to a 1024×1024 PNG (any local rasterizer — e.g. resvg/sharp/Inkscape; no
   network fetches).
2. Run Tauri's icon generator (`npm run tauri icon <png>` / `cargo tauri icon`) to regenerate
   `src-tauri/icons/*` (icon.ico, icns, the PNG set) — replacing the stock Tauri set.
3. Also replace `public/tauri.svg` usage if it surfaces anywhere user-visible in-app (audit and
   swap to the pulse-C or remove).
4. Rebuild; verify the exe/taskbar/Start-menu icon shows the pulse-C; window/titlebar icon too.

### B3. Known v1 acceptance + follow-up
Auto-downscaled small sizes (16–24px) will blur the pulse line — ACCEPTED for v1. Follow-up
(polish, not now): hand-tuned small .ico layers using the simplified C-only mark (pulse dropped),
per the approved icon mock's graceful degradation.

### B4. Constraints
Asset-only change + the icon regeneration; no identifier/config changes beyond the icon files;
commit the regenerated icons; note in the report that the NEXT packaged build (installer) will
carry the new face — the installer itself is not rebuilt in this pass unless the owner asks.

---

## Acceptance
- [ ] Settings renders behind `compy_settings_v2`; all sections live; theme/ambiance changes apply
      app-wide instantly + persist; preview-flag rows flip surfaces old↔new.
- [ ] Step-aside toggle works (default ON); reduced-motion row is status-only.
- [ ] Dev-build window + taskbar show the pulse-C icon; stock Tauri icon gone from
      `src-tauri/icons/`.
- [ ] Tokens-only · frontend/asset-only · tests green (cargo untouched expected; if `tauri icon`
      touches config beyond icon paths, stop and flag).
- [ ] `npm run tauri dev` live for owner sign-off.
