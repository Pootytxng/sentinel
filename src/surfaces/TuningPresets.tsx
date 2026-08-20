import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Walkthrough } from "../design/Walkthrough";
import { type GpuVendor } from "./walkthroughs";
import { TUNING_PRESETS, resolvePresetItems, type TuningPreset } from "./monitor-view";
import "../i18n";

// TuningPresets — the quiet, ADVISORY 3-mode preset checklist (Max Quality / More FPS / Lower
// Latency). Each preset bundles EXISTING guided walkthroughs: animated schematics of out-of-Compy
// steps the user follows by hand. Read-only/advisory — picking a preset expands a checklist and
// nothing here mutates Windows or touches IPC. The knowledge layer is src/surfaces/monitor-view.ts.
//
// It lived in Monitor.tsx until 2026-08-19 and moved here unchanged (issue #146, backlog C-18).
// The move is what made the classic Monitor shell deletable: that file's default export had had no
// production importer for weeks, but this one live symbol inside it kept the FILE reachable, so
// src/reachability-guard.test.ts could not see the dead room. Extracting the live symbol let the
// existing guard do the work. Nothing about the render changed — `bare` still skips only the
// standalone <h2>, exactly as it did in its old home.

export function TuningPresets({
  vendor,
  bare = false,
}: {
  vendor?: GpuVendor;
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
        <h2 className="section-title" style={{ fontSize: "var(--type-label)" }}>
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
            <span className="card-value" style={{ fontSize: "var(--type-label)", fontWeight: 500 }}>
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
