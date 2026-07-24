import type { TFunction } from "i18next";

export type Status = "ready" | "attention" | "danger" | "protected" | "scanning" | "info" | "unknown";

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
  info:      { label: "Info",        colorVar: "var(--muted)",             softVar: "transparent",                   lineVar: "var(--border-strong)" },
  unknown:   { label: "Unavailable", colorVar: "var(--status-unknown)",    softVar: "transparent",                   lineVar: "var(--border-strong)" },
};

// i18n key per status (2026-07-23) — `t` optional/trailing; omitting it returns `meta` completely
// unchanged (byte-identical to today), which is what the identity-pinning statusMeta tests rely on.
const STATUS_KEY: Record<Status, string> = {
  ready: "ready",
  attention: "attention",
  danger: "critical",
  protected: "protected",
  scanning: "scanning",
  info: "info",
  unknown: "unavailable",
};

export function statusMeta(status: Status, t?: TFunction): StatusMeta {
  const meta = MAP[status] ?? MAP.unknown;
  if (!t) return meta;
  const key = STATUS_KEY[status] ?? STATUS_KEY.unknown;
  return { ...meta, label: t(`common.status.${key}`, { defaultValue: meta.label }) };
}
