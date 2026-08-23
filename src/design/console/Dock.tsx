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
  layout = "grid",
}: {
  nodes: DockNode[];
  activeKey: string | null;
  onOpen: (key: string) => void;
  /** A short sans label drawn above the primary node's icon ("Start here"). Optional: Home's dock
   *  passes nothing and renders exactly as before. */
  primaryEyebrow?: string;
  /** "grid" (default) is the game-style action bar Home has always drawn -- omit the prop and the
   *  DOM is byte-identical to what it was. "list" is the ruled document row 04-test-approved.png
   *  draws: icon, name, the primary's eyebrow inline beside it, the station's own when-line under
   *  it, a chevron at the end. SAME <button> per station, same aria-pressed, same click and focus
   *  handlers -- the handoff requires the existing Dock keyboard behaviour survive this room, so
   *  the row is a restyle of the node, never a replacement for it. */
  layout?: "grid" | "list";
}) {
  const reduced = useReducedMotion();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const list = layout === "list";
  // In LIST layout every node prints its own when-line, so the shared caption would say a second
  // time what the hovered row already says an inch away -- the duplication the self-review rubric
  // rejects, and an aria-live region announcing text that is already on screen besides.
  const captionNode = list ? null :
    nodes.find((n) => n.key === hoverKey && n.hint) ??
    nodes.find((n) => n.key === activeKey && n.hint) ??
    nodes.find((n) => n.primary && n.hint) ??
    null;
  return (
    <div className="dock" data-layout={list ? "list" : undefined} data-motion={reduced ? "reduced" : "full"}>
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
          {list && n.hint && <span className="dock-hint">{n.hint}</span>}
          {list && (
            <span className="dock-go" aria-hidden="true">
              &rsaquo;
            </span>
          )}
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
