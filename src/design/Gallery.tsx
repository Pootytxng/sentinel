import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";
import { Card, SectionHeader, StatusPill, Stat, Gauge, Sparkline, TrustCue, EmptyState } from "./index";

export function Gallery() {
  const { t } = useTranslation();
  return (
    <div style={{ display: "grid", gap: 16, padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Card>
        <SectionHeader title={t("common.gallery.statusVocabulary")} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status="ready" /><StatusPill status="attention" />
          <StatusPill status="protected" /><StatusPill status="scanning" /><StatusPill status="unknown" />
        </div>
      </Card>
      <Card>
        <SectionHeader title={t("common.gallery.stats")} />
        <div style={{ display: "flex", gap: 24 }}>
          <Stat value="142" unit="fps" label={t("common.gallery.average")} tone="ready" />
          <Stat value="7.0" unit="ms" label={t("common.gallery.frametime")} />
          <Stat value="98" unit="fps" label={t("common.gallery.oneLowEstimate")} />
        </div>
      </Card>
      <Card>
        <SectionHeader title={t("common.gallery.instrumentCluster")} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          <Gauge value={61} display="61" unit="°C" label={t("common.gallery.gpuTemp")} colorVar="var(--ready)" />
          <Gauge value={84} display="84" unit="%" label={t("common.gallery.gpuUsage")} />
          <Gauge value={47} display="47" unit="%" label={t("common.gallery.fan")} />
          <Gauge value={66} display="214" unit="W" label={t("common.gallery.power")} colorVar="var(--attention)" />
        </div>
        <Sparkline values={[30, 28, 31, 22, 26, 18, 24, 16, 20, 14, 22, 12]} />
      </Card>
      <Card>
        <TrustCue
          title={t("common.gallery.protectedTitle")}
          detail={t("common.gallery.protectedDetail")}
        />
      </Card>
      <Card>
        <EmptyState icon="chart" title={t("common.gallery.noSessions")}>
          {t("common.gallery.noSessionsBody")}
        </EmptyState>
      </Card>
    </div>
  );
}
