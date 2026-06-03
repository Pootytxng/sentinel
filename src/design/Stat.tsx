import "./Stat.css";

export function Stat({ value, unit, label, tone }: { value: string; unit?: string; label: string; tone?: "ready" | "attention" }) {
  return (
    <div className="ds-stat">
      <span className={`ds-v ${tone ? `tone-${tone}` : ""}`}>
        {value}{unit ? <span className="ds-u">{unit}</span> : null}
      </span>
      <span className="ds-l">{label}</span>
    </div>
  );
}
