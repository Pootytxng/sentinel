import type { ReactNode } from "react";
import { usePro, showsProFeature } from "../data/pro";
import "./ProGate.css";

// Gates a Pro-only feature. Inert while licensing is disarmed (renders children — everything is free
// today) OR if the user is Pro; shows a calm "Pro" note ONLY when armed + free. Never wrap safety —
// only genuinely-additive features (long-term history / multi-rig) per the ratified split.
export function ProGate({ feature, children }: { feature: string; children: ReactNode }) {
  const pro = usePro();
  if (showsProFeature(pro)) return <>{children}</>;
  return (
    <div className="progate" role="note">
      <span className="progate-badge">Pro</span>
      <p className="progate-text">
        {feature} is part of Compy Pro. Everything safety-critical stays free.
      </p>
    </div>
  );
}
