import { useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import HolographicMaterial from "../../design/vendor/HolographicMaterial/HolographicMaterial";
import { readHologramV2 } from "../../design/theme";
import type { HardwareInfo } from "../../App";
import type { Efficacy } from "../../types";
import { buildRigParts } from "./rig-parts";
import { useRigColors, partColor } from "./use-rig-colors";
import { useReducedMotion } from "../../design/use-motion";
import { RigCase } from "./RigCase";
import { RigPart } from "./RigPart";
import { FitCamera } from "./RigHologram";
import { partGlow } from "../two-futures-view";

// Two Futures — ONE canvas, two offset groups (the spec's builder's-call): the SAME procedural
// rig from live HardwareInfo twice. Left = baseline in the theme's faint ghost ink; right =
// "now" in full theme accent with the v2 holo treatment (when compy_hologram_v2 is on), parts
// emphasized ONLY by measured per-component efficacy (partGlow — neutral without data).
//
// This module never sees a number to invent: the host (TwoFutures.tsx) enforces the
// no-measured-pair→no-render law and hands in the efficacy struct; geometry/colour here is
// presentation over it. No fans (they carry no before/after data, and the fan poll is the
// T1.5 idle-repaint class), no manual parts, no glitch.
//
// Perf: frameloop="demand" ALWAYS — a static two-pose costs zero idle GPU (stricter than the
// bay: no orbit opt-in here). Drags/resizes invalidate and repaint. Reduced motion: no orbit
// controls at all (static two-pose), shell fully static.

export default function TwoFuturesScene({
  hw,
  efficacy,
}: {
  hw: HardwareInfo;
  efficacy: Efficacy;
}) {
  const colors = useRigColors();
  const reduced = useReducedMotion();
  const parts = useMemo(() => buildRigParts(hw), [hw]);
  // Read once per mount — Settings remounts this surface on nav (same idiom as the bay).
  const [holoV2] = useState(readHologramV2);

  // "Now" side: detected parts cycle the theme palette (the bay's colour rule).
  const nowColors = useMemo(() => {
    let detectedIndex = 0;
    return parts.map((p) => {
      const c = partColor(colors, p.detected, detectedIndex);
      if (p.detected) detectedIndex += 1;
      return c;
    });
  }, [parts, colors]);

  const noop = () => {};

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 1.6, 13.8], fov: 45 }}
    >
      <ambientLight intensity={0.7} />
      <pointLight position={[5, 5, 5]} intensity={55} color={colors.palette[0]} />
      <pointLight position={[-6, -1, 4]} intensity={38} color={colors.palette[1]} />
      <pointLight position={[0, 6, -4]} intensity={28} color={colors.accent} />

      {/* Baseline — the same rig, desaturated to the theme's faint ghost ink (no new palette). */}
      <group position={[-3.1, 0.2, 0]}>
        <RigCase exploded={false} color={colors.ghost} reduced={reduced} />
        {parts.map((p, i) => (
          <RigPart
            key={`base-${p.id}`}
            part={p}
            index={i}
            color={colors.ghost}
            exploded={false}
            selectedId={null}
            hoveredId={null}
            reduced={reduced}
            onSelect={noop}
            onHover={noop}
          />
        ))}
      </group>

      {/* Now — full theme accent; v2 holo shell (with the viewer-facing clear spot) when the
          bay v2 flag is on; part glow scaled ONLY by measured per-component efficacy.
          enableBlinking FALSE + fresnelOpacity 0.42: same fix as the bay shell — the upstream
          per-frame blink hash pumps the whole additive DoubleSide shell in single frames
          (owner clip 2026-07-08; holo-shell-blink-guard.test.ts pins every mount). */}
      <group position={[3.1, 0.2, 0]}>
        {holoV2 && (
          <mesh>
            <boxGeometry args={[4.15, 5.35, 2.55]} />
            <HolographicMaterial
              hologramColor={colors.accent}
              hologramOpacity={0.18}
              hologramBrightness={0.9}
              fresnelAmount={0.6}
              fresnelOpacity={0.42}
              scanlineSize={9}
              signalSpeed={reduced ? 0 : 0.4}
              enableBlinking={false}
              blinkFresnelOnly
              clearSpot={0.85}
              side="DoubleSide"
            />
          </mesh>
        )}
        <RigCase exploded={false} color={colors.accent} reduced={reduced} />
        {parts.map((p, i) => (
          <RigPart
            key={`now-${p.id}`}
            part={p}
            index={i}
            color={nowColors[i]}
            exploded={false}
            selectedId={null}
            hoveredId={null}
            reduced={reduced}
            onSelect={noop}
            onHover={noop}
            glow={partGlow(efficacy, p.id)}
          />
        ))}
      </group>

      {[-3.1, 3.1].map((x) => (
        <mesh key={x} position={[x, -2.75, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.4, 2.7, 64]} />
          <meshBasicMaterial
            color={x < 0 ? colors.ghost : colors.accent}
            transparent
            opacity={0.5}
          />
        </mesh>
      ))}
      <Grid
        position={[0, -2.78, 0]}
        args={[40, 40]}
        cellSize={0.6}
        cellThickness={0.6}
        cellColor={colors.palette[0]}
        sectionSize={3}
        sectionThickness={1}
        sectionColor={colors.accent}
        fadeDistance={28}
        fadeStrength={4}
        infiniteGrid
      />

      {!reduced && (
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={7}
          maxDistance={30}
          minPolarAngle={0.2}
          maxPolarAngle={Math.PI / 1.9}
          // Azimuth clamped (self-review catch): the DOM "Baseline"/"Now" heads are fixed, so
          // the camera must never rotate far enough to swap which rig sits on-screen left vs
          // right (swap point is ±90° — ±60° keeps a clear margin).
          minAzimuthAngle={-Math.PI / 3}
          maxAzimuthAngle={Math.PI / 3}
          autoRotate={false}
          target={[0, 0.2, 0]}
        />
      )}
      <FitCamera baseDist={13.8} />
    </Canvas>
  );
}
