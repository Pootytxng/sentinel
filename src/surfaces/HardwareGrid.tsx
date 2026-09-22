import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
// Type-only imports (erased at build) — no runtime cycle back into App.tsx, which imports this
// component as a value. The hardware shape lives in App.tsx; both Homes read the same `hw` object.
import type { HardwareInfo, GpuInfo } from "../App";
import type {
  ComponentEvidence,
  ComponentEvidenceReport,
  Fact,
  MachineIdentity,
  MachineModel,
} from "../types";
import { fmtGB, fmtGHz } from "./hardware-format";
import { rigTierLine } from "../data/rig-tier";
import { Term } from "../design/Term";
import { useIntelligenceFlag } from "../design/use-hud";

// The detailed "Your hardware" card grid — the SINGLE source every Home surface renders, so they
// can never drift (the regression this restores: the grid once lived only in the classic Overview,
// so it vanished from the shipped Home). Reuses the existing card markup + the count-agnostic
// elastic §6 grid (incl. the Network card). `hw` is the same object every Home already passes.
// Responsive via the global `.grid` (flex-wrap, min-width:0).
//
// Shared Machine Model, slice 3 (#451): the six IDENTITY rows — CPU name, primary GPU, GPU driver,
// total RAM, display mode, Windows edition/build — read `model.identity`, which every Home obtains
// from `useMachineModel(hw)` (one read-only IPC per hardware refresh). A Fact carries its source
// and, when it has no value, the reason it has none; the grid prints that reason instead of "—" or
// "0 GB". Nothing here labels a value "live": an `unstamped-cache` value prints as a value, with no
// freshness word. Cards the model does not cover (disks, BIOS, memory modules, network, monitors,
// cores and frequency) stay on `HardwareInfo` unchanged.

// Driver version + coarse age, from the age the inventory read alongside the adapter.
const fmtDriverAge = (version: string, ageDays: number | null | undefined, t: TFunction) => {
  // Honest empty-state for an unreadable age — say so (matches the Export "driver age —" /
  // readiness "Couldn't read a driver date") instead of silently hiding the freshness datum.
  if (ageDays == null) return t("gaming.hardwareGrid.driverAgeUnknown", { version });
  const months = Math.floor(ageDays / 30);
  const age =
    months < 1
      ? t("gaming.hardwareGrid.driverAgeLessThanMonth")
      : months === 1
      ? t("gaming.hardwareGrid.driverAgeOneMonth")
      : t("gaming.hardwareGrid.driverAgeMonths", { months });
  return t("gaming.hardwareGrid.driverAgeOld", { version, age });
};

// SECONDARY adapters only. The primary adapter's driver is an identity row and reads the model.
const fmtDriver = (g: GpuInfo, t: TFunction) => {
  const version = g.driver_version || "—";
  if (version === "—" && g.driver_age_days == null) return version;
  return fmtDriverAge(version, g.driver_age_days, t);
};

// What one identity row has to say. `reading` is the model not read yet, `unreadable` is the read
// having failed — two different honest states that print differently (a failed read is not a slow
// one). `unknown` carries the producer's own reason.
type IdentityState =
  | { kind: "reading" }
  | { kind: "unreadable" }
  | { kind: "known"; text: string }
  | { kind: "unknown"; reason: string | null };

function identityState<T>(
  model: MachineModel | null | undefined,
  pick: (identity: MachineIdentity) => Fact<T>,
  format: (value: T) => string,
): IdentityState {
  if (model === undefined) return { kind: "reading" };
  if (model === null) return { kind: "unreadable" };
  const fact = pick(model.identity);
  if (fact.value !== null && fact.value !== undefined) return { kind: "known", text: format(fact.value) };
  return { kind: "unknown", reason: fact.unknown_reason ?? fact.not_applicable_reason ?? null };
}

