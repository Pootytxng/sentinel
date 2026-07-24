import "./StatusPill.css";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { statusMeta, type Status } from "./status";

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const { t } = useTranslation();
  const m = statusMeta(status, t);
  const style = {
    ["--colorVar"]: m.colorVar,
    ["--softVar"]: m.softVar,
    ["--lineVar"]: m.lineVar,
  } as CSSProperties;
  return (
    <span className={`ds-pill is-${status}`} style={style}>
      <span className="ds-dot" />
      {label ?? m.label}
    </span>
  );
}
