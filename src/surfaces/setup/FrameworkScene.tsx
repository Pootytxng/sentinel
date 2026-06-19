import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Edges, Html } from "@react-three/drei";
import * as THREE from "three";
import type { Group, Mesh } from "three";
import { HOME_RAIL, type HomeRailId } from "../../design/homeRail";
import { useRigColors, type RigColors } from "../rig/use-rig-colors";

// The holographic "inner framework of Compy": the six rooms as glowing data-nodes orbiting a central
// pulse core, wired to it. During the setup leg the whole rig drifts (overview); during the tour the
// active room rotates to the front and lights up while the others dim. Theme-aware (reuses the rig's
// CSS→hex bridge) and motion-aware (no spin/pulse under reduced-motion). Read-only eye-candy.

const RADIUS = 3.3;
const ANGLES = HOME_RAIL.map((_, i) => (i / HOME_RAIL.length) * Math.PI * 2);

function nodePos(i: number): [number, number, number] {
  return [RADIUS * Math.sin(ANGLES[i]), 0, RADIUS * Math.cos(ANGLES[i])];
}

function Core({ colors, reduced }: { colors: RigColors; reduced: boolean }) {
  const ref = useRef<Mesh>(null);
  const haloRef = useRef<Mesh>(null);
  useFrame((state) => {
    if (reduced) return;
    const t = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 1.6) * 0.06;
    if (ref.current) ref.current.scale.setScalar(pulse);
    if (haloRef.current) {
      haloRef.current.rotation.z = t * 0.4;
      const m = haloRef.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.25 + (Math.sin(t * 1.6) + 1) * 0.12;
    }
  });
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshStandardMaterial
          color={colors.accent}
          emissive={colors.accent}
          emissiveIntensity={1.4}
          transparent
          opacity={0.4}
          roughness={0.25}
          metalness={0.1}
          depthWrite={false}
        />
        <Edges threshold={12} color={colors.accent} />
      </mesh>
      <mesh ref={haloRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.15, 0.02, 8, 64]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Wire({ to, color }: { to: [number, number, number]; color: string }) {
  const geom = useMemo(
    () =>
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(to[0], to[1], to[2]),
      ]),
    [to],
  );
  return (
    <line>
      <primitive object={geom} attach="geometry" />
      <lineBasicMaterial color={color} transparent opacity={0.28} depthWrite={false} />
    </line>
  );
}

function RoomNode({
  index,
  label,
  color,
  active,
  dim,
  reduced,
}: {
  index: number;
  label: string;
  color: string;
  active: boolean;
  dim: boolean;
  reduced: boolean;
}) {
  const ref = useRef<Group>(null);
  const pos = nodePos(index);
  useFrame((state, delta) => {
    const g = ref.current;
    if (!g) return;
    const target = active ? 1.35 : 1;
    const k = reduced ? 1 : Math.min(1, delta * 6);
    const s = g.scale.x + (target - g.scale.x) * k;
    g.scale.setScalar(s);
    const bob = active && !reduced ? Math.sin(state.clock.elapsedTime * 1.2) * 0.07 : 0;
    g.position.set(pos[0], pos[1] + bob, pos[2]);
  });
  const emissive = active ? 1.7 : dim ? 0.35 : 0.8;
  const opacity = active ? 0.5 : dim ? 0.12 : 0.26;
  return (
    <group ref={ref} position={pos}>
      <mesh>
        <octahedronGeometry args={[0.62, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissive}
          transparent
          opacity={opacity}
          roughness={0.3}
          metalness={0.1}
          depthWrite={false}
        />
        <Edges threshold={12} color={color} />
      </mesh>
      <Html center distanceFactor={9} position={[0, -1.05, 0]} style={{ pointerEvents: "none" }}>
        <div
          style={{
            whiteSpace: "nowrap",
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: 13,
            fontWeight: active ? 700 : 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: active ? color : "var(--ix-text-3, #8b95a8)",
            textShadow: active ? `0 0 12px ${color}` : "none",
            opacity: dim ? 0.5 : 1,
            transition: "opacity 200ms ease, color 200ms ease",
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  );
}

function FrameworkRig({
  activeRoom,
  colors,
  reduced,
}: {
  activeRoom: HomeRailId | null;
  colors: RigColors;
  reduced: boolean;
}) {
  const groupRef = useRef<Group>(null);
  const activeIndex = activeRoom ? HOME_RAIL.findIndex((r) => r.id === activeRoom) : -1;
  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    if (activeIndex >= 0) {
      const target = -ANGLES[activeIndex];
      let diff = target - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest path
      g.rotation.y += diff * (reduced ? 1 : Math.min(1, delta * 3));
    } else if (!reduced) {
      g.rotation.y += delta * 0.16; // gentle overview drift
    }
  });
  return (
    <group ref={groupRef}>
      <Core colors={colors} reduced={reduced} />
      {HOME_RAIL.map((r, i) => {
        const color =
          activeIndex < 0
            ? colors.palette[i % colors.palette.length]
            : i === activeIndex
              ? colors.accent
              : colors.palette[i % colors.palette.length];
        return (
          <group key={r.id}>
            <Wire to={nodePos(i)} color={color} />
            <RoomNode
              index={i}
              label={r.label}
              color={color}
              active={i === activeIndex}
              dim={activeIndex >= 0 && i !== activeIndex}
              reduced={reduced}
            />
          </group>
        );
      })}
    </group>
  );
}

export function FrameworkScene({
  activeRoom,
  reduced,
  paused,
}: {
  activeRoom: HomeRailId | null;
  reduced: boolean;
  paused: boolean;
}) {
  const colors = useRigColors();
  return (
    <Canvas
      frameloop={paused ? "demand" : "always"}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [0, 1.4, 7.4], fov: 42 }}
    >
      <ambientLight intensity={0.8} />
      <pointLight position={[5, 6, 6]} intensity={30} />
      <pointLight position={[-5, -3, -4]} intensity={12} color={colors.palette[1]} />
      <FrameworkRig activeRoom={activeRoom} colors={colors} reduced={reduced} />
    </Canvas>
  );
}
