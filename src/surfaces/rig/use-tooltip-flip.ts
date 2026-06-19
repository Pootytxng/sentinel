import { useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Group } from "three";

const tmp = new THREE.Vector3();

// Keeps a part's hover tooltip inside the canvas. A tooltip normally floats ABOVE its part, which
// clips the top of the frame when the part is high on screen. Each frame (so it stays correct under
// orbit) we project the anchor to normalized screen space and, when it's in the top band, signal the
// tooltip to flip BELOW. Only re-renders when the flip actually changes — no per-frame setState.
export function useTooltipFlip(ref: React.RefObject<Group | null>, active: boolean): boolean {
  const [below, setBelow] = useState(false);
  const belowRef = useRef(false);
  useFrame((state) => {
    if (!active || !ref.current) return;
    ref.current.getWorldPosition(tmp).project(state.camera);
    // Placed ABOVE, the tooltip reaches ~2× its own height upward, so it clips the top unless the
    // anchor sits in the lower ~third of the view; placed BELOW it stays in frame down to about the
    // same point. So flip below for the whole upper ~65% (tmp.y is NDC: +1 top, -1 bottom).
    const shouldBelow = tmp.y > -0.3;
    if (shouldBelow !== belowRef.current) {
      belowRef.current = shouldBelow;
      setBelow(shouldBelow);
    }
  });
  return below;
}
