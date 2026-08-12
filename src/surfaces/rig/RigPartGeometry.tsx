import { Edges } from "@react-three/drei";
import { Mesh } from "three";
import type { RigPartKind, Vec3 } from "./rig-parts";

// Holographic wireframe geometry per part kind (adapted from the HoloForge prototype). Colour is the
// theme-resolved hex (useRigColors). `detected:false` ghosts render extra-faint — present but
// unreadable — so the honesty reads visually, not just in the label.

const HALF_PI = Math.PI / 2;

// A mesh wearing this contributes no raycast hits, so the pointer passes straight through it to
// whatever is behind. Module-level so the prop identity never changes: r3f re-commits (and
// invalidates the demand-mode canvas) on referentially-new mesh props, and this file is inside the
// resting hologram's zero-idle-cost budget.
export const NO_HIT = () => null;
/** three's own mesh raycast, named so the prop is always set explicitly — handing r3f `undefined`
    leaves whatever was there before, which would strand a mesh as unhittable after a flip. */
const DEFAULT_HIT = Mesh.prototype.raycast;

function fill(active: boolean, detected: boolean) {
  if (!detected) return active ? 0.13 : 0.05; // honest ghost: barely there
  return active ? 0.32 : 0.16;
}

interface BoxProps {
  args: Vec3;
  position?: Vec3;
  rotation?: Vec3;
  color: string;
  active: boolean;
  detected: boolean;
  /** Measured-emphasis multiplier on the emissive glow (Two Futures: per-component
      efficacy delta). 1 = neutral — existing callers render unchanged. */
  glow?: number;
  /** Drawn, but invisible to the pointer — see NO_HIT. */
  noHit?: boolean;
}

function HoloBox({ args, position, rotation, color, active, detected, glow = 1, noHit }: BoxProps) {
  return (
    <mesh position={position} rotation={rotation} raycast={noHit ? NO_HIT : DEFAULT_HIT}>
      <boxGeometry args={args} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={(detected ? (active ? 1.5 : 0.7) : 0.35) * glow}
        transparent
        opacity={fill(active, detected)}
        roughness={0.3}
        metalness={0.1}
        depthWrite={false}
      />
      <Edges threshold={12} color={color} />
    </mesh>
  );
}

