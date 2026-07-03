// Pure camera-fit math for the rig hologram (used by RigHologram's <FitCamera>). Kept out of the
// react-three-fiber component so it's unit-testable without a WebGL context.
//
// Given the container's aspect (canvas width / height), return the camera's distance from the model
// that keeps the WHOLE rig in frame at any container size/shape:
//   • at or above the reference aspect (a normal / landscape stage) the base framing distance is
//     used UNCHANGED — cameraDist behavior is preserved;
//   • below it (a narrow / tall column, or a small / minimized window) the camera pulls back
//     proportionally so the model never clips left/right.
//
// The guarantee: below the reference, dist * aspect == baseDist * REF is held constant — i.e. the
// horizontal world-extent the camera sees is fixed, which is exactly what keeps the rig's width in
// frame no matter how narrow the container gets.
export const FIT_REF_ASPECT = 1.2;

export function fitCameraDistance(baseDist: number, aspect: number): number {
  if (!(aspect > 0) || !isFinite(aspect)) return baseDist; // degenerate/zero size → base framing
  return aspect >= FIT_REF_ASPECT ? baseDist : baseDist * (FIT_REF_ASPECT / aspect);
}
