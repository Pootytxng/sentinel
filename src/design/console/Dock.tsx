import { useReducedMotion } from "../use-motion";
import "./dock.css";

export type DockNode = {
  key: string;
  name: string;
  icon?: string;
  primary?: boolean;
  measured?: boolean;
};

export function Dock({
  nodes,
  activeKey,
  onOpen,
}: {
  nodes: DockNode[];
  activeKey: string | null;
  onOpen: (key: string) => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="dock" data-motion={reduced ? "reduced" : "full"}>
      {nodes.map((n) => (
        <button
          key={n.key}
          type="button"
          className={`dock-node ${n.primary ? "dock-node-primary" : ""} ${
            activeKey === n.key ? "dock-node-active" : ""
          }`}
          aria-pressed={activeKey === n.key}
          onClick={() => onOpen(n.key)}
        >
          {n.icon && (
            <span className="dock-ic" aria-hidden="true">
              {n.icon}
            </span>
          )}
          <span className="dock-nm">{n.name}</span>
          <span className={`dock-led ${n.measured ? "dock-led-on" : ""}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
export default Dock;
