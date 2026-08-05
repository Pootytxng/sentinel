import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Group } from "three";
import type { HardwareInfo } from "../../App";
import { buildRigParts, type RigPart, type RigPartKind } from "../rig/rig-parts";
import { RigPartGeometry } from "../rig/RigPartGeometry";
import { RigCase } from "../rig/RigCase";
import { useRigColors, partColor, type RigColors } from "../rig/use-rig-colors";
import { FlyCamera } from "../lab/fly-camera";
import { useDocumentVisible } from "../../data/use-document-visible";

// Onboarding tour scene — a CLEAN, single-component showcase (not the scattered exploded rig). Leg 1
// shows the machine assembled inside its case (calm turntable); Leg 2 isolates ONE real component at
// a time, normalized to a consistent on-screen size, centered above the HUD on a lit pedestal, with a
// smooth entrance between steps. Reuses the rig's real parts + geometry + theme bridge, so it's the
// same hardware the user sees in the Rig view — just composed for a guided walkthrough. Motion-aware.

// Per-kind scale that normalizes each part to ~2.2 units on screen (a tiny CPU and a big PSU read at a
// similar size, so framing is consistent step to step).
// Normalizes each part to ~1.7 units so even the widest (GPU, board) clears the contained stage with
// a generous margin on every side (no clipping, consistent step-to-step framing).
const SHOWCASE_SCALE: Record<RigPartKind, number> = {
  board: 0.5,
  cpu: 2.0,
  ram: 1.5,
  gpu: 0.7,
  storage: 1.35,
  psu: 0.64,
  cooler: 0.9,
};

