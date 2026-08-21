import { useState } from "react";
import { useReducedMotion } from "../use-motion";
import "./dock.css";

export type DockNode = {
  key: string;
  name: string;
  icon?: string;
  primary?: boolean;
  measured?: boolean;
  /** One plain sentence saying WHEN you come to this station ("Your aim feels a beat behind.").
   *  When any node carries one, the dock renders a caption line under the row — the hovered
   *  node's, else the open node's, else the primary's — so six equal buttons stop being a quiz
   *  (Test's intimidation pass, 2026-08-21). Omit on every node and the DOM is unchanged. */
  hint?: string;
};

export function Dock({
  nodes,
  activeKey,
  onOpen,
  primaryEyebrow,
}: {
  nodes: DockNode[];
  activeKey: string | null;
  onOpen: (key: string) => void;
  /** A short sans label drawn above the primary node's icon ("Start here"). Optional: Home's dock
   *  passes nothing and renders exactly as before. */
  primaryEyebrow?: string;
}) {
  const reduced = useReducedMotion();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const captionNode =
    nodes.find((n) => n.key === hoverKey && n.hint) ??
    nodes.find((n) => n.key === activeKey && n.hint) ??
    nodes.find((n) => n.primary && n.hint) ??
    null;
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
          onPointerEnter={n.hint ? () => setHoverKey(n.key) : undefined}
          onPointerLeave={n.hint ? () => setHoverKey(null) : undefined}
          onFocus={n.hint ? () => setHoverKey(n.key) : undefined}
          onBlur={n.hint ? () => setHoverKey(null) : undefined}
        >
          {n.primary && primaryEyebrow && <span className="dock-eyebrow">{primaryEyebrow}</span>}
          {n.icon && (
            <span className="dock-ic" aria-hidden="true">
              {n.icon}
            </span>
          )}
          <span className="dock-nm">{n.name}</span>
          <span className={`dock-led ${n.measured ? "dock-led-on" : ""}`} aria-hidden="true" />
        </button>
      ))}
      {captionNode && (
        <p className="dock-caption" aria-live="polite">
          <span className="dock-caption-nm">{captionNode.name}</span>
          {" · "}
          {captionNode.hint}
        </p>
      )}
    </div>
  );
}
export default Dock;
