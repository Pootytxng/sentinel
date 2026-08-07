import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import type { Group } from "three";
import { RigPartGeometry } from "./RigPartGeometry";
import type { RigPart as Part } from "./rig-parts";
import { useTooltipFlip } from "./use-tooltip-flip";

// One interactive rig part: eases between assembled/exploded, scales up on hover/select, and shows a
// Compy-tokened spec card with the part's REAL specs. Tooltip styling uses the instrument tokens so
// it matches the active theme; the part's resolved colour tints its border/glow.

interface Props {
  part: Part;
  index: number;
  color: string;
  exploded: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  reduced: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  /** Measured-emphasis glow multiplier (Two Futures per-component efficacy; default 1 =
      neutral, existing hosts unchanged). */
  glow?: number;
  /** true → the part stands in front of a real, detected one, so the covering geometry stops
      taking raycast hits and clicks reach the part behind (see `shadowingGhostIds`). Every mesh
      here stops propagation, so without this the nearest one always wins. Default false —
      existing hosts are untouched. */
  pointerThrough?: boolean;
  /** false → the on-canvas spec card is suppressed while THIS part is the selected one, because
      the host is already showing its readings somewhere else (the Lab evidence panel). Hover cards
      for other parts are unaffected. Default true. */
  cardOnSelect?: boolean;
}

export function RigPart({
  part,
  index,
  color,
  exploded,
  selectedId,
  hoveredId,
  reduced,
  onSelect,
  onHover,
  glow = 1,
  pointerThrough = false,
  cardOnSelect = true,
}: Props) {
  const { t } = useTranslation();
  const groupRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const active = hovered || hoveredId === part.id || selectedId === part.id;
  const below = useTooltipFlip(groupRef, active);
  // The spec card and the Lab's evidence panel carry the same numbers, so only one of them speaks
  // for the selected part. Hovering a DIFFERENT part still gets its card.
  const showCard = active && (cardOnSelect || selectedId !== part.id);

  useFrame((state, delta) => {
    const g = groupRef.current;
    if (!g) return;
    const [tx, ty, tz] = exploded ? part.exploded : part.assembled;
    const bob = exploded && !reduced ? Math.sin(state.clock.elapsedTime * 0.8 + index) * 0.06 : 0;
    const k = reduced ? 1 : Math.min(1, delta * 3.5);
    g.position.x += (tx - g.position.x) * k;
    g.position.y += (ty + bob - g.position.y) * k;
    g.position.z += (tz - g.position.z) * k;

    const [rx, ry, rz] = exploded ? part.rotation ?? [0, 0, 0] : [0, 0, 0];
    const rk = reduced ? 1 : Math.min(1, delta * 2.5);
    g.rotation.x += (rx - g.rotation.x) * rk;
    g.rotation.y += (ry - g.rotation.y) * rk;
    g.rotation.z += (rz - g.rotation.z) * rk;

    const target = active ? 1.08 : 1;
    const s = reduced ? target : g.scale.x + (target - g.scale.x) * Math.min(1, delta * 8);
    g.scale.setScalar(s);
  });

  return (
    <group
      ref={groupRef}
      position={part.assembled}
      // Handlers are ALWAYS attached, even for a pass-through part: pointer transparency is done
      // per-mesh in RigPartGeometry (`raycast`), never by adding/removing handlers. Toggling them
      // re-registers the object with r3f's event system and re-commits its props, which invalidates
      // the demand-mode canvas — the resting bay must cost zero draws.
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onHover(part.id);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        setHovered(false);
        onHover(null);
        document.body.style.cursor = "auto";
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(part.id);
      }}
    >
      <RigPartGeometry
        kind={part.kind}
        color={color}
        active={active}
        detected={part.detected}
        glow={glow}
        pointerThrough={pointerThrough}
      />

      {showCard && (
        <Html position={[0, 0, 0]} center distanceFactor={8} zIndexRange={[100, 0]} style={{ pointerEvents: "none" }}>
          <div
            style={{
              width: 224,
              transform: below ? "translateY(55%)" : "translateY(-145%)",
              borderRadius: 10,
              border: `1px solid ${color}`,
              background: "var(--ix-glass-fill, rgba(12,14,20,0.92))",
              padding: "11px 12px",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              color: "var(--ix-text-1, #eef1f7)",
              boxShadow: `0 0 18px -2px ${color}`,
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.12em", color }}>
              {part.category}
              {!part.detected && t("gaming.rigViewer.notDetectedSuffix", { defaultValue: " · not detected" })}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{part.name}</div>
            <div style={{ fontSize: 11, color: "var(--ix-text-3, #8b95a8)", marginBottom: 8 }}>
              {part.tagline}
            </div>
            <div
              style={{
                borderTop: "1px solid var(--ix-glass-border, rgba(255,255,255,0.1))",
                paddingTop: 8,
                display: "grid",
                gap: 4,
              }}
            >
              {part.specs.map((spec) => (
                <div key={spec.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
                  <span style={{ color: "var(--ix-text-3, #8b95a8)" }}>{spec.label}</span>
                  <span style={{ fontWeight: 500, textAlign: "right" }}>{spec.value}</span>
                </div>
              ))}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
