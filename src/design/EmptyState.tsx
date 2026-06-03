import "./cues.css";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyState({ icon, title, children, action }:
  { icon: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <span className="ds-eicon"><Icon name={icon} size={42} /></span>
      <b>{title}</b>
      {children}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}
