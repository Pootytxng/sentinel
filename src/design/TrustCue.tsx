import "./cues.css";
import { Icon } from "./Icon";

export function TrustCue({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="ds-trust">
      <span className="ds-shield"><Icon name="shield" size={30} /></span>
      <div><b>{title}</b><div className="ds-sub">{detail}</div></div>
    </div>
  );
}
