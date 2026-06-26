import { useEffect, useState, type ComponentProps } from "react";
import { invoke } from "@tauri-apps/api/core";
import Play from "./Play";
import { SegmentedControl } from "../design/SegmentedControl";
import { Walkthrough } from "../design/Walkthrough";
import { TUNING_PRESETS, resolvePresetItems, type TuningPreset } from "./monitor-view";
import "./Monitor.css";

// Monitor — the restructured live+sessions surface (spec 2026-06-21-monitor-restructure, tab #2 of the
// app-wide restructure). A thin shell: it owns the Sessions/Live segmented control and composes the
// existing <Play> surface via its `view` prop (Play renders sessions-only or live-only). Sessions is the
// DEFAULT (owner pick) — you open Monitor to review the last game; the buried debrief is now the face.
// Reuses the shared SegmentedControl (the gliding-indicator pattern from Optimize). No new IPC.
//
// 3-mode preset GUIDED checklists (Visual Fidelity / Smooth / Clarity) — a quiet, ADVISORY panel above
// the live/sessions content. Each preset bundles EXISTING guided walkthroughs (animated schematics of
// out-of-Compy steps the user follows by hand). Read-only/advisory only: picking a preset just expands
// the checklist; nothing here mutates Windows or touches IPC. The preset data is the knowledge layer
// (src/surfaces/monitor-view.ts); the steps are the same walkthroughs shown elsewhere.

type Segment = "sessions" | "live";

const SEGMENTS: { id: Segment; label: string }[] = [
  { id: "sessions", label: "Sessions" },
  { id: "live", label: "Live" },
];

// Same props App passes to <Play>, minus `view` (the shell drives that from the segment).
type Props = Omit<ComponentProps<typeof Play>, "view">;

function TuningPresets({ vendor }: { vendor: ComponentProps<typeof Play>["vendor"] }) {
  // Which preset's checklist is open (null = all collapsed); and within it, which walkthrough is open.
  const [openPreset, setOpenPreset] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const v = vendor ?? "any";

  return (
    <section
      aria-label="Tuning presets"
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <h2 className="section-title" style={{ fontSize: 14 }}>
        Tuning presets
      </h2>
      <p className="section-help" style={{ marginTop: 0 }}>
        Pick the result you want — each is a short, by-hand checklist of guided steps. Advisory only:
        Compy never changes these for you; it just shows the way.
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {TUNING_PRESETS.map((preset: TuningPreset) => {
          const open = openPreset === preset.id;
          const items = resolvePresetItems(preset);
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
              {preset.label}
              <span className="chip-count">{items.length}</span>
            </button>
          );
        })}
      </div>

      {TUNING_PRESETS.filter((p) => p.id === openPreset).map((preset) => {
        const items = resolvePresetItems(preset);
        return (
          <div key={preset.id} className="card">
            <span className="card-label">{preset.label}</span>
            <span className="card-value" style={{ fontSize: 14, fontWeight: 500 }}>
              {preset.goal}
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
  const [segment, setSegment] = useState<Segment>("sessions");
  // Pre-warm the demand-gated sensor pollers the moment Monitor opens (while the user is still on the
  // Sessions landing) so the Live segment shows real CPU/GPU numbers right away instead of cold-starting
  // the ADLX init + the 2-sample CPU delta after the click. One-shot, read-only; the pollers idle as
  // usual if Live is never opened. Reuses the existing sensor commands — zero new IPC.
  useEffect(() => {
    invoke("get_cpu_sensors").catch(() => {});
    invoke("get_gpu_sensors").catch(() => {});
  }, []);
  return (
    <section className="monitor-root">
      <header className="monitor-bar">
        <SegmentedControl
          segments={SEGMENTS}
          value={segment}
          onChange={(id) => setSegment(id as Segment)}
          aria-label="Monitor sections"
        />
      </header>
      {/* The primary answer first (Sessions: last-game debrief · Live: the meters), THEN the advisory
          Tuning-presets checklist below it — you open Monitor to see how the game went, not to pick a
          preset. (Presets already start collapsed to just their chips.) */}
      <Play {...props} view={segment} />
      <TuningPresets vendor={props.vendor} />
    </section>
  );
}

export default Monitor;
