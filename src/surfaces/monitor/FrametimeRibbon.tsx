import { useEffect, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useReducedMotion } from "../../design/use-motion";
import { useRigColors } from "../rig/use-rig-colors";
import { ribbonProfile, RIBBON_SPAN_X } from "./ribbon-profile";

// FrametimeRibbon — Monitor v3's hero (owner-chosen concept 2026-07-10, plan
// 2026-07-10-monitor-v3-ribbon Task 3): the frametime history as a true 3D ribbon you can orbit,
// spikes rising as peaks with markers, a translucent frame-budget plane at the rig's own budget.
// HONEST 3D: the ribbon IS the data — geometry extruded from the real per-frame window
// (ribbon-profile, one vertex per sample, zero-baseline proportions); nothing decorative moves
// the samples. The worst-spike ms CALLOUT deliberately lives ONCE — in the 2D strip's caption
// below (one-mention law); here it is geometry only (the worst peak wears the larger marker).
//
// Perf (idle-canvas law): frameloop="demand" ALWAYS — repaints happen only when the 1 Hz poll
// hands a new window (tree change ⇒ r3f invalidates) or while the user orbits (drei controls
// invalidate in demand mode). At rest this canvas draws nothing. No auto-rotation ever; reduced
// motion snaps orbit (no damping decay). Colors resolve from the live theme like the rig bay
// (three.js can't read CSS vars — the same sanctioned literal-fallback pattern as use-rig-colors).

const DEPTH = 0.35;

// Warn ink for spike markers, resolved from the theme like use-rig-colors does.
function readWarn(): string {
  if (typeof document === "undefined") return "#f5c542";
  const got = getComputedStyle(document.documentElement).getPropertyValue("--v2-warn").trim();
  return got || "#f5c542";
}

function ribbonGeometry(top: { x: number; y: number }[]): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(top[0].x, 0);
  for (const p of top) shape.lineTo(p.x, Math.max(p.y, 0.001));
  shape.lineTo(top[top.length - 1].x, 0);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false });
}

export function FrametimeRibbon({
  samples,
  budget,
}: {
  /** The backend's real per-frame window (recent_frametimes_ms), newest last. */
  samples: number[];
  /** Frame budget in ms (1000/refreshHz) — the translucent plane. */
  budget?: number;
}) {
  const reduced = useReducedMotion();
  const colors = useRigColors();
  const warn = useMemo(readWarn, []);
  const profile = useMemo(() => ribbonProfile(samples, budget), [samples, budget]);
  const geom = useMemo(() => (profile ? ribbonGeometry(profile.top) : null), [profile]);
  // Rebuilt every sample batch — dispose the replaced geometry (r3f only auto-disposes on unmount).
  useEffect(() => () => geom?.dispose(), [geom]);

  // The parent gates on samples.length >= 2, but stay honest standalone: nothing real ⇒ nothing.
  if (!profile || !geom) return null;

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 2.4, 7.5], fov: 40 }}
    >
      <ambientLight intensity={0.8} />
      <pointLight position={[4, 6, 6]} intensity={40} color="#e8edf6" />
      <pointLight position={[-5, 3, -3]} intensity={25} color={colors.accent} />

      <group position={[0, -0.9, 0]}>
        <mesh geometry={geom} position={[0, 0, -DEPTH / 2]}>
          <meshStandardMaterial
            color={colors.accent}
            transparent
            opacity={0.55}
            emissive={colors.accent}
            emissiveIntensity={0.25}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* The rig's frame budget — spikes are the peaks that pierce this plane. */}
        {profile.budgetY != null && (
          <mesh position={[0, profile.budgetY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[RIBBON_SPAN_X + 0.6, 1.4]} />
            <meshBasicMaterial
              color={warn}
              transparent
              opacity={0.14}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* Exact-moment spike markers: a cone pointing down at each spike's own sample x;
            the worst spike wears the larger marker (its ms value reads in the strip caption). */}
        {profile.spikes.map((s) => (
          <mesh key={s.i} position={[s.x, s.y + 0.26, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={s.worst ? [0.12, 0.3, 8] : [0.07, 0.18, 8]} />
            <meshBasicMaterial color={warn} />
          </mesh>
        ))}

        <Grid
          position={[0, -0.01, 0]}
          args={[24, 24]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor={colors.palette[0]}
          sectionSize={2.5}
          sectionThickness={0.9}
          sectionColor={colors.accent}
          fadeDistance={20}
          fadeStrength={4}
          infiniteGrid
        />
      </group>

      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping={!reduced}
        minDistance={4}
        maxDistance={16}
        minPolarAngle={0.15}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0.3, 0]}
      />
    </Canvas>
  );
}

export default FrametimeRibbon;
