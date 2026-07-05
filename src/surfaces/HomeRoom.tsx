import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { useEditorialFlag } from "../design/use-editorial";
import { HomeV2 } from "./HomeV2";
import { HomeEditorial } from "./HomeEditorial";

// HomeRoom — the compy_editorial switch for the Home room (spec
// 2026-07-05-ui-deslop-organic-directive; P-series preview contract). Flag off (absent or
// "0"), HomeV2 renders byte-identical — pinned by home-editorial-flag.test.tsx. Flag on,
// the Editorial-Instrument pilot renders over the SAME props (presentation only). The
// Settings toggle fires compy:editorial-changed so the swap is live, no reload.

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
  const editorial = useEditorialFlag();
  return editorial ? <HomeEditorial {...props} /> : <HomeV2 {...props} />;
}
