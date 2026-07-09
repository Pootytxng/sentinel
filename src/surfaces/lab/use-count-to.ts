import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";

// useCountTo — a tiny GSAP-driven numeric tween for the Lab's data-reactive gauges (spec
// 2026-07-09 Phase 1, Task 4). It exists to make "living data" HONEST: an animated value must
// trace to a REAL measured number. The contracts enforce that:
//
//   • target === null → the hook returns null. There is NO measured source, so the caller renders
//     NOTHING — never a placeholder/zero that animates (the honest-measurement LOCKED rule).
//   • reduced === true → the hook snaps to `target` with no tween (one value, no intermediate).
//     We gate on the app's resolved reduced-motion (passed in), NOT gsap.matchMedia / the OS
//     media query — Compy's motion OVERRIDES the OS reduce-motion setting
//     ([[motion-on-by-default-override-os]]), so reading the OS here would break that override.
//   • otherwise → the value tweens from its current position to `target` (caller rounds for the
//     display digit; the raw float drives a ring sweep).
export function useCountTo(target: number | null, opts?: { reduced?: boolean }): number | null {
  const reduced = opts?.reduced ?? false;
  const [value, setValue] = useState<number | null>(target);
  // The object GSAP mutates — keeps the tween's starting point across target changes so a re-tween
  // continues from where the last one left off (no snap-back to 0).
  const objRef = useRef<{ v: number }>({ v: target ?? 0 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  useEffect(() => {
    tweenRef.current?.kill();
    if (target == null) {
      // No measured source — signal "render nothing". Reset the tween origin so a later real
      // target counts up from 0, not from a stale value.
      objRef.current.v = 0;
      setValue(null);
      return;
    }
    if (reduced) {
      objRef.current.v = target;
      setValue(target);
      return;
    }
    tweenRef.current = gsap.to(objRef.current, {
      v: target,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => setValue(objRef.current.v),
    });
    return () => {
      tweenRef.current?.kill();
    };
  }, [target, reduced]);

  return value;
}

export default useCountTo;