const stateValue = (s: IdentityState, t: TFunction): string => {
  switch (s.kind) {
    case "reading":
      return t("gaming.hardwareGrid.identityReading");
    case "unreadable":
      return t("gaming.hardwareGrid.identityUnreadable");
    case "unknown":
      return t("gaming.hardwareGrid.identityUnknown");
    case "known":
      return s.text;
  }
};

const stateReason = (s: IdentityState, t: TFunction): string | null => {
  if (s.kind === "unreadable") return t("gaming.hardwareGrid.identityUnreadableReason");
  if (s.kind === "unknown") return s.reason || t("gaming.hardwareGrid.identityNoReason");
  return null;
};

// The model's display mode is "WxH@R". Print it the way the grid always has ("W×H @ R Hz"), and keep
// the panel's maximum refresh rate beside it when the inventory read one higher than the current.
// A mode in any other spelling prints as the model gave it — never reformatted into a guess.
const fmtDisplayMode = (mode: string, hw: HardwareInfo, t: TFunction) => {
  const m = /^(\d+)x(\d+)@(\d+)$/.exec(mode.trim());
  if (!m) return mode;
  const rate = Number(m[3]);
  const base = `${m[1]}×${m[2]} @ ${rate} Hz`;
  const max = hw.display?.max_refresh_rate_hz ?? 0;
  return max > rate ? `${base} ${t("gaming.hardwareGrid.displayMaxSuffix", { maxRate: max })}` : base;
};

// A disagreement names its producers by their code names; the person reads plain ones. An unlisted
// producer prints as named — a label the reader can quote beats a hidden one.
const producerLabel = (producer: string, t: TFunction) => {
  if (producer === "hardware::get_hardware_info") return t("gaming.hardwareGrid.producerCurrentRead");
  if (producer === "hardware::current_fingerprint") return t("gaming.hardwareGrid.producerCurrentFingerprint");
  if (producer === "intelligence::IdentitySnapshot") return t("gaming.hardwareGrid.producerSessionSnapshot");
  if (producer.startsWith("hwchange::fingerprint")) return t("gaming.hardwareGrid.producerSavedBaseline");
  return producer;
};

const identityFieldLabel = (field: string, t: TFunction) => {
  switch (field) {
    case "cpu":
      return t("gaming.hardwareGrid.cpuLabel");
    case "gpu":
      return t("gaming.hardwareGrid.graphicsLabel");
    case "gpu_driver":
      return t("gaming.hardwareGrid.driverLabel");
    case "ram_gb":
      return t("gaming.hardwareGrid.memoryLabel");
    case "display":
      return t("gaming.hardwareGrid.displayLabel");
    case "windows":
      return t("gaming.hardwareGrid.systemLabel");
    default:
      return field;
  }
};

// Intelligence Phase 4 (§4H hardware twin) — pull the component-evidence projection and key it by
// component. A card lights ONLY when a real Intelligence Phase 2 pattern implicates that component
// (see src-tauri/src/component_evidence.rs); this invents nothing. Gated on the Intelligence flag:
// off ⇒ empty map ⇒ every card renders exactly as before (honest neutral). Fetch failure ⇒ empty
// map, never a fabricated highlight. Read-only — no mutation, no network, nothing written.
function useComponentEvidence(enabled: boolean): Map<string, ComponentEvidence> {
  const [map, setMap] = useState<Map<string, ComponentEvidence>>(() => new Map());
  useEffect(() => {
    if (!enabled) {
      setMap(new Map());
      return;
    }
    let alive = true;
    try {
      invoke<ComponentEvidenceReport>("get_component_evidence")
        .then((report) => {
          if (!alive) return;
          const next = new Map<string, ComponentEvidence>();
          for (const c of report.components) next.set(c.component, c);
          setMap(next);
        })
        .catch(() => {
          if (alive) setMap(new Map());
        });
    } catch {
      if (alive) setMap(new Map());
    }
    return () => {
      alive = false;
    };
  }, [enabled]);
  return map;
}

