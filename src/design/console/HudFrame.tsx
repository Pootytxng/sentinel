import { useEffect, useState } from "react";
import "./hud-frame.css";

// App-wide viewport HUD frame (compy_hud_frame, console-HUD direction §viewport frame,
// 2026-07-15). Pure chrome: four corner brackets + one bottom-right mono readout of REAL
// values only — the rig probe and the system clock, the two values no other chrome shows
// (the ledger count lives in the rail foot and the build stamp in the topbar; repeating
// them here would put each on screen twice — self-review 2026-07-15). Honesty rail: a
// segment whose source didn't resolve (hw probe pending) is OMITTED, never faked.
// aria-hidden + pointer-events: none — ambience for sighted pointer users, invisible
// to everyone else.

function clockNow(): string {
  return new Date().toLocaleTimeString([], { hour12: false });
}

export function HudFrame({ rig }: { rig: string | null }) {
  const [clock, setClock] = useState(clockNow);
  useEffect(() => {
    const id = window.setInterval(() => setClock(clockNow()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const segments = [rig, clock].filter(Boolean);

  return (
    <div className="hud-frame" aria-hidden="true">
      <span className="hud-frame-c tl" />
      <span className="hud-frame-c tr" />
      <span className="hud-frame-c bl" />
      <span className="hud-frame-c br" />
      <div className="hud-frame-readout">{segments.join(" · ")}</div>
    </div>
  );
}
