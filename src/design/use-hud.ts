import { useEffect, useState } from "react";
import {
  readHud,
  readLabGround,
  readHomeConsole,
  readMonitorConsole,
  readBlackbookConsole,
  readRoomIdentity,
} from "./theme";

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

// The Monitor console flag as live React state (plan 2026-07-10-console-hud-phase3-monitor,
// same contract: the Settings toggle fires compy:monitor-console-changed so MonitorV2
// re-branches without a reload). DEFAULT ON since 2026-07-12 — the "0" failsafe renders
// exactly today's classic tree (pinned by monitor-console-flag.test.tsx).
export function useMonitorConsoleFlag(): boolean {
  const [on, setOn] = useState(readMonitorConsole);
  useEffect(() => {
    const sync = () => setOn(readMonitorConsole());
    window.addEventListener("compy:monitor-console-changed", sync);
    return () => window.removeEventListener("compy:monitor-console-changed", sync);
  }, []);
  return on;
}

// The Blackbook console flag as live React state (plan 2026-07-12-console-hud-phase4-blackbook,
// same contract: the Settings toggle fires compy:blackbook-console-changed so BlackbookV2
// re-branches without a reload). DEFAULT OFF — the room is byte-identical to today's Learn
// library unless the key is literally "1" (pinned by blackbook-console-flag.test.tsx).
export function useBlackbookConsoleFlag(): boolean {
  const [on, setOn] = useState(readBlackbookConsole);
  useEffect(() => {
    const sync = () => setOn(readBlackbookConsole());
    window.addEventListener("compy:blackbook-console-changed", sync);
    return () => window.removeEventListener("compy:blackbook-console-changed", sync);
  }, []);
  return on;
}

// The per-room identity accent flag as live React state (owner 2026-07-12, see room-identity.ts;
// same contract: the Settings toggle fires compy:room-identity-changed so consumers re-read without
// a reload). DEFAULT OFF — SessionStack uses this to decide whether its sparkline reads the
// room-scoped accent (on) or documentElement (off, byte-identical to today).
export function useRoomIdentityFlag(): boolean {
  const [on, setOn] = useState(readRoomIdentity);
  useEffect(() => {
    const sync = () => setOn(readRoomIdentity());
    window.addEventListener("compy:room-identity-changed", sync);
    return () => window.removeEventListener("compy:room-identity-changed", sync);
  }, []);
  return on;
}
