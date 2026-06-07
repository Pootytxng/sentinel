import { useEffect, useState } from "react";
import "./KonamiWhisper.css";

// The Konami code (shadow realm, Six Laws): the canonical gamer handshake, entered anywhere → the
// wordmark's pulse redraws (a "compy:heartbeat" event the Wordmark listens for) + one quiet line that
// fades on its own. Nothing changes, nothing unlocks (no economy). Self-contained + revertable: delete
// this file + its one <KonamiWhisper/> mount. Not interactive (no knob needed); just a whisper.
const KONAMI = [
  "arrowup", "arrowup", "arrowdown", "arrowdown",
  "arrowleft", "arrowright", "arrowleft", "arrowright",
  "b", "a",
];

export function KonamiWhisper() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let seq: string[] = [];
    let hideTimer = 0;
    const onKey = (e: KeyboardEvent) => {
      seq = [...seq, e.key.toLowerCase()].slice(-KONAMI.length);
      if (seq.length === KONAMI.length && seq.every((k, i) => k === KONAMI[i])) {
        seq = [];
        window.dispatchEvent(new Event("compy:heartbeat")); // every wordmark replays its pulse
        setShown(true);
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => setShown(false), 4200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!shown) return null;
  return (
    <div className="cmp-konami-whisper" role="status">
      You remembered. Compy remembers too.
    </div>
  );
}
