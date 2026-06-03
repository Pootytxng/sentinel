import "./Card.css";
import type { ReactNode } from "react";

export function Card({ children, interactive, className = "" }: { children: ReactNode; interactive?: boolean; className?: string }) {
  return <div className={`ds-card ${interactive ? "is-interactive" : ""} ${className}`}>{children}</div>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ds-panel ${className}`}>{children}</div>;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="ds-section-head">
      <h3>{title}</h3>
      {right}
    </div>
  );
}
