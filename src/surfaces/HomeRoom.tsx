import type {
  AppliedChange,
  GameReadiness,
  Priorities,
  Recommendation,
  SessionSummary,
} from "../types";
import type { HardwareInfo } from "../App";
import { useHudFlag, useHomeConsoleFlag } from "../design/use-hud";
import { HomeV2 } from "./HomeV2";
import { HomeHud } from "./HomeHud";
import { HomeConsole } from "./HomeConsole";

// HomeRoom — the presentation switch for the Home room. Highest priority: the Home console
// cold-open (plan 2026-07-10-console-hud-phase2-home, compy_home_console DEFAULT OFF — its
// Settings toggle fires compy:home-console-changed). Console off: the Instrument-HUD switch
// (spec 2026-07-05-ui-deslop-organic-directive, CORRECTED direction; P-series preview
// contract) — hud flag off ("0" failsafe), HomeV2 renders byte-identical. All three branches
// render over the SAME props (presentation only); pins: home-console-flag.test.tsx +
// home-hud-flag.test.tsx.

type Props = {
  hw: HardwareInfo;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  changes: AppliedChange[];
  onRunCheck: () => void;
  onSeeInFix: () => void;
  /** The room the "See in …" limiter buttons land in — "Lab" under the proving-ground rail
   *  (no standalone Optimize tab), "Optimize" on the classic compy_lab_ground="0" failsafe. */
  fixRoomLabel?: string;
  /** Console-only (compy_home_console): rail navigation for the Dock — App's navHome. */
  onNavigate?: (key: string) => void;
  /** Console-only: the rooms the rail actually shows (railFor minus home) — honest doors. */
  rooms?: { key: string; name: string }[];
  /** Console intake band only (compy_home_intake, BACKLOG:916): the live recs catalog the
   *  one-tap fast path derives its safe stack from (null = loading, undefined = not wired). */
  recs?: Recommendation[] | null;
  /** Console intake band only: the allowlist gate for one-click-appliable rec ids. */
  isAppliable?: (recId: string) => boolean;
  /** Console intake band only: the audited one-UAC batch-apply primitive (App's applyBatch). */
  onApplyBatch?: (
    recIds: string[],
  ) => Promise<{ applied: number; skipped: { title: string; reason: string }[] }>;
};

export function HomeRoom(props: Props) {
  const homeConsole = useHomeConsoleFlag();
  const hud = useHudFlag();
  if (homeConsole) return <HomeConsole {...props} />;
  return hud ? <HomeHud {...props} /> : <HomeV2 {...props} />;
}
