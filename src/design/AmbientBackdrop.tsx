import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type Ambiance, readStepAsideGame } from "./theme";
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
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [freezeOnGame, setFreezeOnGame] = useState<boolean>(readStepAsideGame);

  useEffect(() => {
    const on = () => setFreezeOnGame(readStepAsideGame());
    window.addEventListener("compy:stepaside-changed", on);
    return () => window.removeEventListener("compy:stepaside-changed", on);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  useEffect(() => {
    const on = () => setHidden(document.visibilityState === "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // Active game / FPS capture — reuse the existing monitoring state, polled lightly.
  useEffect(() => {
    if (ambiance === "off") return;
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
  }, [ambiance]);

  if (ambiance === "off") return null;
  // Step aside while a game is presenting (user pref) — the aurora gets out of the way entirely.
  if (gameActive && freezeOnGame) return null;

  // Drift only when it's full ambiance, visible, and motion is allowed; calm/reduced/hidden = static.
  const drift = ambiance === "full" && !reduced && !hidden;

  return (
    <>
      <div className={`ix-aurora ix-aurora-a ${drift ? "ix-aurora-drift-a" : ""}`} aria-hidden="true" />
      <div className={`ix-aurora ix-aurora-b ${drift ? "ix-aurora-drift-b" : ""}`} aria-hidden="true" />
      <div className="ix-vignette" aria-hidden="true" />
    </>
  );
}
