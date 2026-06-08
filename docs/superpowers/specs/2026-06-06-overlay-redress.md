# In-game Overlay — Instrument re-dress spec (sixth live pass)

*2026-06-06, Cowork. Re-dresses the existing overlay window (230×150, transparent, always-on-top,
borderless/windowed games only, never exclusive fullscreen, no injection) per the approved overlay
mock. THE INVERTED RULE: in-game, the game is the hero — the overlay refuses every effect the rest
of Instrument enjoys. No glow, no glass blur, no ambient, near-zero cost.*

---

## 0. Laws for this surface

- **Glanceable in ~200ms mid-fight:** mono numerals, high contrast, nothing decorative.
- **Weightless:** no canvas animation beyond data updates at the EXISTING cadence; no new polling,
  no new IPC — render only what the current overlay already receives.
- **Honest:** values are the real capture stream; "1%" labeled; temp uses semantic amber only when
  genuinely hot; nothing invented, nothing smoothed-to-look-better.
- Reduced-motion: data updates continue (data, not decoration); any transitions removed.

## 1. Flag + reversibility

`compy_overlay_v2` (default ON in dev); classic overlay renders when off. Frontend-only, additive,
tokens where applicable (overlay backing may use fixed rgba for contrast over arbitrary game
footage — document any deliberate token exceptions in the report).

## 2. Densities (new setting: `compy_overlay_density`, default "standard")

- **Minimal:** FPS numeral + tiny "fps" unit. Nothing else.
- **Standard:** + one mono row: `1% low <val> · <temp>°C · gpu <pct>%`. (Label it **"1% low"**,
  never a bare "1%" — owner feedback: the bare percent reads as a riddle, not a metric.)
- **Full:** + **`cpu <pct>%`** in the metric row (the overlay already fetches CPU usage via
  `get_cpu_sensors` — zero new IPC; CPU% only, never CPU temp — no kernel driver) + a small
  frametime line (~120×20, last N samples from the existing stream; spikes visible — that's the
  point). Pure SVG/canvas polyline updated on the existing tick. Full row reads:
  `1% low <val> · <temp>°C · cpu <pct>% · gpu <pct>%`.
- Density picker lives in Settings (Behavior section) and/or the monitoring controls — owner's
  pick on placement, default Settings. Window size stays as configured; lower densities simply
  render less (no window resize logic this pass).
- Existing corner setting (`compy_overlay_corner`) carries over untouched; click-through stays.

## 3. Visual

Backing: near-opaque dark pill (rgba(5,8,10,~0.62)), 0.5px subtle border, 9px radius. FPS numeral
mono ~22px; accent used ONLY for the tiny unit label and the frametime line. Amber on the 1% low
when it's meaningfully below avg (reuse an existing honest threshold if one exists; otherwise
neutral — do NOT invent a new judgment heuristic in the overlay).

## 4. Acceptance

- [ ] Overlay v2 renders behind the flag; classic reachable; start/stop behavior identical.
- [ ] Three densities render correctly inside the existing window bounds; setting persists.
- [ ] Zero new IPC/polling — render-only change verified; corner + click-through untouched.
- [ ] No glow/blur/ambient anywhere on this surface; reduced-motion clean.
- [ ] Live check over a real borderless game: legibility at a glance, spikes visible in Full.
