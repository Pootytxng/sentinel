import type { ReactNode } from "react";
// Type-only imports (erased at build) — no runtime cycle back into App.tsx, which imports this
// component as a value. The hardware shape lives in App.tsx; both Homes read the same `hw` object.
import type { HardwareInfo, GpuInfo } from "../App";
import { fmtGB, fmtGHz } from "./hardware-format";
import { rigTierLine } from "../data/rig-tier";
import { Term } from "../design/Term";

// The detailed "Your hardware" card grid — the SINGLE source for both the classic Overview surface
// and the CommandCenter Home, so the two can never drift (the regression this restores: the grid was
// only in the classic Overview, so it vanished from the shipped Home). Reuses the existing card markup
// + the count-agnostic elastic §6 grid (incl. the Network card). `hw` is the same object both Homes
// already pass — zero new IPC. Responsive via the global `.grid` (flex-wrap, min-width:0).

// Driver version + coarse age. Grid-only formatter (kept here, not in the shared module).
const fmtDriver = (g: GpuInfo) => {
  const version = g.driver_version || "—";
  // Honest empty-state for an unreadable age — say so (matches the Export "driver age —" /
  // readiness "Couldn't read a driver date") instead of silently hiding the freshness datum.
  if (g.driver_age_days == null) return version === "—" ? version : `${version} · age unknown`;
  const months = Math.floor(g.driver_age_days / 30);
  const age = months < 1 ? "<1 mo" : months === 1 ? "1 mo" : `${months} mo`;
  return `${version} · ${age} old`;
};

