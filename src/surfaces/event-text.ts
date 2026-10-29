import type { TFunction } from "i18next";
import type { IntelEvent } from "../types";
import { displayModeLabel } from "../data/display-mode";

// P6-changed-f1: one place that words a timeline event in the viewer's language. The backend sends
// the event's facts as data (`parts`, intelligence.rs `EventParts`) beside its English `summary`;
// this composes the line from a translated template, keeping every value (driver versions, plan
// names, change titles, game names) exactly as recorded. No parts, or a kind this build doesn't
// know: the English `summary`, as before. Change titles stay the recorded rec title: the app has
// no localised rec-title table today (Fix.tsx's RecTitle and friendly-labels.ts are English too).
export function eventText(e: IntelEvent, t: TFunction): string {
  const p = e.parts;
  if (!p) return e.summary;
  switch (p.kind) {
    case "applied":
      return t(e.since_rolled_back ? "common.timelineEvent.appliedRolledBack" : "common.timelineEvent.applied", {
        title: p.title,
      });
    case "rolled-back":
      return t("common.timelineEvent.rolledBack", { title: p.title });
    case "gpu-driver":
      return t("common.timelineEvent.gpuDriver", { from: p.from, to: p.to });
    case "windows-build":
      return t("common.timelineEvent.windowsBuild", { from: p.from, to: p.to });
    case "power-plan":
      return t("common.timelineEvent.powerPlan", { from: p.from, to: p.to });
    case "hardware": {
      const part = (c: (typeof p.changes)[number]) => {
        if (c.part === "gpu") return t("common.timelineEvent.hardwarePart.gpu", { from: c.from, to: c.to });
        if (c.part === "ram") return t("common.timelineEvent.hardwarePart.ram", { from: c.from, to: c.to });
        if (c.part === "display")
          return t("common.timelineEvent.hardwarePart.display", {
            from: displayModeLabel(c.from, t) ?? c.from,
            to: displayModeLabel(c.to, t) ?? c.to,
          });
        return null;
      };
      const changes = p.changes.map(part);
      if (changes.length === 0 || changes.some((c) => c === null)) return e.summary;
      return t("common.timelineEvent.hardware", { changes: changes.join(" · ") });
    }
    case "drift":
      return t("common.timelineEvent.drift", { label: p.label });
    case "session": {
      const minutes = Math.floor(p.duration_secs / 60);
      const duration =
        minutes === 0
          ? t("common.timelineEvent.durationSeconds", { seconds: p.duration_secs })
          : t("common.timelineEvent.durationMinutes", { minutes });
      return p.fps
        ? t("common.timelineEvent.session", {
            game: p.game,
            duration,
            // Already rounded by the backend, exactly as its summary rounds them.
            avg: p.fps[0],
            low: p.fps[1],
          })
        : t("common.timelineEvent.sessionUnmeasured", { game: p.game, duration });
    }
    case "benchmark-baseline":
      return t("common.timelineEvent.benchmarkBaseline");
    default:
      return e.summary;
  }
}
