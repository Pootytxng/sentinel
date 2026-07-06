import "./hud-rooms.css";

// HudMasthead — the system-console eyebrow the four rooms wear under the Instrument-HUD flag
// (the approved Home pilot's language rolled out; owner verdict 2026-07-06 "all looks good").
// Presentation only, same honesty contract as Home's masthead: the LED renders ONLY when the
// room computes a real live state (scan = work actually running · warn = measured attention ·
// ok = measured clear) — a room with no such state renders no LED rather than fabricate one.
// The dateline is the date this screen is being read, never a fabricated "last updated".
export type HudLedState = "ok" | "warn" | "scan";

export function HudMasthead({ label, led }: { label: string; led?: HudLedState | null }) {
  const dateline = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <span className="hud-masthead-eyebrow">
      {led && <span className={`hud-led hud-led-${led}`} aria-hidden="true" />}
      {label} <span className="hud-eyebrow-sep">·</span>{" "}
      <span className="hud-mono">{dateline}</span>
    </span>
  );
}
