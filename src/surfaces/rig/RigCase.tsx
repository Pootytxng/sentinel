import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// The ATX case wireframe — the structural frame the real parts sit inside. Theme-accent coloured;
// fades back when exploded so the parts read. Assembled opacity sits low (owner directive
// 2026-07-07: the case must be see-through — the per-part identity colours carry the scene).

function WireBox({
  size,
  position,
  color,
  opacityRef,
}: {
  size: [number, number, number];
  position?: [number, number, number];
  color: string;
  opacityRef: React.MutableRefObject<number>;
}) {
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const geom = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)), [size]);
  useFrame(() => {
    if (matRef.current) matRef.current.opacity = opacityRef.current;
  });
  return (
    <lineSegments position={position} geometry={geom}>
      <lineBasicMaterial ref={matRef} color={color} transparent opacity={0.28} />
    </lineSegments>
  );
}

export function RigCase({
  exploded,
  color,
  reduced,
}: {
  exploded: boolean;
  color: string;
  reduced: boolean;
}) {
  const opacityRef = useRef(0.28);
  useFrame((_, delta) => {
    const target = exploded ? 0.12 : 0.28;
    opacityRef.current += (target - opacityRef.current) * (reduced ? 1 : Math.min(1, delta * 3));
  });
  return (
    <group>
      <WireBox size={[3.9, 5, 2.3]} color={color} opacityRef={opacityRef} />
      <WireBox size={[3.9, 1.1, 2.3]} position={[0, -1.95, 0]} color={color} opacityRef={opacityRef} />
      <WireBox size={[3.4, 4, 0.02]} position={[0.05, 0.45, -0.75]} color={color} opacityRef={opacityRef} />
      <WireBox size={[0.02, 4.6, 2.0]} position={[-1.94, 0, 0]} color={color} opacityRef={opacityRef} />
    </group>
  );
}
