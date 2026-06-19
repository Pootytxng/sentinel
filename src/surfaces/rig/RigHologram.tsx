import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { invoke } from "@tauri-apps/api/core";
import type { HardwareInfo } from "../../App";
import { buildRigParts, type Vec3 } from "./rig-parts";
import { useRigColors, partColor } from "./use-rig-colors";
import { RigCase } from "./RigCase";
import { RigPart } from "./RigPart";
import { RigFan, type FanInfo } from "./RigFan";

// The 3D hologram canvas — the user's REAL rig, theme-aware, doctrine-safe:
//  • parts + specs come from buildRigParts(hw) (real hardware; honest ghosts), never fabricated.
//  • colours follow the active instrument theme (useRigColors).
//  • prefers-reduced-motion → no idle animation (frameloop "demand", parts snap, no auto-rotate).
//  • STEP-ASIDE: while a game is capturing (get_fps_status.active), drop to frameloop "demand" so the
//    hologram stops burning GPU in the background — anti-cheat-safe (ETW read only, no injection).

interface Props {
  hw: HardwareInfo;
  exploded: boolean;
  autoRotate: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

export function RigHologram({
  hw,
  exploded,
  autoRotate,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: Props) {
  const colors = useRigColors();
  const parts = useMemo(() => buildRigParts(hw), [hw]);
  const [reduced, setReduced] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  const [fanSensors, setFanSensors] = useState<{ label: string; rpm: number; source: string }[] | null>(
    null,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      invoke<{ active: boolean }>("get_fps_status")
        .then((s) => !cancelled && setGameActive(!!s?.active))
        .catch(() => {
          /* not under Tauri / sensor off — treat as inactive */
        });
    };
    poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Theme colour per part: detected parts cycle the palette; ghosts take the faint ink.
  const partColors = useMemo(() => {
    let detectedIndex = 0;
    return parts.map((p) => {
      const c = partColor(colors, p.detected, detectedIndex);
      if (p.detected) detectedIndex += 1;
      return c;
    });
  }, [parts, colors]);

  // Live fans — polled only while no game is capturing (the hologram is paused then anyway).
  useEffect(() => {
    if (gameActive) return;
    let cancelled = false;
    const poll = () => {
      invoke<{ label: string; rpm: number; source: string }[]>("get_fan_sensors")
        .then((f) => !cancelled && setFanSensors(f))
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [gameActive]);

  const fans: FanInfo[] = useMemo(() => {
    if (fanSensors && fanSensors.length > 0) {
      return fanSensors.map((s, i) => ({ id: `fan-${i}`, label: s.label, rpm: s.rpm, detected: true }));
    }
    // Nothing publishing → honest static ghosts (the "run a monitor" nudge lives in RigViewer).
    return [
      { id: "fan-ghost-cpu", label: "CPU fan", rpm: null, detected: false },
      { id: "fan-ghost-front", label: "Front intake", rpm: null, detected: false },
      { id: "fan-ghost-rear", label: "Rear exhaust", rpm: null, detected: false },
    ];
  }, [fanSensors]);

  const fanPlacements = useMemo(() => {
    const casePos: Vec3[] = [
      [-1.36, 0.85, 0.85],
      [-1.36, -0.15, 0.85],
      [-1.36, -1.05, 0.85],
      [1.36, 0.55, 0.85],
      [0, 2.0, 0.45],
    ];
    const caseExp: Vec3[] = [
      [3.4, 1.1, 0.9],
      [3.4, 0.1, 0.9],
      [3.4, -0.9, 0.9],
      [-3.4, 0.55, 0.9],
      [0, 3.6, 0.7],
    ];
    let ci = 0;
    return fans.map((f) => {
      if (/cpu/i.test(f.label)) {
        return { fan: f, assembled: [0.05, 1.15, 0.08] as Vec3, exploded: [0.3, 3.3, 0.7] as Vec3 };
      }
      const idx = ci++;
      return { fan: f, assembled: casePos[idx % casePos.length], exploded: caseExp[idx % caseExp.length] };
    });
  }, [fans]);

  const frameloop: "always" | "demand" = gameActive || reduced ? "demand" : "always";
  const orbiting = autoRotate && !gameActive && !reduced;

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0.6, 1.5, 9.5], fov: 45 }}
      onPointerMissed={() => onSelect("")}
    >
      <fogExp2 attach="fog" args={["#0a1320", 0.045]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[5, 5, 5]} intensity={55} color={colors.palette[0]} />
      <pointLight position={[-6, -1, 4]} intensity={38} color={colors.palette[1]} />
      <pointLight position={[0, 6, -4]} intensity={28} color={colors.accent} />

      <group position={[0, 0.2, 0]}>
        <RigCase exploded={exploded} color={colors.accent} reduced={reduced} />
        {parts.map((p, i) => (
          <RigPart
            key={p.id}
            part={p}
            index={i}
            color={partColors[i]}
            exploded={exploded}
            selectedId={selectedId}
            hoveredId={hoveredId}
            reduced={reduced}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
        {fanPlacements.map((fp) => (
          <RigFan
            key={fp.fan.id}
            fan={fp.fan}
            color={fp.fan.detected ? colors.palette[2] : colors.ghost}
            assembled={fp.assembled}
            exploded={fp.exploded}
            isExploded={exploded}
            reduced={reduced}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
      </group>

      <mesh position={[0, -2.75, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.4, 2.7, 64]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.5} />
      </mesh>
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

      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={18}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 1.9}
        autoRotate={orbiting}
        autoRotateSpeed={0.5}
        target={[0, 0.2, 0]}
      />
    </Canvas>
  );
}