function HoloCyl({
  radius,
  height,
  position,
  rotation,
  color,
  active,
  detected,
  glow = 1,
  segments = 28,
  noHit,
}: {
  radius: number;
  height: number;
  position?: Vec3;
  rotation?: Vec3;
  color: string;
  active: boolean;
  detected: boolean;
  glow?: number;
  segments?: number;
  noHit?: boolean;
}) {
  return (
    <mesh position={position} rotation={rotation} raycast={noHit ? NO_HIT : DEFAULT_HIT}>
      <cylinderGeometry args={[radius, radius, height, segments]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={(detected ? (active ? 1.5 : 0.7) : 0.35) * glow}
        transparent
        opacity={fill(active, detected) - 0.01}
        roughness={0.3}
        metalness={0.1}
        depthWrite={false}
      />
      <Edges threshold={12} color={color} />
    </mesh>
  );
}

export function RigPartGeometry({
  kind,
  color,
  active,
  detected,
  glow = 1,
  pointerThrough = false,
}: {
  kind: RigPartKind;
  color: string;
  active: boolean;
  detected: boolean;
  /** Measured-emphasis glow multiplier (1 = neutral; only Two Futures passes ≠1, and only
      from a per-component efficacy row — never implied without data). */
  glow?: number;
  /** This part stands between the camera and a real, detected one, so the geometry that covers it
      must let the pointer through — drawn exactly as before, just not raycast. Only the mounting
      face passes through where a kind HAS one: a cooler's fin stack towers well clear of the socket
      and stays clickable in its own right, which is how the cooler keeps its own honest
      "nothing to read here" card. Set from `clickThroughIds` in RigHologram, evidence-map only. */
  pointerThrough?: boolean;
}) {
  const p = { color, active, detected, glow, noHit: pointerThrough };
  // The tower above the socket blocks nothing, so it keeps its hitbox even when the base gives up.
  const clear = { ...p, noHit: false };
  switch (kind) {
    case "board":
      return (
        <group>
          <HoloBox args={[2.6, 3.2, 0.06]} {...p} />
          <HoloBox args={[0.55, 0.8, 0.2]} position={[-0.9, 1.2, 0.13]} {...p} />
          <HoloBox args={[2.0, 0.18, 0.2]} position={[0.1, 1.5, 0.13]} {...p} />
          <HoloBox args={[0.7, 0.7, 0.08]} position={[0, 0.7, 0.08]} {...p} />
          <HoloBox args={[0.6, 0.6, 0.12]} position={[0.6, -0.9, 0.13]} {...p} />
          <HoloBox args={[1.7, 0.08, 0.14]} position={[-0.1, -0.2, 0.12]} {...p} />
          <HoloBox args={[1.7, 0.08, 0.14]} position={[-0.1, -0.55, 0.12]} {...p} />
        </group>
      );
    case "cpu":
      return (
        <group>
          <HoloBox args={[0.56, 0.56, 0.05]} {...p} />
          <HoloBox args={[0.38, 0.46, 0.07]} position={[0, 0, 0.04]} {...p} />
          <HoloBox args={[0.5, 0.04, 0.02]} position={[0, -0.32, -0.02]} {...p} />
        </group>
      );
    case "cooler":
      return (
        <group>
          <HoloBox args={[0.62, 0.62, 0.3]} {...p} />
          <HoloCyl radius={0.22} height={0.34} rotation={[HALF_PI, 0, 0]} {...p} />
          <HoloBox args={[1.9, 0.55, 0.16]} position={[0, 1.0, 0]} {...clear} />
          {[-0.6, 0, 0.6].map((x) => (
            <HoloCyl
              key={x}
              radius={0.22}
              height={0.18}
              position={[x, 1.0, 0]}
              rotation={[0, 0, HALF_PI]}
              {...clear}
            />
          ))}
        </group>
      );
    case "ram":
      return (
        <group>
          <HoloBox args={[0.12, 1.0, 0.46]} {...p} />
          <HoloBox args={[0.13, 0.12, 0.46]} position={[0, 0.56, 0]} {...p} />
        </group>
      );
    case "gpu":
      return (
        <group>
          <HoloBox args={[2.4, 0.46, 0.95]} {...p} />
          <HoloBox args={[2.3, 0.06, 0.72]} position={[0, -0.3, 0]} {...p} />
          {[-0.72, 0, 0.72].map((x) => (
            <HoloCyl key={x} radius={0.3} height={0.06} position={[x, 0.25, 0]} {...p} />
          ))}
          <HoloBox args={[0.06, 0.7, 0.95]} position={[-1.2, -0.1, 0]} {...p} />
        </group>
      );
    case "storage":
      return (
        <group>
          <HoloBox args={[1.1, 0.05, 0.42]} {...p} />
          <HoloBox args={[0.22, 0.09, 0.34]} position={[0.28, 0.06, 0]} {...p} />
          <HoloBox args={[0.22, 0.09, 0.34]} position={[-0.05, 0.06, 0]} {...p} />
          <HoloBox args={[0.1, 0.07, 0.3]} position={[-0.45, 0.05, 0]} {...p} />
        </group>
      );
    case "psu":
      return (
        <group>
          <HoloBox args={[2.4, 0.88, 1.32]} {...p} />
          <HoloCyl radius={0.36} height={0.06} position={[0, 0.45, 0]} {...p} />
          <HoloBox args={[0.7, 0.5, 0.02]} position={[0.7, 0, 0.67]} {...p} />
        </group>
      );
    default:
      return null;
  }
}
