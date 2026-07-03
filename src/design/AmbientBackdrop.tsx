import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type Ambiance, readStepAsideGame } from "./theme";
import { useReducedMotion } from "./use-motion";
import "./AmbientBackdrop.css";

// Whisper aurora (halfway-home §2: walls neutral, motion as punctuation). The old hyperspeed streaks
// are RETIRED here — streaks are now reserved for scan/win moments. This is at most ONE soft teal+blue
// radial pair (≤8% alpha, heavy blur, slow drift), used only on Home. Dependency-free CSS; the colors
// come from the theme's streak tokens, so it follows the active theme automatically.
//
// THE COURTESY / STEP-ASIDE RULE (mandatory): the aurora steps aside (hides) when an FPS capture /
// game session is active (user pref, default ON), and stops drifting under prefers-reduced-motion or
// when the document is hidden (a11y/efficiency, unconditional).

export function AmbientBackdrop({ ambiance }: { ambiance: Ambiance; themeKey?: string }) {
  const reduced = useReducedMotion();
  const [hidden, setHidden] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [freezeOnGame, setFreezeOnGame] = useState<boolean>(readStepAsideGame);

  useEffect(() => {
    const on = () => setFreezeOnGame(readStepAsideGame());
    window.addEventListener("compy:stepaside-changed", on);
    return () => window.removeEventListener("compy:stepaside-changed", on);
  }, []);

  useEffect(() => {
    const on = () => setHidden(document.visibilityState === "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // Active game / FPS capture — reuse the existing monitoring state, polled lightly. Poll ONLY when
  // the user actually wants the aurora to step aside on a game: gameActive feeds nothing else, so with
  // step-aside off this would be a recurring IPC every 1.5s whose result is never read. (When off,
  // gameActive stays false and the step-aside guard below never fires — same render, zero polling.)
  useEffect(() => {
    if (ambiance === "off" || !freezeOnGame) return;
    let cancelled = false;
    const poll = () => {
      try {
        invoke<{ active: boolean }>("get_fps_status")
          .then((s) => !cancelled && setGameActive(!!s?.active))
          .catch(() => {});
      } catch {
        /* not running under Tauri (e.g. tests) — treat as not active */
      }
    };
    poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ambiance, freezeOnGame]);

  if (ambiance === "off") return null;
  // Step aside while a game is presenting (user pref) — the aurora gets out of the way entirely.
  if (gameActive && freezeOnGame) return null;

  // Drift when visible and motion is allowed; reduced/hidden = static (unconditional
  // a11y/efficiency freezes). Calm ambiance (owner §8b "barely-there") drifts much slower and
  // fainter than full.
  const drift = (ambiance === "full" || ambiance === "calm") && !reduced && !hidden;
  const slow = drift && ambiance === "calm" ? "ix-aurora-slow" : "";

  return (
    <>
      <div
        className={`ix-aurora ix-aurora-a ${drift ? "ix-aurora-drift-a" : ""} ${slow}`}
        aria-hidden="true"
      />
      <div
        className={`ix-aurora ix-aurora-b ${drift ? "ix-aurora-drift-b" : ""} ${slow}`}
        aria-hidden="true"
      />
      <div className="ix-vignette" aria-hidden="true" />
    </>
  );
}
