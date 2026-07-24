import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { usePro, showsProFeature } from "../data/pro";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import "./ProGate.css";

// Gates a Pro-only feature. Inert while licensing is disarmed (renders children — everything is free
// today) OR if the user is Pro; shows a calm "Pro" note ONLY when armed + free. Never wrap safety —
// only genuinely-additive features (long-term history / multi-rig) per the ratified split.
export function ProGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { t } = useTranslation();
  const pro = usePro();
  if (showsProFeature(pro)) return <>{children}</>;
  return (
    <div className="progate" role="note">
      <span className="progate-badge">{t("optimize.proGate.badge")}</span>
      <p className="progate-text">{t("optimize.proGate.body", { feature })}</p>
    </div>
  );
}
