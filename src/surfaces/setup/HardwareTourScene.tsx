import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid } from "@react-three/drei";
import * as THREE from "three";
import type { Group } from "three";
import type { HardwareInfo } from "../../App";
import { buildRigParts, type RigPart, type Vec3 } from "../rig/rig-parts";
import { RigPartGeometry } from "../rig/RigPartGeometry";
import { useRigColors, partColor } from "../rig/use-rig-colors";

// The onboarding tour scene: the user's REAL rig, exploded, with the camera flying to whichever
// component the current lesson is about. Reuses the rig hologram's parts + geometry + theme bridge so
// it's the same hardware the user sees in the Rig view — never abstract. The focused part lights up
// and rotates; the rest stay faint in their exploded places. Motion- and step-aside-aware.

function TourPart({
  part,
  color,
  active,
  reduced,
}: {
  part: RigPart;
  color: string;
  active: boolean;
  reduced: boolean;
}) {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    const g = ref.current;
    if (!g) return;
    const target = active ? 1.55 : 0.82;
    const k = reduced ? 1 : Math.min(1, delta * 5);
    g.scale.setScalar(g.scale.x + (target - g.scale.x) * k);
    if (active && !reduced) g.rotation.y += delta * 0.45;
    else if (!active) g.rotation.y += (((part.rotation?.[1] ?? 0) - g.rotation.y) * k);
  });
  return (
    <group ref={ref} position={part.exploded} rotation={part.rotation ?? [0, 0, 0]}>
      <RigPartGeometry kind={part.kind} color={color} active={active} detected={part.detected} />
    </group>
  );
}

const OVERVIEW_CAM: Vec3 = [3.6, 2.6, 9.6];
const OVERVIEW_LOOK: Vec3 = [0, 0.2, 0];

function TourCamera({ focus, reduced }: { focus: RigPart | null; reduced: boolean }) {
  const look = useRef(new THREE.Vector3(...OVERVIEW_LOOK));
  const desired = useRef(new THREE.Vector3(...OVERVIEW_CAM));
  const target = useRef(new THREE.Vector3(...OVERVIEW_LOOK));
  useFrame((state, delta) => {
    if (focus) {
      const [x, y, z] = focus.exploded;
      desired.current.set(x + 2.3, y + 1.3, z + 4.7);
      target.current.set(x, y, z);
    } else {
      desired.current.set(...OVERVIEW_CAM);
      target.current.set(...OVERVIEW_LOOK);
    }
    const k = reduced ? 1 : Math.min(1, delta * 1.7);
    state.camera.position.lerp(desired.current, k);
    look.current.lerp(target.current, k);
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

  // Theme colour per part (detected parts cycle the palette; ghosts take the faint ink) — same scheme
  // as the Rig view so the two read as one hologram.
  const partColors = useMemo(() => {
    let detectedIndex = 0;
    return parts.map((p) => {
      const c = partColor(colors, p.detected, detectedIndex);
      if (p.detected) detectedIndex += 1;
      return c;
    });
  }, [parts, colors]);

  return (
    <Canvas
      frameloop={paused ? "demand" : "always"}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: OVERVIEW_CAM, fov: 45 }}
    >
      <fogExp2 attach="fog" args={["#0a1320", 0.04]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[5, 5, 5]} intensity={55} color={colors.palette[0]} />
      <pointLight position={[-6, -1, 4]} intensity={38} color={colors.palette[1]} />
      <pointLight position={[0, 6, -4]} intensity={28} color={colors.accent} />

      {parts.map((p, i) => (
        <TourPart key={p.id} part={p} color={partColors[i]} active={p.id === focusId} reduced={reduced} />
      ))}

      <Grid
        position={[0, -3.4, 0]}
        args={[40, 40]}
        cellSize={0.6}
        cellThickness={0.6}
        cellColor={colors.palette[0]}
        sectionSize={3}
        sectionThickness={1}
        sectionColor={colors.accent}
        fadeDistance={30}
        fadeStrength={4}
        infiniteGrid
      />

      <TourCamera focus={focus} reduced={reduced} />
    </Canvas>
  );
}