function Card({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      <div className="card-details">{children}</div>
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

export function HardwareGrid({ hw }: { hw: HardwareInfo }) {
  // Rough, transparent rig tier (owner-greenlit 2026-06-22) — see src/data/rig-tier.ts. It names the
  // exact specs it read, and the bands are conservative (a single strong axis can't inflate the tier).
  const tier = rigTierLine(
    Math.max(0, ...(hw.gpus ?? []).map((g) => g.vram_bytes)),
    hw.cpu_cores_physical,
    hw.ram_total_bytes,
  );
  return (
    <>
      {tier && (
        <div className={`hw-tier hw-tier-${tier.tier.toLowerCase()}`} role="note">
          <span className="hw-tier-label">Rig tier</span>
          <span className="hw-tier-value">{tier.tier}</span>
          <span className="hw-tier-basis">{tier.basis}</span>
        </div>
      )}
      <div className="grid">
        <Card label="CPU" value={hw.cpu_arch?.family_label || hw.cpu_brand}>
          {hw.cpu_arch?.architecture && hw.cpu_arch.architecture !== "Unknown" && (
            <Detail
              k="Architecture"
              v={`${hw.cpu_arch.architecture}${
                hw.cpu_arch.generation && hw.cpu_arch.generation !== hw.cpu_arch.architecture
                  ? ` · ${hw.cpu_arch.generation}`
                  : ""
              }`}
            />
          )}
          <Detail k="Logical cores" v={hw.cpu_cores_logical} />
          <Detail k="Physical cores" v={hw.cpu_cores_physical} />
          <Detail k="Base frequency" v={fmtGHz(hw.cpu_frequency_mhz)} />
        </Card>

        <Card label="Memory" value={fmtGB(hw.ram_total_bytes)}>
          <Detail
            k="In use"
            v={`${fmtGB(hw.ram_used_bytes)} (${Math.round(
              (hw.ram_used_bytes / hw.ram_total_bytes) * 100
            )}%)`}
          />
          <Detail k="Swap" v={fmtGB(hw.swap_total_bytes)} />
          {hw.memory_modules.length > 0 && (
            <>
              <div className="sub-divider">Modules</div>
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
                    <Detail k={`Slot ${i + 1}`} v={`${cap}${desc ? ` ${desc}` : ""}${mfg}`} />
                    {belowRated && (
                      <div className="detail-flag">
                        Running at {m.speed_mhz} of {m.rated_speed_mhz} MT/s — enable{" "}
                        <Term id="xmp">EXPO/XMP</Term> in <Term id="uefi-bios">BIOS</Term> to reach
                        its rated speed.
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </Card>

        <Card
          label="Graphics"
          value={hw.gpus.length === 0 ? "No GPU detected" : hw.gpus[0].name}
        >
          {hw.gpus.length === 0 ? (
            <Detail k="Status" v="DXGI and WMI both returned no adapters" />
          ) : (
            hw.gpus.map((g, i) => (
              <div key={i} className="gpu-block">
                {hw.gpus.length > 1 && <Detail k="Adapter" v={g.name} />}
                <Detail k={<Term id="vram">VRAM</Term>} v={g.vram_bytes > 0 ? fmtGB(g.vram_bytes) : "—"} />
                <Detail k="Driver" v={fmtDriver(g)} />
                {g.current_refresh_rate_hz > 0 && (
                  <Detail k="Output" v={`${g.current_refresh_rate_hz} Hz`} />
                )}
              </div>
            ))
          )}
          {hw.display && hw.display.width > 0 && (
            <Detail
              k="Display"
              v={
                hw.display.max_refresh_rate_hz > hw.display.current_refresh_rate_hz
                  ? `${hw.display.width}×${hw.display.height} @ ${hw.display.current_refresh_rate_hz} Hz (max ${hw.display.max_refresh_rate_hz} Hz)`
                  : `${hw.display.width}×${hw.display.height} @ ${hw.display.current_refresh_rate_hz} Hz`
              }
            />
          )}
          {/* The actual panel model(s) from EDID (WmiMonitorID) — Windows otherwise only knows
              "Generic PnP Monitor". Names YOUR monitor; one row per connected display. */}
          {(hw.monitors ?? []).length > 0 && (
            <Detail
              k={(hw.monitors ?? []).length > 1 ? "Monitors" : "Monitor"}
              v={(hw.monitors ?? [])
                .map((m) => `${m.manufacturer ? `${m.manufacturer} ` : ""}${m.model}`.trim())
                .join(" · ")}
            />
          )}
        </Card>

        <Card
          label="System"
          value={hw.windows_version?.product_name || `${hw.os_name} ${hw.os_version}`}
        >
          <Detail
            k="Build"
            v={
              hw.windows_version
                ? `${hw.windows_version.build}.${hw.windows_version.ubr}`
                : hw.kernel_version
            }
          />
          <Detail k="Hostname" v={hw.hostname} />
          {hw.bios_info && hw.bios_info.version && (
            <Detail
              k={<Term id="uefi-bios">BIOS</Term>}
              v={`${hw.bios_info.version}${
                hw.bios_info.release_date_age_days != null
                  ? ` · ${hw.bios_info.release_date_age_days} days old`
                  : ""
              }`}
            />
          )}
        </Card>

        <Card
          label="Storage"
          value={`${hw.disks.length} drive${hw.disks.length === 1 ? "" : "s"}`}
        >
          {hw.disks.map((d) => (
            <Detail
              key={d.mount_point}
              k={d.mount_point}
              v={`${fmtGB(d.available_bytes)} free of ${fmtGB(d.total_bytes)} · ${d.file_system}`}
            />
          ))}
          {hw.physical_disks.length > 0 && (
            <>
              <div className="sub-divider">Physical drives</div>
              {hw.physical_disks.map((p, i) => {
                const health = hw.disk_health.find(
                  (d) => d.friendly_name === p.friendly_name
                )?.health;
                const concern = health != null && health !== "Healthy" && health !== "Unknown";
                return (
                  <div key={i}>
                    <Detail
                      k={p.friendly_name || `Disk ${i + 1}`}
                      v={`${p.bus_type} ${p.media_type} · ${fmtGB(p.size_bytes)}${
                        health ? ` · ${health}` : ""
                      }`}
                    />
                    {concern && (
                      <div className="detail-flag">
                        SMART reports {health} — back up important data and run the drive vendor's
                        health tool.
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
            m === "wired" ? "Ethernet" : m === "wifi" ? "Wi-Fi" : "Other";
          const value = active
            ? mediumLabel(active.medium)
            : hw.has_wired_ethernet_port
            ? "Ethernet — unplugged"
            : phys.length > 0
            ? "Not connected"
            : "No adapter detected";
          return (
            <Card label="Network" value={value}>
              {phys.length === 0 ? (
                <Detail k="Status" v="No physical adapter detected" />
              ) : (
                // Stack name over status (names are long); the medium ("Ethernet"/"Wi-Fi") already
                // shows in the card value, so the status drops it — just Connected / Not connected.
                phys.map((a, i) => (
                  <div key={i} className="net-adapter">
                    <span className="net-adapter-name">{a.name}</span>
                    <span className="net-adapter-status">
                      {a.connected ? "Connected" : "Not connected"}
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
