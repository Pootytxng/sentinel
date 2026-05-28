import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type DiskInfo = {
  mount_point: string;
  total_bytes: number;
  available_bytes: number;
  file_system: string;
};

type GpuInfo = {
  name: string;
  vram_bytes: number;
  driver_version: string;
  driver_date: string;
  driver_age_days: number | null;
  video_processor: string;
  current_refresh_rate_hz: number;
};

type PhysicalDiskInfo = {
  friendly_name: string;
  media_type: string;
  bus_type: string;
  size_bytes: number;
};

type DisplayInfo = {
  width: number;
  height: number;
  current_refresh_rate_hz: number;
  max_refresh_rate_hz: number;
};

type MemoryModuleInfo = {
  capacity_bytes: number;
  speed_mhz: number;
  type_name: string;
  manufacturer: string;
};

type WindowsVersionInfo = {
  edition: string;
  display_version: string;
  build: string;
  ubr: number;
  product_name: string;
};

type CpuArchInfo = {
  vendor: string;
  family_label: string;
  architecture: string;
  generation: string;
};

type HardwareInfo = {
  cpu_brand: string;
  cpu_cores_logical: number;
  cpu_cores_physical: number;
  cpu_frequency_mhz: number;
  ram_total_bytes: number;
  ram_used_bytes: number;
  swap_total_bytes: number;
  os_name: string;
  os_version: string;
  kernel_version: string;
  hostname: string;
  disks: DiskInfo[];
  gpus: GpuInfo[];
  physical_disks: PhysicalDiskInfo[];
  display: DisplayInfo | null;
  memory_modules: MemoryModuleInfo[];
  windows_version: WindowsVersionInfo | null;
  cpu_arch: CpuArchInfo | null;
};

type Recommendation = {
  id: string;
  title: string;
  category: string;
  severity: "safe" | "moderate" | "advanced";
  description: string;
  impact: string;
  downside: string | null;
  applies_to: string;
  currently_applied: boolean;
};

type AppliedChange = {
  id: string;
  rec_id: string;
  rec_title: string;
  applied_at: string;
  snapshot: unknown;
  status: "applied" | "rolled_back";
  is_still_active: boolean;
};

type StartupEntry = {
  name: string;
  command: string;
  enabled: boolean;
};

const APPLIABLE_REC_IDS = new Set<string>([
  "game-mode",
  "visual-effects",
  "sysmain-disable",
  "nvidia-telemetry",
  "power-ultimate",
  "nagle-disable",
  "hags-enable",
  "mouse-accel-off",
  "game-bar-disable",
  "diagtrack-disable",
]);

const fmtGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const fmtGHz = (mhz: number) => (mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : "—");

const fmtDriver = (g: GpuInfo) => {
  const version = g.driver_version || "—";
  if (g.driver_age_days == null) return version;
  const months = Math.floor(g.driver_age_days / 30);
  const age = months < 1 ? "<1 mo" : months === 1 ? "1 mo" : `${months} mo`;
  return `${version} · ${age} old`;
};

// Tabs: Overview is always visible. The category tabs match Recommendation
// .category strings exactly so filtering is a string equality check. Startup
// and History only appear when they have content.
const REC_CATEGORIES = ["Windows", "Power", "GPU", "Display", "Storage", "Network"] as const;
type RecCategory = (typeof REC_CATEGORIES)[number];
type Tab = "Overview" | RecCategory | "Startup" | "History";

