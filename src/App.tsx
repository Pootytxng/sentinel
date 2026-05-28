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
  video_processor: string;
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

const APPLIABLE_REC_IDS = new Set<string>(["game-mode", "visual-effects", "sysmain-disable"]);

const fmtGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const fmtGHz = (mhz: number) => (mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : "—");

const CATEGORIES = ["All", "Windows", "Power", "GPU", "Storage", "Network"] as const;
type Category = (typeof CATEGORIES)[number];

function App() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category>("All");

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [info, recommendations, history] = await Promise.all([
        invoke<HardwareInfo>("get_hardware_info"),
        invoke<Recommendation[]>("get_recommendations"),
        invoke<AppliedChange[]>("get_applied_changes"),
      ]);
      setHw(info);
      setRecs(recommendations);
      setChanges(history);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
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

  const visibleRecs = useMemo(() => {
    if (!recs) return [];
    if (activeCategory === "All") return recs;
    return recs.filter((r) => r.category === activeCategory);
  }, [recs, activeCategory]);

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
          <section>
            <h2 className="section-title">Your hardware</h2>
            <div className="grid">
              <Card label="CPU" value={hw.cpu_brand}>
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
              </Card>

              <Card
                label="Graphics"
                value={hw.gpus.length === 0 ? "No GPU detected" : hw.gpus[0].name}
              >
                {hw.gpus.length === 0 ? (
                  <Detail k="Status" v="WMI returned no adapters" />
                ) : (
                  hw.gpus.map((g, i) => (
                    <div key={i} className="gpu-block">
                      {hw.gpus.length > 1 && <Detail k="Adapter" v={g.name} />}
                      <Detail k="VRAM" v={g.vram_bytes > 0 ? `${fmtGB(g.vram_bytes)}*` : "—"} />
                      <Detail k="Driver" v={g.driver_version || "—"} />
                    </div>
                  ))
                )}
                {hw.gpus.some((g) => g.vram_bytes > 0) && (
                  <div className="footnote">* WMI caps VRAM at ~4 GB; DXGI fix coming.</div>
                )}
              </Card>

              <Card label="System" value={`${hw.os_name} ${hw.os_version}`}>
                <Detail k="Build" v={hw.kernel_version} />
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
              </Card>
            </div>
          </section>

          <section>
            <div className="section-header">
              <h2 className="section-title">
                Recommendations
                {recs && <span className="count-badge">{recs.length}</span>}
              </h2>
              <div className="read-only-pill">Read-only · nothing applied</div>
            </div>

            <div className="filter-row">
              {CATEGORIES.map((c) => {
                const count =
                  c === "All" ? recs?.length ?? 0 : recs?.filter((r) => r.category === c).length ?? 0;
                if (c !== "All" && count === 0) return null;
                return (
                  <button
                    key={c}
                    className={`chip ${activeCategory === c ? "chip-active" : ""}`}
                    onClick={() => setActiveCategory(c)}
                  >
                    {c} <span className="chip-count">{count}</span>
                  </button>
                );
              })}
            </div>

            <div className="rec-list">
              {visibleRecs.map((r) => (
                <RecCard
                  key={r.id}
                  rec={r}
                  appliable={APPLIABLE_REC_IDS.has(r.id)}
                  busy={busyId === r.id}
                  onApply={() => apply(r)}
                />
              ))}
              {visibleRecs.length === 0 && (
                <div className="empty">No recommendations in this category.</div>
              )}
            </div>
          </section>

          {changes.length > 0 && (
            <section>
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
                      onRollback={() => rollback(c)}
                    />
                  ))}
              </div>
            </section>
          )}
        </>
      )}

      <footer className="footer">
        Sentinel never changes anything without your explicit approval.
      </footer>
    </main>
  );
}

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
