import { useEffect, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import Play from "./Play";
import { MonitorBasic } from "./MonitorBasic";
import { SegmentedControl } from "../design/SegmentedControl";
import { Walkthrough } from "../design/Walkthrough";
import { readViewMode, applyViewMode, type ViewMode } from "../design/theme";
import { TUNING_PRESETS, resolvePresetItems, type TuningPreset } from "./monitor-view";
import "../i18n";
import "./Monitor.css";

// Monitor — the restructured live+sessions surface (spec 2026-06-21-monitor-restructure, tab #2 of the
// app-wide restructure). A thin shell: it owns the Sessions/Live segmented control and composes the
// existing <Play> surface via its `view` prop (Play renders sessions-only or live-only). Live is the
// DEFAULT + first segment (owner 2026-06-26) — the live meters are this section's primary content;
// Sessions (the last-game debrief) is the second segment.
// Reuses the shared SegmentedControl (the gliding-indicator pattern from Optimize). No new IPC.
//
// 3-mode preset GUIDED checklists (Max Quality / More FPS / Lower Latency) — a quiet, ADVISORY panel above
// the live/sessions content. Each preset bundles EXISTING guided walkthroughs (animated schematics of
// out-of-Compy steps the user follows by hand). Read-only/advisory only: picking a preset just expands
// the checklist; nothing here mutates Windows or touches IPC. The preset data is the knowledge layer
// (src/surfaces/monitor-view.ts); the steps are the same walkthroughs shown elsewhere.

type Segment = "sessions" | "live";

// Same props App passes to <Play>, minus `view` (the shell drives that from the segment).
type Props = Omit<ComponentProps<typeof Play>, "view">;

// Exported for MonitorV2 (V2-5): the same advisory checklist renders in the v2 room's quiet
// slot. `bare` skips only the standalone <h2> (the v2 expander head already names it) — absent
// (the classic render here) the output is byte-identical to before the export.
export function TuningPresets({
  vendor,
  bare = false,
}: {
  vendor: ComponentProps<typeof Play>["vendor"];
  bare?: boolean;
}) {
  const { t, i18n } = useTranslation();
  // Which preset's checklist is open (null = all collapsed); and within it, which walkthrough is open.
  const [openPreset, setOpenPreset] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const v = vendor ?? "any";
  // Name the brand path for variable refresh so the vendor-awareness is visible even before a
  // walkthrough is expanded (AMD = FreeSync, NVIDIA = G-SYNC, Intel = Adaptive-Sync). Read-only copy
  // derived from the already-detected GPU vendor; empty for "any" so we never claim a brand we can't
  // see. The full per-brand VRR/HDR/refresh guidance lives in the Learn "Monitor settings by brand" card.
  const vendorHint =
    v === "amd"
      ? t("monitor.monitor.vendorHintAmd")
      : v === "nvidia"
        ? t("monitor.monitor.vendorHintNvidia")
        : v === "intel"
          ? t("monitor.monitor.vendorHintIntel")
          : "";

  return (
    <section
      aria-label={t("monitor.monitor.tuningPresetsTitle")}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {!bare && (
        <h2 className="section-title" style={{ fontSize: 14 }}>
          {t("monitor.monitor.tuningPresetsTitle")}
        </h2>
      )}
      <p className="section-help" style={{ marginTop: 0 }}>
        {t("monitor.monitor.tuningPresetsHelpPre")}
        {vendorHint}
        {t("monitor.monitor.tuningPresetsHelpPost")}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {TUNING_PRESETS.map((preset: TuningPreset) => {
          const open = openPreset === preset.id;
          const items = resolvePresetItems(preset, i18n.language);
          return (
            <button
              key={preset.id}
              type="button"
              className={`chip ${open ? "chip-active" : ""}`}
              aria-expanded={open}
              onClick={() => {
                setOpenPreset(open ? null : preset.id);
                setOpenItem(null);
              }}
            >
              {t(`monitor.monitor.tuningPresets.${preset.id}.label`, preset.label)}
              <span className="chip-count">{items.length}</span>
            </button>
          );
        })}
      </div>

      {TUNING_PRESETS.filter((p) => p.id === openPreset).map((preset) => {
        const items = resolvePresetItems(preset, i18n.language);
        return (
          <div key={preset.id} className="card">
            <span className="card-label">{t(`monitor.monitor.tuningPresets.${preset.id}.label`, preset.label)}</span>
            <span className="card-value" style={{ fontSize: 14, fontWeight: 500 }}>
              {t(`monitor.monitor.tuningPresets.${preset.id}.goal`, preset.goal)}
            </span>
            <ol
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {items.map(({ key, walkthrough }) => {
                const itemOpen = openItem === key;
                return (
                  <li key={key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <button
                      type="button"
                      className={`btn-small ${itemOpen ? "btn-small-on" : ""}`}
                      style={{ alignSelf: "flex-start" }}
                      aria-expanded={itemOpen}
                      onClick={() => setOpenItem(itemOpen ? null : key)}
                    >
                      {walkthrough.title}
                    </button>
                    {itemOpen && <Walkthrough walkthrough={walkthrough} vendor={v} />}
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

export function Monitor(props: Props) {
  const { t } = useTranslation();
  // Live first + default (owner 2026-06-26): the live meters are the primary content of this section, so
  // Monitor opens on Live; Sessions (the last-game debrief) is the second segment. Built inside the
  // component (not module scope) so the labels re-resolve on a language change.
  const SEGMENTS: { id: Segment; label: string }[] = [
    { id: "live", label: t("monitor.monitor.segments.live") },
    { id: "sessions", label: t("monitor.monitor.segments.sessions") },
  ];
  const MODES: { id: ViewMode; label: string }[] = [
    { id: "basic", label: t("monitor.monitor.modes.basic") },
    { id: "advanced", label: t("monitor.monitor.modes.advanced") },
  ];
  const [segment, setSegment] = useState<Segment>("live");
  // Basic is the default answer-first face; Advanced is the full panels. Mode is global + persisted.
  const [mode, setMode] = useState<ViewMode>(readViewMode);
  const chooseMode = (m: ViewMode) => {
    setMode(m);
    applyViewMode(m); // persists + mirrors onto <html data-view-mode> for later phases' CSS
  };
  // Pre-warm the demand-gated sensor pollers the moment Monitor opens (while the user is still on the
  // Sessions landing) so the Live segment shows real CPU/GPU numbers right away instead of cold-starting
  // the ADLX init + the 2-sample CPU delta after the click. One-shot, read-only; the pollers idle as
  // usual if Live is never opened. Reuses the existing sensor commands — zero new IPC.
  useEffect(() => {
    invoke("get_cpu_sensors").catch(() => {});
    invoke("get_gpu_sensors").catch(() => {});
  }, []);
  const basic = mode === "basic";
  return (
    <section className="monitor-root">
      <header className="monitor-bar">
        {/* Basic collapses Live/Sessions into the one glanceable face, so the segments only show in
            Advanced. */}
        {!basic && (
          <SegmentedControl
            segments={SEGMENTS}
            value={segment}
            onChange={(id) => setSegment(id as Segment)}
            aria-label={t("monitor.monitor.monitorSectionsAria")}
          />
        )}
        <SegmentedControl
          segments={MODES}
          value={mode}
          onChange={(id) => chooseMode(id as ViewMode)}
          aria-label={t("monitor.monitor.detailLevelAria")}
        />
      </header>
      {basic ? (
        // BASIC (P2): the 4 glanceable tiles + last-session door. Advisory presets, overlay config,
        // graphs, and the deep panels all live one tap away in Advanced.
        <MonitorBasic
          active={props.active}
          vendor={props.vendor}
          sessions={props.sessions}
          onOpenSessions={() => {
            chooseMode("advanced");
            setSegment("sessions");
          }}
        />
      ) : (
        <>
          {/* The primary answer first (Sessions: last-game debrief · Live: the meters), THEN the advisory
              Tuning-presets checklist below it — you open Monitor to see how the game went, not to pick a
              preset. (Presets already start collapsed to just their chips.) */}
          <Play {...props} view={segment} />
          <TuningPresets vendor={props.vendor} />
        </>
      )}
    </section>
  );
}

export default Monitor;
