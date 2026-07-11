import { useEffect, useState } from "react";
import { readHud, readLabGround, readHomeConsole } from "./theme";

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

// The Lab proving-ground flag as live React state (same contract as useHudFlag: the Settings
// toggle fires compy:lab-ground-changed so consumers re-render without a reload). App owns the
// tab/rail swap; RoomShell uses this for the ground-aware forward door (home's door points at
// the Lab when the standalone Optimize room is gone from the rail).
export function useLabGroundFlag(): boolean {
  const [on, setOn] = useState(readLabGround);
  useEffect(() => {
    const sync = () => setOn(readLabGround());
    window.addEventListener("compy:lab-ground-changed", sync);
    return () => window.removeEventListener("compy:lab-ground-changed", sync);
  }, []);
  return on;
}

// The Home console cold-open flag as live React state (plan 2026-07-10-console-hud-phase2-home,
// same contract as useHudFlag: the Settings toggle fires compy:home-console-changed so HomeRoom
// re-branches without a reload). DEFAULT ON (owner-approved 2026-07-10) — "0" is the classic-Home
// failsafe, byte-identical to the pre-console tree (pinned by home-console-flag.test.tsx).
export function useHomeConsoleFlag(): boolean {
  const [on, setOn] = useState(readHomeConsole);
  useEffect(() => {
    const sync = () => setOn(readHomeConsole());
    window.addEventListener("compy:home-console-changed", sync);
    return () => window.removeEventListener("compy:home-console-changed", sync);
  }, []);
  return on;
}
