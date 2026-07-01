import { GPU_SCOPES, gpuScopeMeta } from "../data/profile-store";
import { useGpuProfileScope } from "../hooks/use-gpu-profile-scope";

// GPU profile view scope picker (measurement, UI-only). Lets you frame the GPU profile view either
// "Global" (whole-PC picture) or "Per-game" (framed around the game you're in). This is a LOCAL,
// advisory viewing lens — it only chooses which slice of already-measured data you look at. It
// changes NOTHING on your PC: no tweak, no service, no arming, no new IPC. Reversible — just pick
// the other one. Styled with theme tokens only (no new stylesheet); accent fills use --ix-accent-ink
// for legible on-accent text.
export function GpuProfile() {
  const { scope, setScope } = useGpuProfileScope();
  const active = gpuScopeMeta(scope);

  return (
    <section
      aria-label="GPU profile scope"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        border: "1px solid var(--ix-border)",
        borderRadius: "var(--ix-radius, 8px)",
        background: "var(--ix-surface-2, rgba(255,255,255,0.03))",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ix-text)",
        }}
      >
        GPU profile view
      </div>

      <div
        role="radiogroup"
        aria-label="GPU profile scope"
        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
      >
        {GPU_SCOPES.map((s) => {
          const meta = gpuScopeMeta(s);
          const selected = s === scope;
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setScope(s)}
              style={{
                cursor: "pointer",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                border: selected ? "1px solid var(--ix-accent)" : "1px solid var(--ix-border)",
                background: selected ? "var(--ix-accent)" : "transparent",
                color: selected ? "var(--ix-accent-ink)" : "var(--ix-text-2)",
              }}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--ix-text-2)" }}>
        {active.blurb}
      </p>

      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.4, color: "var(--ix-text-3, var(--ix-text-2))" }}>
        This just frames what you look at — it changes nothing on your PC.
      </p>
    </section>
  );
}
