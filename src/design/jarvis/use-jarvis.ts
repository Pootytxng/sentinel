import { useReducedMotion } from "../use-motion";

// JARVIS motion layer — the one gate every JS effect in the layer mounts through.
// FOLDED INTO THE MOTION PREFERENCE (comprehensibility sweep 2026-08-20, issue #180): the
// separate compy_jarvis_motion flag is retired — the app's RESOLVED motion preference is the
// only condition. Motion=Full ⇒ the layer mounts; Reduced (or system-reduced under "Follow
// system") ⇒ nothing in the layer mounts and the DOM is byte-identical. Reactive to
// mid-session flips through useReducedMotion's event listeners.

export function useJarvisActive(): boolean {
  return !useReducedMotion();
}
