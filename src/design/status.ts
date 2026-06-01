export type Status = "ready" | "attention" | "danger" | "protected" | "scanning" | "unknown";

export type StatusMeta = {
  label: string;
  colorVar: string;
  softVar: string;
  lineVar: string;
};

const MAP: Record<Status, StatusMeta> = {
  ready:     { label: "Ready",       colorVar: "var(--status-ready)",      softVar: "var(--status-ready-soft)",      lineVar: "var(--status-ready-line)" },
  attention: { label: "Attention",   colorVar: "var(--status-attention)",  softVar: "var(--status-attention-soft)",  lineVar: "var(--status-attention-line)" },
  danger:    { label: "Critical",    colorVar: "var(--status-danger)",     softVar: "var(--status-danger-soft)",     lineVar: "var(--status-danger-line)" },
  protected: { label: "Protected",   colorVar: "var(--status-protected)",  softVar: "var(--status-protected-soft)",  lineVar: "var(--status-protected-line)" },
  scanning:  { label: "Scanning",    colorVar: "var(--muted)",             softVar: "transparent",                   lineVar: "var(--border-strong)" },
  unknown:   { label: "Unavailable", colorVar: "var(--status-unknown)",    softVar: "transparent",                   lineVar: "var(--border-strong)" },
};

export function statusMeta(status: Status): StatusMeta {
  return MAP[status] ?? MAP.unknown;
}
