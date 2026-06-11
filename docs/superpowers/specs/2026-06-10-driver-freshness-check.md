# Spec — Driver freshness advisory (read-only, honest, no network)

**Date:** 2026-06-10 · **Lane:** Cowork-specced → CC builds · **Class:** frontend-only, reversible
**Source:** owner feedback #5 — "expand catalog cautiously with reversible diagnostics (driver-update)."

## Why

The GPU driver date/age is already detected (`driver_age_days`, `driver_date`) and flows to
the frontend, but it's only shown as a raw number in the hardware grid. Surface it as a
gentle **advisory** in Check: when the driver is old, nudge the user to check their vendor's
page. Fills the "reversible diagnostics" ask without touching the frozen tweak catalog.

## Hard lines (do not cross)

- **No network, no version claim.** We CANNOT know the latest driver version locally (remote
  fetch is gated off + local-only beta promise). NEVER say "out of date" / "newer version
  X.Y available." Only ever: *"this driver is N days old — newer ones may be out, worth a
  check."* Age is a fact; "newer exists" is a maybe, phrased as a maybe (honest-measurement law).
- **Frontend-only.** Reads the existing `HardwareInfo.gpus[].driver_age_days` / `driver_date`
  prop already in `App`. ZERO new IPC, backend, cargo, or capability/allowlist change.
- **No auto-open.** Show the vendor support URL as **copyable text**, NOT a launch button —
  opening external https would need an opener-allowlist (capability) change, which is
  owner-gated. v1 = copyable URL. (A future "Open page" button can ride an approved allowlist.)
- **Reversible/read-only.** Changes nothing on the machine. Doorknob law: the copy control is
  a real button (copy-to-clipboard); the advisory card itself is static.

## Behavior

- Add a **"Driver freshness"** advisory to Check (a readiness-style row/card, matching the
  existing `checks` visual language).
- Threshold: `driver_age_days == null` → "Driver date unreadable — skip" (neutral, no alarm).
  `<= 90` → quiet pass ("Driver is recent — N days old."). `> 90` → advisory ("Your <vendor>
  driver is N days old. Newer ones may be available — worth checking your vendor's page.").
- Vendor support URL (copyable, stable roots — author may trim): AMD `https://www.amd.com/en/support`,
  NVIDIA `https://www.nvidia.com/Download/index.aspx`, Intel `https://www.intel.com/content/www/us/en/download-center/home.html`.
  Unknown vendor → omit the URL, keep the age advisory.
- Plain-English, per-rig framing ("your <vendor> driver"), consistent with the Fix/Lab reword tone.

## Verification

`tsc` + `vite build` clean · `npm test` green (add a Check render assert: >90-day mock shows
the advisory + URL; null-age mock shows the neutral skip, no alarm) · grep confirms no
"out of date"/version-number language · no new `invoke()` / capability edit · cargo untouched · /check.

## Owner eyeball (visual change)

After commit, CC runs `npm run tauri dev` so the owner can confirm the advisory reads right
on the real rig (RX 9070 XT — driver ~`2026-05-12`, so expect the quiet "recent" pass, not
the >90-day nudge; to see the nudge, temporarily lower the threshold or trust the unit test).