// The lit-card evidence index: a native <details> disclosure (keyboard-accessible, no JS motion,
// reduced-motion-safe by construction). Always-visible = the band + one non-causal headline; the
// disclosure holds the implicating patterns' own findings + the next test that would sharpen them.
// No "go to another tab" dead-end (flags-name-it-and-fix-it-inline law) — the why lives right here.
function CardEvidence({ ev }: { ev: ComponentEvidence }) {
  const { t } = useTranslation();
  return (
    <details className={`hw-evi hw-evi-${ev.confidence}`}>
      <summary className="hw-evi-summary">
        <span className="hw-evi-band">
          {t("gaming.hardwareGrid.confidenceSuffix", { level: ev.confidence })}
        </span>
        <span className="hw-evi-headline">{ev.headline}</span>
      </summary>
      <div className="hw-evi-body">
        <ul className="hw-evi-reasons">
          {ev.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {ev.next_test && (
          <p className="hw-evi-next">
            <span className="hw-evi-next-label">{t("gaming.hardwareGrid.nextTestLabel")}</span>
            {ev.next_test}
          </p>
        )}
      </div>
    </details>
  );
}

function Card({
  label,
  value,
  reason,
  children,
  evidence,
}: {
  label: string;
  value: string;
  /** Why the value is missing, when it is — printed under the value, never in place of it. */
  reason?: string | null;
  children: ReactNode;
  evidence?: ComponentEvidence;
}) {
  return (
    <div className={evidence ? "card card-lit" : "card"}>
      <div className="card-label">
        {label}
        {evidence && <span className="hw-evi-dot" aria-hidden="true" />}
      </div>
      <div className="card-value">{value}</div>
      {reason && <div className="hw-fact-reason">{reason}</div>}
      <div className="card-details">{children}</div>
      {evidence && <CardEvidence ev={evidence} />}
    </div>
  );
}

function Detail({ k, v }: { k: ReactNode; v: string | number }) {
  return (
    <div className="detail">
      <span className="detail-key">{k}</span>
      <span className="detail-value">{v}</span>
    </div>
  );
}

// An identity row inside a card's detail list: the value, or the state word plus its reason.
function FactDetail({ k, state, t }: { k: ReactNode; state: IdentityState; t: TFunction }) {
  const reason = stateReason(state, t);
  return (
    <>
      <Detail k={k} v={stateValue(state, t)} />
      {reason && <div className="hw-fact-reason">{reason}</div>}
    </>
  );
}

export function HardwareGrid({
  hw,
  model,
}: {
  hw: HardwareInfo;
  /** `useMachineModel()`'s word: `undefined` not read yet · `null` the read failed · the model. */
  model: MachineModel | null | undefined;
}) {
  const { t } = useTranslation();
  // §4H hardware twin — the map is keyed by component and holds ONLY implicated components (today:
  // gpu, memory). Every card reads its own key: an absent key ⇒ undefined ⇒ neutral. Passing the
  // lookup to all six cards is forward-compatible — when a detector that names a new component
  // ships, its card lights with no change here.
  const evidence = useComponentEvidence(useIntelligenceFlag());
  // Rough, transparent rig tier (owner-greenlit 2026-06-22) — see src/data/rig-tier.ts. It names the
  // exact specs it read, and the bands are conservative (a single strong axis can't inflate the tier).
  const tier = rigTierLine(
    Math.max(0, ...(hw.gpus ?? []).map((g) => g.vram_bytes)),
    hw.cpu_cores_physical,
    hw.ram_total_bytes,
  );
  // The six identity rows, each from its Fact. The formatters print a KNOWN value only; a missing
  // one never reaches them, so no "0 GB" or "—" can come out of this block.
  const cpu = identityState(model, (id) => id.cpu, String);
  const gpu = identityState(model, (id) => id.gpu, String);
  const driver = identityState(model, (id) => id.gpu_driver, (v) =>
    fmtDriverAge(v, hw.gpus[0]?.driver_age_days, t),
  );
  const ram = identityState(model, (id) => id.ram_gb, (gb) => t("gaming.hardwareGrid.ramGbValue", { gb }));
  const display = identityState(model, (id) => id.display, (mode) => fmtDisplayMode(mode, hw, t));
  const windows = identityState(model, (id) => id.windows, String);
  const disagreements = model?.identity.disagreements ?? [];
  return (
    <>
      {tier && (
        <div className={`hw-tier hw-tier-${tier.tier.toLowerCase()}`} role="note">
          <span className="hw-tier-label">{t("gaming.hardwareGrid.rigTierLabel")}</span>
          <span className="hw-tier-value">
            {t(`gaming.hardwareGrid.rigTierValue.${tier.tier}`)}
          </span>
          <span className="hw-tier-basis">{tier.basis}</span>
        </div>
      )}
      {/* Two producers disagree about one identity field: both readings print, neither overwrites
          the other, and the model's own interpretation follows. The card below still shows the
          canonical producer's value — the disagreement is reported here, not resolved. */}
      {disagreements.map((d, i) => (
        <div key={`${d.field}-${i}`} className="hw-disagree" role="note">
          <span className="hw-disagree-label">
            {t("gaming.hardwareGrid.disagreementTitle", { field: identityFieldLabel(d.field, t) })}
          </span>
          <span className="hw-disagree-claim">
            {producerLabel(d.left.producer, t)}: {d.left.value}
          </span>
          <span className="hw-disagree-claim">
            {producerLabel(d.right.producer, t)}: {d.right.value}
          </span>
          <span className="hw-disagree-why">{d.interpretation}</span>
        </div>
      ))}
      <div className="grid">
        <Card
          label={t("gaming.hardwareGrid.cpuLabel")}
          value={stateValue(cpu, t)}
          reason={stateReason(cpu, t)}
          evidence={evidence.get("cpu")}
        >
          {hw.cpu_arch?.architecture && hw.cpu_arch.architecture !== "Unknown" && (
            <Detail
              k={t("gaming.hardwareGrid.architectureLabel")}
              v={`${hw.cpu_arch.architecture}${
                hw.cpu_arch.generation && hw.cpu_arch.generation !== hw.cpu_arch.architecture
                  ? ` · ${hw.cpu_arch.generation}`
                  : ""
              }`}
            />
          )}
          <Detail k={t("gaming.hardwareGrid.logicalCoresLabel")} v={hw.cpu_cores_logical} />
          <Detail k={t("gaming.hardwareGrid.physicalCoresLabel")} v={hw.cpu_cores_physical} />
          <Detail k={t("gaming.hardwareGrid.baseFrequencyLabel")} v={fmtGHz(hw.cpu_frequency_mhz)} />
        </Card>

        <Card
          label={t("gaming.hardwareGrid.memoryLabel")}
          value={stateValue(ram, t)}
          reason={stateReason(ram, t)}
          evidence={evidence.get("memory")}
        >
          {/* In-use is a LIVE usage reading, not identity: it stays on the inventory's own total,
              and prints no percentage when that total read as zero (a share of nothing is not a
              number). */}
          <Detail
            k={t("gaming.hardwareGrid.inUseLabel")}
            v={
              hw.ram_total_bytes > 0
                ? `${fmtGB(hw.ram_used_bytes)} (${Math.round(
                    (hw.ram_used_bytes / hw.ram_total_bytes) * 100
                  )}%)`
                : fmtGB(hw.ram_used_bytes)
            }
          />
          <Detail k={t("gaming.hardwareGrid.swapLabel")} v={fmtGB(hw.swap_total_bytes)} />
          {hw.memory_modules.length > 0 && (
            <>
              <div className="sub-divider">{t("gaming.hardwareGrid.modulesLabel")}</div>
              {hw.memory_modules.map((m, i) => {
                const cap = m.capacity_bytes > 0 ? fmtGB(m.capacity_bytes) : "—";
                const speed = m.speed_mhz > 0 ? `${m.speed_mhz} MHz` : "";
                const type_ = m.type_name !== "Unknown" ? m.type_name : "";
                const desc = [type_, speed].filter(Boolean).join("-");
                const mfg = m.manufacturer && m.manufacturer !== "Undefined"
                  ? ` (${m.manufacturer})`
                  : "";
                const belowRated =
                  m.xmp_expo_status === "running_below_rated" && m.rated_speed_mhz > 0;
                return (
                  <div key={i}>
                    <Detail
                      k={t("gaming.hardwareGrid.slotLabel", { n: i + 1 })}
                      v={`${cap}${desc ? ` ${desc}` : ""}${mfg}`}
                    />
                    {belowRated && (
                      <div className="detail-flag">
                        {t("gaming.hardwareGrid.xmpFlagPre", {
                          speed: m.speed_mhz,
                          rated: m.rated_speed_mhz,
                        })}{" "}
                        <Term id="xmp">{t("gaming.hardwareGrid.xmpTermLabel")}</Term>{" "}
                        {t("gaming.hardwareGrid.xmpFlagMid")}{" "}
                        <Term id="uefi-bios">{t("gaming.hardwareGrid.biosTermLabel")}</Term>{" "}
                        {t("gaming.hardwareGrid.xmpFlagPost")}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </Card>

        <Card
          label={t("gaming.hardwareGrid.graphicsLabel")}
          value={stateValue(gpu, t)}
          reason={stateReason(gpu, t)}
          evidence={evidence.get("gpu")}
        >
          {hw.gpus.length === 0 ? (
            <>
              <Detail
                k={t("gaming.hardwareGrid.statusLabel")}
                v={t("gaming.hardwareGrid.noGpuMessage")}
              />
              <FactDetail k={t("gaming.hardwareGrid.driverLabel")} state={driver} t={t} />
            </>
          ) : (
            hw.gpus.map((g, i) => (
              <div key={i} className="gpu-block">
                {hw.gpus.length > 1 && (
                  <Detail k={t("gaming.hardwareGrid.adapterLabel")} v={g.name} />
                )}
                <Detail
                  k={<Term id="vram">{t("gaming.hardwareGrid.vramTermLabel")}</Term>}
                  v={g.vram_bytes > 0 ? fmtGB(g.vram_bytes) : "—"}
                />
                {i === 0 ? (
                  <FactDetail k={t("gaming.hardwareGrid.driverLabel")} state={driver} t={t} />
                ) : (
                  <Detail k={t("gaming.hardwareGrid.driverLabel")} v={fmtDriver(g, t)} />
                )}
                {g.current_refresh_rate_hz > 0 && (
                  <Detail
                    k={t("gaming.hardwareGrid.outputLabel")}
                    v={`${g.current_refresh_rate_hz} Hz`}
                  />
                )}
              </div>
            ))
          )}
          <FactDetail k={t("gaming.hardwareGrid.displayLabel")} state={display} t={t} />
          {/* The actual panel model(s) from EDID (WmiMonitorID) — Windows otherwise only knows
              "Generic PnP Monitor". Names YOUR monitor; one row per connected display. */}
          {(hw.monitors ?? []).length > 0 && (
            <Detail
              k={t(
                (hw.monitors ?? []).length > 1
                  ? "gaming.hardwareGrid.monitorsLabel"
                  : "gaming.hardwareGrid.monitorLabel"
              )}
              v={(hw.monitors ?? [])
                .map((m) => `${m.manufacturer ? `${m.manufacturer} ` : ""}${m.model}`.trim())
                .join(" · ")}
            />
          )}
        </Card>

        <Card
          label={t("gaming.hardwareGrid.systemLabel")}
          value={stateValue(windows, t)}
          reason={stateReason(windows, t)}
          evidence={evidence.get("system")}
        >
          <Detail k={t("gaming.hardwareGrid.hostnameLabel")} v={hw.hostname} />
          {hw.bios_info && hw.bios_info.version && (
            <Detail
              k={<Term id="uefi-bios">{t("gaming.hardwareGrid.biosTermLabel")}</Term>}
              v={`${hw.bios_info.version}${
                hw.bios_info.release_date_age_days != null
                  ? ` · ${t("gaming.hardwareGrid.daysOldSuffix", {
                      days: hw.bios_info.release_date_age_days,
                    })}`
                  : ""
              }`}
            />
          )}
        </Card>

        <Card
          label={t("gaming.hardwareGrid.storageLabel")}
          value={t("gaming.hardwareGrid.driveCount", { count: hw.disks.length })}
          evidence={evidence.get("storage")}
        >
          {hw.disks.map((d) => (
            <Detail
              key={d.mount_point}
              k={d.mount_point}
              v={t("gaming.hardwareGrid.freeOfTotal", {
                free: fmtGB(d.available_bytes),
                total: fmtGB(d.total_bytes),
                fs: d.file_system,
              })}
            />
          ))}
          {hw.physical_disks.length > 0 && (
            <>
              <div className="sub-divider">{t("gaming.hardwareGrid.physicalDrivesLabel")}</div>
              {hw.physical_disks.map((p, i) => {
                const health = hw.disk_health.find(
                  (d) => d.friendly_name === p.friendly_name
                )?.health;
                const concern = health != null && health !== "Healthy" && health !== "Unknown";
                return (
                  <div key={i}>
                    <Detail
                      k={p.friendly_name || t("gaming.hardwareGrid.diskFallback", { n: i + 1 })}
                      v={`${p.bus_type} ${p.media_type} · ${fmtGB(p.size_bytes)}${
                        health ? ` · ${health}` : ""
                      }`}
                    />
                    {concern && (
                      <div className="detail-flag">
                        {t("gaming.hardwareGrid.smartWarning", { health })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </Card>

        {/* Network (elastic §6, 6th card → the grid tiles symmetrically): named PHYSICAL adapter +
            state, from the detection-train inventory (existing get_hardware data; zero new IPC). */}
        {(() => {
          const phys = (hw.network_adapters ?? []).filter((a) => a.physical);
          const active = phys.find((a) => a.connected) ?? null;
          const mediumLabel = (m: string) =>
            m === "wired"
              ? t("gaming.hardwareGrid.ethernetLabel")
              : m === "wifi"
              ? t("gaming.hardwareGrid.wifiLabel")
              : t("gaming.hardwareGrid.otherLabel");
          const value = active
            ? mediumLabel(active.medium)
            : hw.has_wired_ethernet_port
            ? t("gaming.hardwareGrid.ethernetUnplugged")
            : phys.length > 0
            ? t("gaming.hardwareGrid.notConnectedLabel")
            : t("gaming.hardwareGrid.noAdapterDetected");
          return (
            <Card label={t("gaming.hardwareGrid.networkLabel")} value={value} evidence={evidence.get("network")}>
              {phys.length === 0 ? (
                <Detail
                  k={t("gaming.hardwareGrid.statusLabel")}
                  v={t("gaming.hardwareGrid.noPhysicalAdapterDetected")}
                />
              ) : (
                // Stack name over status (names are long); the medium ("Ethernet"/"Wi-Fi") already
                // shows in the card value, so the status drops it — just Connected / Not connected.
                phys.map((a, i) => (
                  <div key={i} className="net-adapter">
                    <span className="net-adapter-name">{a.name}</span>
                    <span className="net-adapter-status">
                      {a.connected
                        ? t("gaming.hardwareGrid.connectedLabel")
                        : t("gaming.hardwareGrid.notConnectedLabel")}
                    </span>
                  </div>
                ))
              )}
            </Card>
          );
        })()}
      </div>
    </>
  );
}