// One isolated component: normalized scale, gentle turntable, a soft scale-in on mount (keyed per
// component so each step re-plays the entrance).
function Showcase({
  part,
  color,
  reduced,
  count = 1,
}: {
  part: RigPart;
  color: string;
  reduced: boolean;
  /** How many identical modules to render side-by-side (memory: the REAL stick count). */
  count?: number;
}) {
  const ref = useRef<Group>(null);
  const prog = useRef(0);
  const base = SHOWCASE_SCALE[part.kind] ?? 1;
  useFrame((state, delta) => {
    const g = ref.current;
    if (!g) return;
    // Reduced motion SNAPS the entrance rather than easing it: the scale-in is travel, and the
    // contract is "the thing still changes, it just doesn't fly there". This is also what makes the
    // frameloop switch below safe — under frameloop="demand" only one frame renders per commit, so
    // a part still mid-tween would freeze at ~73% scale forever.
    if (reduced) prog.current = 1;
    else if (prog.current < 1) prog.current = Math.min(1, prog.current + delta * 2.4);
    const ease = 1 - Math.pow(1 - prog.current, 3);
    const entrance = base * (0.72 + 0.28 * ease);
    if (reduced) {
      g.scale.setScalar(entrance);
      g.rotation.set(-0.12, 0.5, 0);
      g.position.y = 0;
      return;
    }
    // "Alive & breathing": a slow turntable + an organic nod/sway, a gentle float, and a subtle scale
    // breath layered on — so the part reads as living, not a still render.
    const t = state.clock.elapsedTime;
    g.rotation.y += delta * 0.28;
    g.rotation.x = -0.12 + Math.sin(t * 0.7) * 0.07;
    g.rotation.z = Math.sin(t * 0.45) * 0.05;
    g.position.y = Math.sin(t * 0.9) * 0.05;
    g.scale.setScalar(entrance * (1 + Math.sin(t * 1.1) * 0.018));
  });
  // Render `count` modules side-by-side (memory shows the rig's REAL stick count). The 0.42 gap clears
  // the 0.12-wide ram box; count===1 is a single centred part — unchanged for every other component.
  return (
    <group ref={ref} scale={base}>
      {Array.from({ length: Math.max(1, count) }, (_, idx) => (
        <group key={idx} position={[(idx - (count - 1) / 2) * 0.42, 0, 0]}>
          <RigPartGeometry kind={part.kind} color={color} active detected={part.detected} />
        </group>
      ))}
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
  return (
    <group ref={ref} position={[0, 0.35, 0]} rotation={[-0.04, 0.42, 0]}>
      <RigCase exploded={false} color={colors.accent} reduced={reduced} />
      {parts.map((p) => {
        const c = partColor(colors, p.detected, p.kind);
        // Assembled = axis-aligned (NO per-part tilt — that rotation is only for the exploded view).
        // Keeping it zeroed makes the parts nest cleanly like a real build instead of scrambling.
        return (
          <group key={p.id} position={p.assembled} rotation={[0, 0, 0]}>
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
    <group position={[0, -1.05, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.45, 1.58, 96]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[1.45, 72]} />
        <meshBasicMaterial color={color} transparent opacity={0.045} depthWrite={false} />
      </mesh>
    </group>
  );
}

// Subject sits at the origin (the content panel no longer overlaps the stage). Camera distance sets
// how much of the stage the part fills: at z≈5.6 / fov 36° the visible height is ~3.6 units, so a
// part normalized to ~1.7 units reads at ~half the stage height — substantial and centred, with a
// clear margin on every side (no clipping). Overview pulls back to frame the whole assembled rig.
const SHOWCASE_CAM = new THREE.Vector3(0, 0.4, 5.6);
const SHOWCASE_LOOK = new THREE.Vector3(0, 0, 0);
const OVERVIEW_CAM = new THREE.Vector3(0, 0.7, 9.4);
const OVERVIEW_LOOK = new THREE.Vector3(0, 0.1, 0);

// The tour camera is now just the shared FlyCamera pointed at one of two presets (overview ⇄ the
// isolated showcase). Same lerp math as before — FlyCamera was lifted straight out of here.
function TourCamera({ showcase, reduced }: { showcase: boolean; reduced: boolean }) {
  return (
    <FlyCamera
      target={showcase ? SHOWCASE_CAM : OVERVIEW_CAM}
      look={showcase ? SHOWCASE_LOOK : OVERVIEW_LOOK}
      reduced={reduced}
    />
  );
}

export function HardwareTourScene({
  hw,
  focusId,
  reduced,
}: {
  hw: HardwareInfo;
  focusId: string | null;
  reduced: boolean;
}) {
  const colors = useRigColors();
  const visible = useDocumentVisible();
  const parts = useMemo(() => buildRigParts(hw), [hw]);
  const focus = useMemo(() => parts.find((p) => p.id === focusId) ?? null, [parts, focusId]);
  // A detected part shows in the clean theme accent; an honest ghost (PSU) shows dimmer but still
  // composed — the honesty lives in the lesson copy, the visual stays tidy.
  const focusColor = focus && !focus.detected ? colors.ghost : colors.accent;

  // Q7 §399 — reduced motion and an unseen window stand the RENDER LOOP down, not just the
  // per-frame math. Skipping the rotation while frameloop stayed "always" was the worst of both:
  // full GPU cost producing an identical frame. Under "demand" r3f repaints on each React commit
  // (a new focus step, a theme change) and nothing in between, and every animation this scene owns
  // lands in that single frame under reduced motion — Showcase snaps its entrance (above),
  // FlyCamera snaps its ease (k = 1), AssembledRig's turntable is already skipped.
  //
  // No step-aside (game-active) axis here, deliberately: it would need a SECOND get_fps_status
  // poller while RigHologram already owns that stream (Q7 §398 — one owner per sensor), and this
  // canvas is a modal the user opened to look at, not ambient decoration. The case that actually
  // costs a game something — the tour left open behind a fullscreen game — is the visibility axis.
  const frameloop: "always" | "demand" = reduced || !visible ? "demand" : "always";

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [OVERVIEW_CAM.x, OVERVIEW_CAM.y, OVERVIEW_CAM.z], fov: 36 }}
    >
      <fogExp2 attach="fog" args={["#070b12", 0.06]} />
      <ambientLight intensity={0.65} />
      {/* Neutral keys (same rule as the bay): theme-tinted keys wash the per-part identity
          hues; the low fill keeps the accent for theme flavour. */}
      <pointLight position={[4, 5, 5]} intensity={45} color="#e8edf6" />
      <pointLight position={[-5, 1.5, 2]} intensity={22} color="#dfe6f2" />
      <pointLight position={[0, -2, 4]} intensity={12} color={colors.accent} />

      {focus ? (
        <Showcase
          key={focus.id}
          part={focus}
          color={focusColor}
          reduced={reduced}
          count={focus.kind === "ram" ? parts.filter((p) => p.kind === "ram").length : 1}
        />
      ) : (
        <AssembledRig parts={parts} colors={colors} reduced={reduced} />
      )}

      {focus && <Pedestal color={colors.accent} />}
      <TourCamera showcase={!!focus} reduced={reduced} />
    </Canvas>
  );
}
