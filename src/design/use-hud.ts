import { useEffect, useState } from "react";
import {
  readHud,
  readHomeConsole,
  readHomeIntake,
  readMonitorConsole,
  readBlackbookConsole,
  readGamingConsole,
  readRoomIdentity,
  readHudFrame,
  readIntelligence,
  readCommandPalette,
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

// `useLabGroundFlag` was RETIRED in the 2026-08-06 generation prune with `compy_lab_ground` itself:
// the proving-ground rail is the only rail, so RoomShell's forward door passes ground literally.

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

// The Home intake band flag as live React state (BACKLOG:916 — the pre-room intent router; same
// contract: the Settings toggle fires compy:home-intake-changed so HomeConsole shows/hides the
// intake band without a reload). DEFAULT ON since 2026-08-11 (the graduation that shipped in #97) —
// only an explicit "0" hides the band, per the graduated-flag convention.
export function useHomeIntakeFlag(): boolean {
  const [on, setOn] = useState(readHomeIntake);
  useEffect(() => {
    const sync = () => setOn(readHomeIntake());
    window.addEventListener("compy:home-intake-changed", sync);
    return () => window.removeEventListener("compy:home-intake-changed", sync);
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
// same contract: a flag change fires compy:blackbook-console-changed so BlackbookV2 re-branches
// without a reload). DEFAULT ON since 2026-07-13 (owner-approved) — only an explicit "0"
// (devtools failsafe) restores the classic Learn library (pinned by blackbook-console-flag.test.tsx).
export function useBlackbookConsoleFlag(): boolean {
  const [on, setOn] = useState(readBlackbookConsole);
  useEffect(() => {
    const sync = () => setOn(readBlackbookConsole());
    window.addEventListener("compy:blackbook-console-changed", sync);
    return () => window.removeEventListener("compy:blackbook-console-changed", sync);
  }, []);
  return on;
}

// The Gaming Mode arm/engage console flag as live React state (console-HUD direction §Gaming
// Mode, 2026-07-15; same contract: a flag change fires compy:gaming-console-changed so GamingMode
// re-branches without a reload). DEFAULT ON per the graduated-flag convention — only an explicit
// "0" (devtools failsafe) restores the classic card (pinned by gaming-console-flag.test.tsx).
export function useGamingConsoleFlag(): boolean {
  const [on, setOn] = useState(readGamingConsole);
  useEffect(() => {
    const sync = () => setOn(readGamingConsole());
    window.addEventListener("compy:gaming-console-changed", sync);
    return () => window.removeEventListener("compy:gaming-console-changed", sync);
  }, []);
  return on;
}

// The app-wide viewport HUD frame flag as live React state (console-HUD direction §viewport frame,
// 2026-07-15; same contract: a flag change fires compy:hud-frame-changed so ShellV2 and the
// stage-scoped ReticleCursor instances re-branch without a reload). DEFAULT ON per the graduated-flag
// convention — only an explicit "0" (devtools failsafe) restores the frameless shell and hands the
// reticle back to the stage scopes (pinned by hud-frame-flag.test.tsx).
export function useHudFrameFlag(): boolean {
  const [on, setOn] = useState(readHudFrame);
  useEffect(() => {
    const sync = () => setOn(readHudFrame());
    window.addEventListener("compy:hud-frame-changed", sync);
    return () => window.removeEventListener("compy:hud-frame-changed", sync);
  }, []);
  return on;
}

// The per-room identity accent flag as live React state (owner 2026-07-12, see room-identity.ts;
// same contract: a flag change fires compy:room-identity-changed so consumers re-read without
// a reload). DEFAULT ON since 2026-07-13 (owner-approved) — SessionStack uses this to decide whether
// its sparkline reads the room-scoped accent (on) or documentElement ("0" devtools failsafe).
export function useRoomIdentityFlag(): boolean {
  const [on, setOn] = useState(readRoomIdentity);
  useEffect(() => {
    const sync = () => setOn(readRoomIdentity());
    window.addEventListener("compy:room-identity-changed", sync);
    return () => window.removeEventListener("compy:room-identity-changed", sync);
  }, []);
  return on;
}

// The command palette flag as live React state (owner-greenlit 2026-08-11; same contract: a flag
// change fires compy:command-palette-changed so the topbar shows/hides its search box without a
// reload). DEFAULT ON — an explicit "0" (devtools failsafe) removes the box AND unbinds Ctrl+K,
// leaving the shell byte-identical to the pre-palette tree (pinned by command-palette-flag.test.tsx).
export function useCommandPaletteFlag(): boolean {
  const [on, setOn] = useState(readCommandPalette);
  useEffect(() => {
    const sync = () => setOn(readCommandPalette());
    window.addEventListener("compy:command-palette-changed", sync);
    return () => window.removeEventListener("compy:command-palette-changed", sync);
  }, []);
  return on;
}

// The Intelligence Phase 1 flag as live React state (owner directive 2026-07-16; same contract:
// a flag change fires compy:intelligence-changed so the Monitor what-changed panel, Blackbook
// observed rows and Home headline re-branch without a reload). DEFAULT ON — only an explicit "0"
// (devtools failsafe) restores the prior tree byte-identical (pinned by intelligence-flag.test.tsx).
export function useIntelligenceFlag(): boolean {
  const [on, setOn] = useState(readIntelligence);
  useEffect(() => {
    const sync = () => setOn(readIntelligence());
    window.addEventListener("compy:intelligence-changed", sync);
    return () => window.removeEventListener("compy:intelligence-changed", sync);
  }, []);
  return on;
}
