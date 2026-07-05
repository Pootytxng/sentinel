import { useEffect, useState } from "react";
import { readHud } from "./theme";

// The Instrument-HUD preview flag as live React state (spec 2026-07-05-ui-deslop-organic-
// directive, CORRECTED direction). The Home pilot uses this to swap presentation the moment
// the Settings preview toggle flips — no reload. Flag off, every consumer renders its classic
// tree byte-identical (P-series contract, test-pinned).
export function useHudFlag(): boolean {
  const [on, setOn] = useState(readHud);
  useEffect(() => {
    const sync = () => setOn(readHud());
    window.addEventListener("compy:hud-changed", sync);
    return () => window.removeEventListener("compy:hud-changed", sync);
  }, []);
  return on;
}
