import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Group } from "three";
import type { HardwareInfo } from "../../App";
import { buildRigParts, type RigPart, type RigPartKind } from "../rig/rig-parts";
import { RigPartGeometry } from "../rig/RigPartGeometry";
import { RigCase } from "../rig/RigCase";
import { useRigColors, partColor, type RigColors } from "../rig/use-rig-colors";

// Onboarding tour scene — a CLEAN, single-component showcase (not the scattered exploded rig). Leg 1
// shows the machine assembled inside its case (calm turntable); Leg 2 isolates ONE real component at
// a time, normalized to a consistent on-screen size, centered above the HUD on a lit pedestal, with a
// smooth entrance between steps. Reuses the rig's real parts + geometry + theme bridge, so it's the
// same hardware the user sees in the Rig view — just composed for a guided walkthrough. Motion-aware.

// Per-kind scale that normalizes each part to ~2.2 units on screen (a tiny CPU and a big PSU read at a
// similar size, so framing is consistent step to step).
const SHOWCASE_SCALE: Record<RigPartKind, number> = {
  board: 0.62,
  cpu: 2.6,
  ram: 1.9,
  gpu: 0.9,
  storage: 1.75,
  psu: 0.82,
  cooler: 1.15,
};

// One isolated component: normalized scale, gentle turntable, a soft scale-in on mount (keyed per
// component so each step re-plays the entrance).
function Showcase({ part, color, reduced }: { part: RigPart; color: string; reduced: boolean }) {
  const ref = useRef<Group>(null);
  const prog = useRef(0);
  const base = SHOWCASE_SCALE[part.kind] ?? 1;
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    if (prog.current < 1) prog.current = Math.min(1, prog.current + delta * 2.4);
    const ease = 1 - Math.pow(1 - prog.current, 3);
    g.scale.setScalar(base * (0.72 + 0.28 * ease));
    g.rotation.x = -0.12;
    g.rotation.y = reduced ? 0.5 : g.rotation.y + delta * 0.45;
  });
  return (
    <group position={[0, 0.9, 0]}>
      <group ref={ref} scale={base}>
        <RigPartGeometry kind={part.kind} color={color} active detected={part.detected} />
      </group>
    </group>
  );
}

// Leg 1 — the machine assembled inside its case, slow turntable. Recognisable "your PC", not a pile
// of floating parts.
function AssembledRig({ parts, colors, reduced }: { parts: RigPart[]; colors: RigColors; reduced: boolean }) {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (ref.current && !reduced) ref.current.rotation.y += delta * 0.16;
  });
  let detectedIndex = 0;
  return (
    <group ref={ref} position={[0, 0.35, 0]} rotation={[-0.05, 0.5, 0]}>
      <RigCase exploded={false} color={colors.accent} reduced={reduced} />
      {parts.map((p) => {
        const c = partColor(colors, p.detected, p.detected ? detectedIndex++ : 0);
        return (
          <group key={p.id} position={p.assembled} rotation={p.rotation ?? [0, 0, 0]}>
            <RigPartGeometry kind={p.kind} color={c} active={false} detected={p.detected} />
          </group>
        );
      })}
    </group>
  );
}

// A quiet pedestal under the subject — a glowing ring + faint disc. No busy infinite grid.
function Pedestal({ color }: { color: string }) {
  return (
    <group position={[0, -1.55, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.05, 2.2, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[2.05, 72]} />
        <meshBasicMaterial color={color} transparent opacity={0.045} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Camera aims BELOW the subject so it rides up into the clear upper third — clear of the HUD card,
// which covers the centre-bottom (otherwise wide/flat parts like the GPU hide behind it).
const SHOWCASE_CAM = new THREE.Vector3(0, 0.9, 5.6);
const SHOWCASE_LOOK = new THREE.Vector3(0, -0.6, 0);
const OVERVIEW_CAM = new THREE.Vector3(0, 0.8, 7.8);
const OVERVIEW_LOOK = new THREE.Vector3(0, -0.25, 0);

function TourCamera({ showcase, reduced }: { showcase: boolean; reduced: boolean }) {
  const look = useRef(new THREE.Vector3().copy(OVERVIEW_LOOK));
  useFrame((state, delta) => {
    const camTarget = showcase ? SHOWCASE_CAM : OVERVIEW_CAM;
    const lookTarget = showcase ? SHOWCASE_LOOK : OVERVIEW_LOOK;
    const k = reduced ? 1 : Math.min(1, delta * 2.2);
    state.camera.position.lerp(camTarget, k);
    look.current.lerp(lookTarget, k);
    state.camera.lookAt(look.current);
  });
  return null;
}

export function HardwareTourScene({
  hw,
  focusId,
  reduced,
  paused,
}: {
  hw: HardwareInfo;
  focusId: string | null;
  reduced: boolean;
  paused: boolean;
}) {
  const colors = useRigColors();
  const parts = useMemo(() => buildRigParts(hw), [hw]);
  const focus = useMemo(() => parts.find((p) => p.id === focusId) ?? null, [parts, focusId]);
  // A detected part shows in the clean theme accent; an honest ghost (PSU) shows dimmer but still
  // composed — the honesty lives in the lesson copy, the visual stays tidy.
  const focusColor = focus && !focus.detected ? colors.ghost : colors.accent;

  return (
    <Canvas
      frameloop={paused ? "demand" : "always"}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [OVERVIEW_CAM.x, OVERVIEW_CAM.y, OVERVIEW_CAM.z], fov: 42 }}
    >
      <fogExp2 attach="fog" args={["#070b12", 0.06]} />
      <ambientLight intensity={0.65} />
      <pointLight position={[4, 5, 5]} intensity={45} color={colors.accent} />
      <pointLight position={[-5, 1.5, 2]} intensity={22} color={colors.palette[1]} />
      <pointLight position={[0, -2, 4]} intensity={12} color={colors.accent} />

      {focus ? (
        <Showcase key={focus.id} part={focus} color={focusColor} reduced={reduced} />
      ) : (
        <AssembledRig parts={parts} colors={colors} reduced={reduced} />
      )}

      <Pedestal color={colors.accent} />
      <TourCamera showcase={!!focus} reduced={reduced} />
    </Canvas>
  );
}
