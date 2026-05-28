import { useEffect, useState } from "react";
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

const fmtGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const fmtGHz = (mhz: number) => (mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : "—");

function App() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await invoke<HardwareInfo>("get_hardware_info");
      setHw(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

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
        <section className="grid">
          <Card label="CPU" value={hw.cpu_brand}>
            <Detail k="Logical cores" v={hw.cpu_cores_logical} />
            <Detail k="Physical cores" v={hw.cpu_cores_physical} />
            <Detail k="Base frequency" v={fmtGHz(hw.cpu_frequency_mhz)} />
          </Card>

          <Card label="Memory" value={fmtGB(hw.ram_total_bytes)}>
            <Detail k="In use" v={`${fmtGB(hw.ram_used_bytes)} (${Math.round((hw.ram_used_bytes / hw.ram_total_bytes) * 100)}%)`} />
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
                  <Detail
                    k="VRAM"
                    v={g.vram_bytes > 0 ? `${fmtGB(g.vram_bytes)}*` : "—"}
                  />
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

          <Card label="Storage" value={`${hw.disks.length} drive${hw.disks.length === 1 ? "" : "s"}`}>
            {hw.disks.map((d) => (
              <Detail
                key={d.mount_point}
                k={d.mount_point}
                v={`${fmtGB(d.available_bytes)} free of ${fmtGB(d.total_bytes)} · ${d.file_system}`}
              />
            ))}
          </Card>
        </section>
      )}

      <footer className="footer">
        Recommendations coming next. Nothing has been changed on your PC.
      </footer>
    </main>
  );
}

function Card({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
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

export default App;
