import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Edges, Html } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import type { Group } from "three";
import type { Vec3 } from "./rig-parts";
import { useTooltipFlip } from "./use-tooltip-flip";

// A case/CPU fan in the hologram. Detected fans (real RPM from a monitor) SPIN — visibly conveying
// "on and working" — at a rate derived from their actual RPM (capped so it reads as motion, not an
// invisible blur). A stopped fan (0 RPM) doesn't spin; an undetected fan is a faint static ghost.
// reduced-motion → no spin. Honest throughout: we only spin what's truly reported.

export interface FanInfo {
  id: string;
  label: string;
  rpm: number | null; // null = not detected (ghost)
  detected: boolean;
}

const BLADES = 7;

function visualSpin(rpm: number): number {
  // rad/s, scaled down from true angular velocity and capped so even 2000 RPM reads as a clear spin.
  const trueRad = (rpm / 60) * Math.PI * 2;
  return Math.min(6, trueRad * 0.08);
}

export function RigFan({
  fan,
  color,
  assembled,
  exploded,
  isExploded,
  reduced,
  hoveredId,
  selectedId,
  onHover,
  onSelect,
}: {
  fan: FanInfo;
  color: string;
  assembled: Vec3;
  exploded: Vec3;
  isExploded: boolean;
  reduced: boolean;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const groupRef = useRef<Group>(null);
  const bladesRef = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const active = hovered || hoveredId === fan.id || selectedId === fan.id;
  const below = useTooltipFlip(groupRef, active);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (g) {
      const [tx, ty, tz] = isExploded ? exploded : assembled;
      const k = reduced ? 1 : Math.min(1, delta * 3.5);
      g.position.x += (tx - g.position.x) * k;
      g.position.y += (ty - g.position.y) * k;
      g.position.z += (tz - g.position.z) * k;
    }
    const b = bladesRef.current;
    if (b && fan.detected && fan.rpm && fan.rpm > 0 && !reduced) {
      b.rotation.z -= visualSpin(fan.rpm) * delta;
    }
  });

  const emissive = fan.detected ? (active ? 1.4 : 0.7) : 0.3;
  const op = fan.detected ? (active ? 0.32 : 0.17) : active ? 0.12 : 0.05;
  const mat = (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={emissive}
      transparent
      opacity={op}
      roughness={0.3}
      metalness={0.1}
      depthWrite={false}
    />
  );

  return (
    <group
      ref={groupRef}
      position={assembled}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(true);
        onHover(fan.id);
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
        onSelect(fan.id);
      }}
    >
      {/* Square fan frame */}
      <mesh>
        <boxGeometry args={[0.92, 0.92, 0.16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissive}
          transparent
          opacity={op * 0.7}
          roughness={0.3}
          metalness={0.1}
          depthWrite={false}
        />
        <Edges threshold={12} color={color} />
      </mesh>

      {/* Hub + blades (the rotating group) */}
      <group ref={bladesRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.2, 16]} />
          {mat}
        </mesh>
        {Array.from({ length: BLADES }).map((_, i) => (
          <mesh
            key={i}
            rotation={[0, 0, (i / BLADES) * Math.PI * 2]}
            position={[Math.cos((i / BLADES) * Math.PI * 2) * 0.26, Math.sin((i / BLADES) * Math.PI * 2) * 0.26, 0]}
          >
            <boxGeometry args={[0.34, 0.13, 0.02]} />
            {mat}
          </mesh>
        ))}
      </group>

      {active && (
        <Html position={[0, 0, 0]} center distanceFactor={8} zIndexRange={[100, 0]} style={{ pointerEvents: "none" }}>
          <div
            style={{
              width: 190,
              transform: below ? "translateY(55%)" : "translateY(-150%)",
              borderRadius: 10,
              border: `1px solid ${color}`,
              background: "var(--ix-glass-fill, rgba(12,14,20,0.92))",
              padding: "10px 12px",
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              color: "var(--ix-text-1, #eef1f7)",
              boxShadow: `0 0 18px -2px ${color}`,
              backdropFilter: "blur(8px)",
            }}
          >
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.12em", color }}>
              {t("gaming.rigViewer.fan.categoryLabel", { defaultValue: "Fan" })}
              {!fan.detected && t("gaming.rigViewer.notDetectedSuffix", { defaultValue: " · not detected" })}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{fan.label}</div>
            <div style={{ fontSize: 11, color: "var(--ix-text-3, #8b95a8)", marginTop: 3 }}>
              {fan.detected
                ? fan.rpm && fan.rpm > 0
                  ? t("gaming.rigViewer.fan.rpmSpinning", { defaultValue: "{{rpm}} RPM · spinning", rpm: fan.rpm })
                  : t("gaming.rigViewer.fan.rpmStopped", { defaultValue: "0 RPM · stopped" })
                : t("gaming.rigViewer.fan.noMonitorHint", {
                    defaultValue: "Run HWiNFO or LibreHardwareMonitor to read live RPM",
                  })}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}
