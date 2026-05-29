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

// "Verified"        — Sentinel directly observes the fact this rec claims.
// "Measured signal" — Third-party benchmarks / community consensus measured it.
// "Expected impact" — Logical from Windows internals, not benchmarked.
// Reserved for the synthetic benchmark suite: any rec whose impact reproduces
// under Sentinel's own benchmark graduates to "verified."
type Provenance = "verified" | "measured-signal" | "expected-impact";

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
  provenance: Provenance;
};

type AppliedChange = {
  id: string;
  rec_id: string;
  rec_title: string;
  applied_at: string;
  snapshot: unknown;
  status: "applied" | "rolled_back";
  is_still_active: boolean;
  // Trust Ledger fields (per ARCHITECTURE_LOCKS §1.5 — captured at apply
  // time so rollback survives rule updates / CDN outages / app upgrades).
  // Optional because pre-typed-action entries don't have them yet.
  applied_action?: Record<string, unknown> | null;
  rollback_action?: Record<string, unknown> | null;
  app_version_at_apply?: string | null;
  ruleset_version_at_apply?: string | null;
  elevation_used?: boolean | null;
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
  "windows-search-disable",
  "fast-startup-off",
  "reserved-storage-off",
  "usb-selective-suspend-off",
  "pcie-aspm-off",
  "eee-disable",
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
type Tab = "Overview" | RecCategory | "Startup" | "Diagnostics" | "History";

type DiagnosticEntry = {
  label: string;
  value: string;
  note?: string;
};

type DiagnosticSection = {
  name: string;
  entries: DiagnosticEntry[];
};

function App() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [startup, setStartup] = useState<StartupEntry[]>([]);
  const [diagnostics, setDiagnostics] = useState<DiagnosticSection[]>([]);
  const [rulesSource, setRulesSource] = useState<string>("embedded");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("Overview");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [info, recommendations, history, startupEntries, diagSections, source] =
        await Promise.all([
          invoke<HardwareInfo>("get_hardware_info"),
          invoke<Recommendation[]>("get_recommendations"),
          invoke<AppliedChange[]>("get_applied_changes"),
          invoke<StartupEntry[]>("get_startup_entries"),
          invoke<DiagnosticSection[]>("get_diagnostics"),
          invoke<string>("get_rules_source"),
        ]);
      setHw(info);
      setRecs(recommendations);
      setChanges(history);
      setStartup(startupEntries);
      setDiagnostics(diagSections);
      setRulesSource(source);
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
        `Apply "${rec.title}"?\n\nThis will change a Windows setting to match Sentinel's recommendation.\n\n${rec.description}${downsideLine}\n\nSentinel will snapshot the prior state so you can roll this back at any time.`
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

  // Find the most recent still-active applied change for a given rec_id.
  // Returns undefined if the rec is currently applied but Sentinel didn't
  // record it (e.g. it was set outside Sentinel) -- in which case toggling
  // OFF inside Sentinel isn't possible without a rollback contract.
  const findActiveChangeForRec = (recId: string): AppliedChange | undefined => {
    return changes
      .slice()
      .reverse()
      .find(
        (c) =>
          c.rec_id === recId && c.status === "applied" && c.is_still_active,
      );
  };

  const toggleRec = async (rec: Recommendation) => {
    if (rec.currently_applied) {
      const active = findActiveChangeForRec(rec.id);
      if (!active) {
        // Toggle UI says ON but Sentinel has no rollback record for this
        // setting — it was applied outside Sentinel before we started watching.
        setError(
          `"${rec.title}" is currently on but Sentinel didn't apply it, so there's no rollback record. Toggle it off in the original Windows location instead.`,
        );
        return;
      }
      await rollback(active);
    } else {
      await apply(rec);
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
    // Diagnostics is always visible once we have a hardware scan — it's
    // "Sentinel's raw view of your PC" and the user should be able to reach
    // it to spot-check Sentinel's observations even when nothing else
    // is going on.
    if (diagnostics.length > 0) list.push("Diagnostics");
    if (changes.length > 0) list.push("History");
    return list;
  }, [recCountByCategory, startup.length, diagnostics.length, changes.length]);

  // If the currently active tab disappears (e.g. user rolled back the last
  // applied change while History was open), fall back to Overview.
  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("Overview");
    }
  }, [visibleTabs, activeTab]);

  const tabBadgeCount = (tab: Tab): number | null => {
    if (tab === "Overview") return null;
    if (tab === "Diagnostics") return null;
    if (tab === "Startup") return startup.length;
    if (tab === "History") return changes.length;
    return recCountByCategory[tab] ?? 0;
  };

  const categoryRecs = (cat: RecCategory): Recommendation[] =>
    (recs ?? []).filter((r) => r.category === cat);

  // Truthful label for the rules source — what's actually driving the
  // catalog the user sees. Per ARCHITECTURE_LOCKS §1.3 cold-start contract,
  // "Embedded" is the always-available baseline; "Cached" / "Remote" only
  // appear once signed remote rules are live.
  const rulesSourceLabel =
    rulesSource === "remote"
      ? "Rules: Remote (signed)"
      : rulesSource === "cached"
      ? "Rules: Cached (last-known-good)"
      : "Rules: Built-in";

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Sentinel</h1>
          <p className="tag">Hardware-aware PC optimization · v0.1.0</p>
        </div>
        <div className="header-right">
          <span
            className={`rules-source-pill rules-source-${rulesSource}`}
            title="Where Sentinel's recommendation catalog came from on this launch"
          >
            {rulesSourceLabel}
          </span>
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Scanning…" : "Refresh"}
          </button>
        </div>
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
              onToggle={toggleRec}
              hasActiveChange={(recId) => findActiveChangeForRec(recId) !== undefined}
            />
          )}

          {activeTab === "Startup" && (
            <StartupTab
              entries={startup}
              busyId={busyId}
              onToggle={toggleStartup}
            />
          )}

          {activeTab === "Diagnostics" && (
            <DiagnosticsTab sections={diagnostics} />
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
  onToggle,
  hasActiveChange,
}: {
  category: RecCategory;
  recs: Recommendation[];
  busyId: string | null;
  onToggle: (rec: Recommendation) => void;
  hasActiveChange: (recId: string) => boolean;
}) {
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">
          {category}
          <span className="count-badge">{recs.length}</span>
        </h2>
        <div className="read-only-pill">Nothing changes without your approval</div>
      </div>
      <div className="rec-list">
        {recs.map((r) => (
          <RecCard
            key={r.id}
            rec={r}
            appliable={APPLIABLE_REC_IDS.has(r.id)}
            busy={busyId === r.id}
            canToggleOff={hasActiveChange(r.id)}
            onToggle={() => onToggle(r)}
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

function DiagnosticsTab({ sections }: { sections: DiagnosticSection[] }) {
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">Diagnostics</h2>
      </div>
      <p className="section-help">
        Sentinel's raw view of your PC. These are the observations the
        recommendation engine reads to decide what to surface. If a rec you
        expect doesn't show up — or one you don't expect does — the answer
        usually lives here.
      </p>
      <div className="diag-sections">
        {sections.map((section) => (
          <div key={section.name} className="diag-section">
            <h3 className="diag-section-title">{section.name}</h3>
            <div className="diag-list">
              {section.entries.map((entry, i) => (
                <div key={i} className="diag-row">
                  <div className="diag-row-label">{entry.label}</div>
                  <div className="diag-row-value">{entry.value}</div>
                  {entry.note && (
                    <div className="diag-row-note">{entry.note}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
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
  // Trust Ledger preface: explain to the user what this view is and why
  // they should rely on it. Per the cross-LLM "anti-scam differentiator"
  // framing -- this is where Sentinel proves it's not a tweak pack.
  return (
    <section className="tab-pane">
      <div className="section-header">
        <h2 className="section-title">
          Trust Ledger
          <span className="count-badge">{changes.length}</span>
        </h2>
        <div className="read-only-pill">Audit trail · click any row to expand</div>
      </div>
      <p className="section-help">
        Every change Sentinel has applied to your machine, with the data needed to
        roll it back independently of the live recommendation catalog. This is
        the receipt — Sentinel can prove what it changed, when, with which
        version, and whether your machine still reflects the change.
      </p>
      <div className="change-list">
        {changes.length === 0 ? (
          <div className="empty">
            No applied changes yet. Anything Sentinel applies will appear here
            with a full rollback record.
          </div>
        ) : (
          changes
            .slice()
            .reverse()
            .map((c) => (
              <ChangeRow
                key={c.id}
                change={c}
                busy={busyId === c.id}
                onRollback={() => onRollback(c)}
              />
            ))
        )}
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

const PROVENANCE_LABEL: Record<Provenance, string> = {
  verified: "Verified",
  "measured-signal": "Measured signal",
  "expected-impact": "Expected impact",
};

// Tooltip text shown when the user hovers the provenance pill. Each one
// names the honesty level of the rec's IMPACT claim, not the rec itself.
const PROVENANCE_TITLE: Record<Provenance, string> = {
  verified:
    "Sentinel directly observes this fact (e.g., reads the current refresh rate, measures free disk space, checks driver date). The claim IS the measurement.",
  "measured-signal":
    "Third-party benchmarks or wide community testing has measured this impact. Sentinel cites established results rather than inventing them.",
  "expected-impact":
    "Logical from Windows internals; Sentinel has NOT measured this itself. Honest 'we believe this but haven't verified it under our own benchmark suite.'",
};

function RecCard({
  rec,
  appliable,
  busy,
  canToggleOff,
  onToggle,
}: {
  rec: Recommendation;
  appliable: boolean;
  busy: boolean;
  canToggleOff: boolean;
  onToggle: () => void;
}) {
  // Distinct truths Sentinel surfaces (per cross-LLM review): the toggle
  // position must not pretend Sentinel owns Windows state. We show three
  // separate facts and let the user reason about them:
  //   1. Recommended state  — what Sentinel thinks (always "On" for these recs;
  //      they're all framed as "do this thing", so the recommendation is to
  //      apply)
  //   2. Current state      — what Windows actually is right now (live)
  //   3. Applied by Sentinel — did Sentinel make this change, or did the user
  //      already have it that way / change it externally?
  //
  // The toggle reflects the Current state (so flipping it asks Windows to
  // change). When Current matches Recommended but Sentinel didn't apply it,
  // we surface that distinction explicitly rather than offering a rollback
  // we don't actually have a contract for.
  const currentlyOn = rec.currently_applied;
  const sentinelOwns = canToggleOff; // we have a still-active applied change
  const isInfo = !appliable; // advisory / informational only

  const toggleDisabled =
    busy || isInfo || (currentlyOn && !sentinelOwns);

  const toggleTitle = isInfo
    ? "Advisory recommendation — Sentinel can't auto-apply this; follow the description"
    : busy
    ? "Working…"
    : currentlyOn && !sentinelOwns
    ? "Already on, but Sentinel didn't apply it. Toggle off in the original Windows location."
    : currentlyOn
    ? "Click to roll back. Sentinel will restore the prior state recorded at apply time."
    : "Click to apply. Sentinel will snapshot the prior state so you can roll back at any time.";

  // "Applied by Sentinel" status — three-way: Yes / No (advisory) / No (external)
  const sentinelAppliedLabel = isInfo
    ? "N/A — advisory recommendation"
    : sentinelOwns
    ? "Yes"
    : currentlyOn
    ? "No (set outside Sentinel)"
    : "No (not applied)";
  const sentinelAppliedClass = sentinelOwns
    ? "state-on"
    : currentlyOn && !sentinelOwns
    ? "state-warn"
    : "state-muted";

  const stateClass = isInfo
    ? "rec-info"
    : currentlyOn
    ? "rec-on"
    : "rec-off";

  return (
    <div className={`rec rec-${rec.severity} ${stateClass}`}>
      <div className="rec-head">
        <span className={`rec-cat rec-cat-${rec.category.toLowerCase()}`}>
          {rec.category}
        </span>
        <span className={`rec-sev rec-sev-${rec.severity}`}>{rec.severity}</span>
        <span
          className={`rec-provenance rec-provenance-${rec.provenance}`}
          title={PROVENANCE_TITLE[rec.provenance]}
        >
          {PROVENANCE_LABEL[rec.provenance]}
        </span>
        {isInfo ? (
          <span className="rec-advisory-pill">Advisory</span>
        ) : (
          <button
            className={`toggle rec-toggle ${currentlyOn ? "toggle-on" : ""}`}
            onClick={onToggle}
            disabled={toggleDisabled}
            role="switch"
            aria-checked={currentlyOn}
            aria-label={`${currentlyOn ? "Roll back" : "Apply"} ${rec.title}`}
            title={toggleTitle}
          >
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </button>
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
      <div className="rec-status">
        <div className="rec-status-row">
          <span className="rec-status-label">Recommended</span>
          <span className="rec-status-value state-on">On</span>
        </div>
        <div className="rec-status-row">
          <span className="rec-status-label">Current</span>
          <span
            className={`rec-status-value ${currentlyOn ? "state-on" : "state-off"}`}
          >
            {currentlyOn ? "On" : "Off"}
          </span>
        </div>
        <div className="rec-status-row">
          <span className="rec-status-label">Applied by Sentinel</span>
          <span className={`rec-status-value ${sentinelAppliedClass}`}>
            {sentinelAppliedLabel}
          </span>
        </div>
      </div>
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
  const [expanded, setExpanded] = useState(false);
  const when = new Date(change.applied_at).toLocaleString();
  const stale = change.status === "applied" && !change.is_still_active;
  const stateClass = stale ? "change-stale" : `change-${change.status}`;

  const actionKind = (change.applied_action as { kind?: string } | null | undefined)
    ?.kind;
  const rollbackKind = (change.rollback_action as { kind?: string } | null | undefined)
    ?.kind;
  const snapshot = change.snapshot as
    | { kind?: string; [k: string]: unknown }
    | null
    | undefined;

  return (
    <div
      className={`change ${stateClass} ${expanded ? "change-expanded" : ""}`}
      data-rec-id={change.rec_id}
    >
      <div
        className="change-header"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        <div className="change-main">
          <div className="change-title">
            <span className="change-chevron" aria-hidden="true">
              {expanded ? "▾" : "▸"}
            </span>
            {change.rec_title}
          </div>
          <div className="change-when">
            {when}
            {stale && <span className="change-note"> · reverted outside Sentinel</span>}
          </div>
        </div>
        <div className="change-action-area" onClick={(e) => e.stopPropagation()}>
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
      </div>

      {expanded && (
        <div className="change-details">
          <div className="ledger-grid">
            <div className="ledger-row">
              <span className="ledger-label">Rule id</span>
              <span className="ledger-value mono">{change.rec_id}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Change id</span>
              <span className="ledger-value mono">{change.id}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Applied at</span>
              <span className="ledger-value">{when}</span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Status</span>
              <span className="ledger-value">
                {change.status === "rolled_back"
                  ? "Rolled back by Sentinel"
                  : stale
                  ? "Applied, but no longer matches current Windows state"
                  : "Applied — Sentinel-owned"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Sentinel app version</span>
              <span className="ledger-value mono">
                {change.app_version_at_apply ?? "(pre-versioning entry)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Ruleset version</span>
              <span className="ledger-value mono">
                {change.ruleset_version_at_apply ?? "(pre-versioning entry)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">UAC elevation</span>
              <span className="ledger-value">
                {change.elevation_used == null
                  ? "Unknown (pre-versioning entry)"
                  : change.elevation_used
                  ? "Yes — required admin"
                  : "No — ran as standard user"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Action performed</span>
              <span className="ledger-value mono">
                {actionKind ?? "(legacy: untyped, dispatched by rec_id)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Rollback action</span>
              <span className="ledger-value mono">
                {rollbackKind ?? "(legacy: synthesized from rec_id at rollback time)"}
              </span>
            </div>
            <div className="ledger-row">
              <span className="ledger-label">Prior state snapshot</span>
              <span className="ledger-value mono ledger-snapshot">
                {snapshot
                  ? JSON.stringify(snapshot, null, 2)
                  : "(none recorded)"}
              </span>
            </div>
          </div>
          <div className="ledger-footer">
            This row is the rollback contract. Sentinel can restore the prior
            state from the snapshot above, independently of whether this rule
            still exists in the active recommendation catalog.
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