function App() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [info, recommendations, history, startupEntries] = await Promise.all([
        invoke<HardwareInfo>("get_hardware_info"),
        invoke<Recommendation[]>("get_recommendations"),
        invoke<AppliedChange[]>("get_applied_changes"),
        invoke<StartupEntry[]>("get_startup_entries"),
      ]);
      setHw(info);
      setRecs(recommendations);
      setChanges(history);
      setStartup(startupEntries);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleStartup = async (entry: StartupEntry) => {
    setBusyId(`startup:${entry.name}`);
    setError(null);
    try {
      await invoke("set_startup_entry_enabled", {
        name: entry.name,
        enabled: !entry.enabled,
      });
      setStartup((prev) =>
        prev.map((e) => (e.name === entry.name ? { ...e, enabled: !e.enabled } : e))
      );
    } catch (e) {
      setError(`Toggle failed: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  const apply = async (rec: Recommendation) => {
    const downsideLine = rec.downside ? `\n\nTradeoff: ${rec.downside}` : "";
    if (
      !window.confirm(
        `Apply: "${rec.title}"?\n\n${rec.description}${downsideLine}\n\nSentinel will record the prior state so you can roll this back at any time.`
      )
    )
      return;
    setBusyId(rec.id);
    setError(null);
    try {
      await invoke<AppliedChange>("apply_recommendation", {
        recId: rec.id,
        recTitle: rec.title,
      });
      await refresh();
    } catch (e) {
      setError(`Apply failed: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  const rollback = async (change: AppliedChange) => {
    if (!window.confirm(`Roll back "${change.rec_title}" to its prior state?`)) return;
    setBusyId(change.id);
    setError(null);
    try {
      await invoke("rollback_change", { changeId: change.id });
      await refresh();
    } catch (e) {
      setError(`Rollback failed: ${e}`);
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const recCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    recs?.forEach((r) => {
      counts[r.category] = (counts[r.category] ?? 0) + 1;
    });
    return counts;
  }, [recs]);

  // Build the ordered list of tabs that have content
  const visibleTabs: Tab[] = useMemo(() => {
    const list: Tab[] = ["Overview"];
    REC_CATEGORIES.forEach((c) => {
      if ((recCountByCategory[c] ?? 0) > 0) list.push(c);
    });
    if (startup.length > 0) list.push("Startup");
    if (changes.length > 0) list.push("History");
    return list;
  }, [recCountByCategory, startup.length, changes.length]);

  // If the currently active tab disappears (e.g. user rolled back the last
  // applied change while History was open), fall back to Overview.
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("Overview");
    }
  }, [visibleTabs, activeTab]);

  const tabBadgeCount = (tab: Tab): number | null => {
    if (tab === "Overview") return null;
    if (tab === "Startup") return startup.length;
    if (tab === "History") return changes.length;
    return recCountByCategory[tab] ?? 0;
  };

  const categoryRecs = (cat: RecCategory): Recommendation[] =>
    (recs ?? []).filter((r) => r.category === cat);

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Sentinel</h1>
          <p className="tag">Hardware-aware PC optimization · v0.1.0</p>
        </div>
        <button className="btn" onClick={refresh} disabled={loading}>
          {loading ? "Scanning…" : "Refresh"}
        </button>
      </header>

      {error && <div className="error">Error: {error}</div>}

      {hw && (
        <>
          <nav className="tab-bar" role="tablist">
            {visibleTabs.map((tab) => {
              const badge = tabBadgeCount(tab);
              return (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  className={`tab ${activeTab === tab ? "tab-active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                  {badge !== null && badge > 0 && (
                    <span className="tab-count">{badge}</span>
                  )}
                </button>
              );
            })}
          </nav>

          {activeTab === "Overview" && <OverviewTab hw={hw} />}

          {REC_CATEGORIES.includes(activeTab as RecCategory) && (
            <CategoryTab
              category={activeTab as RecCategory}
              recs={categoryRecs(activeTab as RecCategory)}
              busyId={busyId}
              onApply={apply}
            />
          )}

          {activeTab === "Startup" && (
            <StartupTab
              entries={startup}
              busyId={busyId}
              onToggle={toggleStartup}
            />
          )}

          {activeTab === "History" && (
            <HistoryTab
              changes={changes}
              busyId={busyId}
              onRollback={rollback}
            />
          )}
        </>
      )}

      <footer className="footer">
        Sentinel never changes anything without your explicit approval.
      </footer>
    </main>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────

function OverviewTab({ hw }: { hw: HardwareInfo }) {
  return (
    <section className="tab-pane">
      <h2 className="section-title">Your hardware</h2>
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
                return (
                  <Detail
                    key={i}
                    k={`Slot ${i + 1}`}
                    v={`${cap}${desc ? ` ${desc}` : ""}${mfg}`}
                  />
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
                <Detail k="VRAM" v={g.vram_bytes > 0 ? fmtGB(g.vram_bytes) : "—"} />
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
              {hw.physical_disks.map((p, i) => (
                <Detail
                  key={i}
                  k={p.friendly_name || `Disk ${i + 1}`}
                  v={`${p.bus_type} ${p.media_type} · ${fmtGB(p.size_bytes)}`}
                />
              ))}
            </>
          )}
        </Card>
      </div>
    </section>
  );
}

function CategoryTab({
  category,
  recs,
  busyId,
  onApply,
}: {
  category: RecCategory;
  recs: Recommendation[];
  busyId: string | null;
  onApply: (rec: Recommendation) => void;
}) {
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">
          {category}
          <span className="count-badge">{recs.length}</span>
        </h2>
        <div className="read-only-pill">Nothing applied without your approval</div>
      </div>
      <div className="rec-list">
        {recs.map((r) => (
          <RecCard
            key={r.id}
            rec={r}
            appliable={APPLIABLE_REC_IDS.has(r.id)}
            busy={busyId === r.id}
            onApply={() => onApply(r)}
          />
        ))}
        {recs.length === 0 && (
          <div className="empty">No recommendations in this category right now.</div>
        )}
      </div>
    </section>
  );
}

function StartupTab({
  entries,
  busyId,
  onToggle,
}: {
  entries: StartupEntry[];
  busyId: string | null;
  onToggle: (entry: StartupEntry) => void;
}) {
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">
          Startup apps
          <span className="count-badge">{entries.length}</span>
        </h2>
        <div className="read-only-pill">
          {entries.filter((e) => !e.enabled).length} disabled
        </div>
      </div>
      <p className="section-help">
        User-scope auto-start entries. Toggle off to keep them from launching with
        Windows. Re-enable any time — nothing is deleted.
      </p>
      <div className="startup-list">
        {entries.map((entry) => (
          <StartupRow
            key={entry.name}
            entry={entry}
            busy={busyId === `startup:${entry.name}`}
            onToggle={() => onToggle(entry)}
          />
        ))}
      </div>
    </section>
  );
}

function HistoryTab({
  changes,
  busyId,
  onRollback,
}: {
  changes: AppliedChange[];
  busyId: string | null;
  onRollback: (change: AppliedChange) => void;
}) {
  return (
    <section className="tab-pane">
      <h2 className="section-title">
        Applied changes
        <span className="count-badge">{changes.length}</span>
      </h2>
      <div className="change-list">
        {changes
          .slice()
          .reverse()
          .map((c) => (
            <ChangeRow
              key={c.id}
              change={c}
              busy={busyId === c.id}
              onRollback={() => onRollback(c)}
            />
          ))}
      </div>
    </section>
  );
}

// ─── Reusable bits ───────────────────────────────────────────────────────

function Card({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
      <div className="card-details">{children}</div>
    </div>
  );
}

function Detail({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="detail">
      <span className="detail-key">{k}</span>
      <span className="detail-value">{v}</span>
    </div>
  );
}

function RecCard({
  rec,
  appliable,
  busy,
  onApply,
}: {
  rec: Recommendation;
  appliable: boolean;
  busy: boolean;
  onApply: () => void;
}) {
  const showApplyButton = appliable && !rec.currently_applied;
  return (
    <div className={`rec rec-${rec.severity} ${rec.currently_applied ? "rec-applied" : ""}`}>
      <div className="rec-head">
        <span className={`rec-cat rec-cat-${rec.category.toLowerCase()}`}>{rec.category}</span>
        {rec.currently_applied ? (
          <span className="rec-status-applied">✓ Already set</span>
        ) : (
          <span className={`rec-sev rec-sev-${rec.severity}`}>{rec.severity}</span>
        )}
      </div>
      <h3 className="rec-title">{rec.title}</h3>
      <p className="rec-desc">{rec.description}</p>
      <div className="rec-meta">
        <div className="rec-row">
          <span className="rec-row-label">Impact</span>
          <span className="rec-row-value impact">{rec.impact}</span>
        </div>
        {rec.downside && (
          <div className="rec-row">
            <span className="rec-row-label">Tradeoff</span>
            <span className="rec-row-value downside">{rec.downside}</span>
          </div>
        )}
        <div className="rec-row">
          <span className="rec-row-label">Why this</span>
          <span className="rec-row-value muted">{rec.applies_to}</span>
        </div>
      </div>
      {showApplyButton && (
        <div className="rec-actions">
          <button className="btn btn-apply" onClick={onApply} disabled={busy}>
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      )}
      {!rec.currently_applied && !appliable && (
        <div className="rec-actions">
          <span className="rec-manual">Manual for now · auto-apply coming</span>
        </div>
      )}
    </div>
  );
}

function StartupRow({
  entry,
  busy,
  onToggle,
}: {
  entry: StartupEntry;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`startup-row ${!entry.enabled ? "startup-row-off" : ""}`}>
      <div className="startup-main">
        <div className="startup-name">{entry.name}</div>
        <div className="startup-command">{entry.command || "(no command)"}</div>
      </div>
      <button
        className={`toggle ${entry.enabled ? "toggle-on" : ""}`}
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={entry.enabled}
        aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name}`}
      >
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
      </button>
    </div>
  );
}

function ChangeRow({
  change,
  busy,
  onRollback,
}: {
  change: AppliedChange;
  busy: boolean;
  onRollback: () => void;
}) {
  const when = new Date(change.applied_at).toLocaleString();
  const stale = change.status === "applied" && !change.is_still_active;
  const stateClass = stale ? "change-stale" : `change-${change.status}`;

  return (
    <div className={`change ${stateClass}`}>
      <div className="change-main">
        <div className="change-title">{change.rec_title}</div>
        <div className="change-when">
          {when}
          {stale && <span className="change-note"> · reverted outside Sentinel</span>}
        </div>
      </div>
      {change.status === "rolled_back" ? (
        <span className="change-status">✓ Rolled back</span>
      ) : stale ? (
        <span className="change-status change-status-stale">No longer active</span>
      ) : (
        <button className="btn btn-rollback" onClick={onRollback} disabled={busy}>
          {busy ? "Rolling back…" : "Roll back"}
        </button>
      )}
    </div>
  );
}

export default App;
