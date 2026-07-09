import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// FlyCamera — the shared "camera glides to the focused thing, look-at eases with it" primitive,
// lifted out of HardwareTourScene's TourCamera (spec 2026-07-08-lab-proving-ground §3: the gallery
// needs the exact fly-to-a-piece motion the onboarding tour already had). One source, two callers:
// the onboarding tour (overview ⇄ showcase) and the telemetry gallery (overview ⇄ any focused
// piece). Motion-aware: under reduced motion it snaps (k = 1) instead of easing.
//
// Behaviour is byte-identical to the old TourCamera math: lerp the camera position toward `target`
// and a persisted look vector toward `look`, each frame, at rate `min(1, delta * speed)` (snap when
// reduced). Rendering nothing — it only drives state.camera.
export function FlyCamera({
  target,
  look,
  reduced,
  speed = 2.2,
}: {
  /** World-space position the camera eases toward. */
  target: THREE.Vector3;
  /** World-space point the camera eases its look-at toward. */
  look: THREE.Vector3;
  reduced: boolean;
  /** Ease rate (higher = snappier). The tour used 2.2; the gallery keeps it. */
  speed?: number;
}) {
  // The look-at is integrated separately from the camera so both ease together (a raw camera.lookAt
  // every frame would snap the gaze while the body glides — the tour's original trick).
  const lookRef = useRef(new THREE.Vector3().copy(look));
  useFrame((state, delta) => {
    const k = reduced ? 1 : Math.min(1, delta * speed);
    state.camera.position.lerp(target, k);
    lookRef.current.lerp(look, k);
    state.camera.lookAt(lookRef.current);
  });
  return null;
}

export default FlyCamera;
