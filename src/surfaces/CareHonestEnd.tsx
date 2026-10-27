import { useState } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { SupportEvidence } from "./SupportEvidence";
import type { HonestEnd } from "./care-honest-end";
import { Depth } from "../design/Depth";
import "./CareHonestEnd.css";

// P6-unknown: the honest end of the Care view when Compy can't name a next step. It takes the
// "Your next step" slot (honestEndFor returns null whenever there is a step). Read-only.
export function CareHonestEnd({ end }: { end: HonestEnd | null }) {
  const { t } = useTranslation();
  if (!end) return null;
  // P7-depth (Constitution §13): ANSWER = there is no step yet, and what would add evidence (that IS
  // the recommendation); EXPLANATION = why Compy won't name one. No receipt: the gaps are the whole
  // recorded state this component holds, and a receipt that restates the answer in code names is
  // not evidence (review of this slice, SHOULD-FIX 4).
  return (
    <section className="bb-honest bb-honest-unknown" aria-label={t("gaming.blackBox.honestEnd.unknownTitle")}>
      <Depth
        testId="bb-honest-depth"
        answer={
          <>
            <p className="bb-honest-title">{t("gaming.blackBox.honestEnd.unknownTitle")}</p>
            <p className="bb-honest-line">{t("gaming.blackBox.honestEnd.unknownLine")}</p>
            <span className="bb-honest-sublabel">{t("gaming.blackBox.honestEnd.addLabel")}</span>
            <ul className="bb-honest-gaps">
              {end.gaps.map((g) => (
                <li key={g.kind}>
                  {g.kind === "admin"
                    ? t("gaming.blackBox.honestEnd.gapAdmin")
                    : g.kind === "rescan"
                      ? t("gaming.blackBox.honestEnd.gapRescan")
                      : g.kind === "repeat"
                        ? t("gaming.blackBox.honestEnd.gapRepeat")
                        : t("gaming.blackBox.honestEnd.gapSession", { game: g.game })}
                </li>
              ))}
            </ul>
          </>
        }
        whyLabel={t("gaming.blackBox.honestEnd.whyLabel")}
        explanation={<p className="bb-honest-line bb-honest-why">{t("gaming.blackBox.honestEnd.whyLine")}</p>}
      />
    </section>
  );
}

// "Beyond Compy": the EXISTING local support record (SupportEvidence, the same panel Settings
// shows), one tap away. Nothing new leaves the PC: that panel previews, then saves a file the user
// attaches themselves; Compy has nothing to send it with.
export function CareSupportExport() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="bb-honest-export">
      <p className="bb-honest-line">{t("gaming.blackBox.honestEnd.exportLine")}</p>
      {open ? (
        // No Clear here: it permanently deletes the record, right when the user is about to share it.
        <SupportEvidence allowClear={false} />
      ) : (
        <button className="set-action bb-honest-export-open" onClick={() => setOpen(true)}>
          {t("gaming.blackBox.honestEnd.exportOpen")}
        </button>
      )}
    </div>
  );
}
