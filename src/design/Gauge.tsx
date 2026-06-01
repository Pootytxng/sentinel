import "./Gauge.css";
import type { CSSProperties } from "react";
import { gaugePercent } from "./geometry";

export function Gauge({ value, min = 0, max = 100, display, unit, label, colorVar = "var(--accent)" }:
  { value: number; min?: number; max?: number; display?: string; unit?: string; label: string; colorVar?: string }) {
  const p = gaugePercent(value, min, max);
  const style = { ["--p"]: String(p), ["--gc"]: colorVar } as CSSProperties;
  return (
    <div className="ds-gauge">
      <div className="ds-dialwrap">
        <div className="ds-dial" style={style} />
        <span className="ds-dialval">{display ?? value}{unit ? <span className="ds-u">{unit}</span> : null}</span>
      </div>
      <span className="ds-gl">{label}</span>
    </div>
  );
}
