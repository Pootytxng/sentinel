import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { useHudFlag } from "../design/use-hud";
import { HomeV2 } from "./HomeV2";
import { HomeHud } from "./HomeHud";

// HomeRoom — the Instrument-HUD switch for the Home room (spec
// 2026-07-05-ui-deslop-organic-directive, CORRECTED direction; P-series preview contract).
// Flag off (absent or "0"), HomeV2 renders byte-identical — pinned by home-hud-flag.test.tsx.
// Flag on, the pure-HUD pilot renders over the SAME props (presentation only). The Settings
// toggle fires compy:hud-changed so the swap is live, no reload.

type Props = {
  hw: HardwareInfo;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  changes: AppliedChange[];
  onRunCheck: () => void;
  onSeeInFix: () => void;
};

export function HomeRoom(props: Props) {
  const hud = useHudFlag();
  return hud ? <HomeHud {...props} /> : <HomeV2 {...props} />;
}
