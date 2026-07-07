import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom, Glitch } from "@react-three/postprocessing";
import { GlitchMode } from "postprocessing";
import { Vector2 } from "three";
import { invoke } from "@tauri-apps/api/core";
import HolographicMaterial from "../../design/vendor/HolographicMaterial/HolographicMaterial";
import { readHologramV2 } from "../../design/theme";
import type { HardwareInfo } from "../../App";
import { buildRigParts, type Vec3, type RigPart as RigPartData } from "./rig-parts";
import { nextFanSensors, type FanSensor } from "./fan-sensors";
import { type ManualPart, type ManualKind, manualGeom, manualPlacement } from "./manual-parts";
import { useRigColors, partColor } from "./use-rig-colors";
import { useReducedMotion } from "../../design/use-motion";
import { useDocumentVisible } from "../../data/use-document-visible";
import { fitCameraDistance } from "./camera-fit";
import { RigCase } from "./RigCase";
import { RigPart } from "./RigPart";
import { RigFan, type FanInfo } from "./RigFan";

// The 3D hologram canvas — the user's REAL rig, theme-aware, doctrine-safe:
//  • parts + specs come from buildRigParts(hw) (real hardware; honest ghosts), never fabricated.
//  • colours follow the active instrument theme (useRigColors).
//  • prefers-reduced-motion → no idle animation (frameloop "demand", parts snap, no auto-rotate).
//  • STEP-ASIDE: while a game is capturing (get_fps_status.active), drop to frameloop "demand" so the
//    hologram stops burning GPU in the background — anti-cheat-safe (ETW read only, no injection).

// Camera-fit: keep the whole rig in frame at ANY container size/shape (small/minimized window,
// narrow column, short stage). r3f already tracks the canvas size; here we read it and, when the
// container is narrower than the landscape framing the base distance assumes, pull the camera back
// proportionally so the model never clips left/right. At/above the reference aspect the base
// cameraDist is used unchanged (its framing behavior is preserved). Orbit angle + user zoom are
// preserved between resizes (we only scale the distance along the current view direction); a resize
// re-fits. invalidate() repaints even under frameloop="demand" (reduced motion / step-aside).
// Glitch config as module constants: r3f diffs object props by REFERENCE, so inline
// `new Vector2(...)` re-commits on every parent re-render and invalidates the resting
// demand-mode canvas (the 5s idle-repaint driver — HomeHud's live mem poll re-renders
// this tree; GL-draw-probe-proven). Same idle-repaint class as the fan-poll bail.
const GLITCH_DURATION = new Vector2(0.15, 0.35);
const GLITCH_DELAY = new Vector2(0, 0.1);
const GLITCH_STRENGTH = new Vector2(0.15, 0.4);

export function FitCamera({ baseDist }: { baseDist: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { update?: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const dist = fitCameraDistance(baseDist, aspect);
    // OrbitControls target — scale the camera's offset from it to `dist`, preserving orbit angle.
    const tx = 0,
      ty = 0.2,
      tz = 0;
    const dx = camera.position.x - tx;
    const dy = camera.position.y - ty;
    const dz = camera.position.z - tz;
    const cur = Math.hypot(dx, dy, dz) || 1;
    const k = dist / cur;
    // Reposition only (distance along the current view direction); r3f handles the projection
    // (aspect/fov) on resize, and OrbitControls.update() re-syncs its internal spherical.
    camera.position.set(tx + dx * k, ty + dy * k, tz + dz * k);
    controls?.update?.();
    invalidate();
  }, [size.width, size.height, baseDist, camera, controls, invalidate]);
  return null;
}

interface Props {
  hw: HardwareInfo;
  exploded: boolean;
  autoRotate: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  manualParts: ManualPart[];
  /** Initial camera distance. Default = the classic framing; the V2 hero stage pulls in closer
      so the model fills its bigger stage (additive — existing callers are untouched). */
  cameraDist?: number;
}

// Memoized: parents re-render on live polls (HomeHud's 5s mem/GPU tick), and ANY re-render
// that reaches the canvas re-commits referentially-new handler props on the meshes, which
// r3f invalidates — repainting the resting demand-mode bay (GL-draw-probe-proven, T1.5).
// With stable props the memo stops parent ticks at this boundary; the bay only re-renders
// on real prop changes or its own state (sensor changes, interaction).
export const RigHologram = memo(function RigHologram({
  hw,
  exploded,
  autoRotate,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  manualParts,
  cameraDist = 9.5,
}: Props) {
  const colors = useRigColors();
  const parts = useMemo(() => buildRigParts(hw), [hw]);
  const reduced = useReducedMotion();
  const visible = useDocumentVisible();
  const [gameActive, setGameActive] = useState(false);
  // Hologram bay v2 (T4d): holo-shader shell + Bloom + explode Glitch. Read once per mount —
  // Settings dispatches compy:hologram-v2-changed and the Home hero remounts on nav anyway.
  const [holoV2] = useState(readHologramV2);
  // Event-triggered glitch: a ~450ms burst when the bay explodes/reassembles — never continuous
  // (perf rail + honesty: the glitch marks a real state change, not ambient noise). Skipped
  // entirely under reduced motion.
  const [glitching, setGlitching] = useState(false);
  const firstExplode = useRef(true);
  useEffect(() => {
    if (firstExplode.current) {
      firstExplode.current = false;
      return;
    }
    if (!holoV2 || reduced) return;
    setGlitching(true);
    const id = window.setTimeout(() => setGlitching(false), 450);
    return () => window.clearTimeout(id);
  }, [exploded, holoV2, reduced]);
  const [fanSensors, setFanSensors] = useState<FanSensor[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      invoke<{ active: boolean }>("get_fps_status")
        .then((s) => !cancelled && setGameActive(!!s?.active))
        .catch(() => {
          /* not under Tauri / sensor off — treat as inactive */
        });
    };
    poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Once the user manually adds a kind (cooler/psu), suppress the matching honest ghost.
  const manualKinds = useMemo(() => new Set(manualParts.map((m) => m.kind)), [manualParts]);
  const shownParts = useMemo(
    () => parts.filter((p) => p.detected || !manualKinds.has(p.id as ManualKind)),
    [parts, manualKinds],
  );

  // Theme colour per part: detected parts cycle the palette; ghosts take the faint ink.
  const partColors = useMemo(() => {
    let detectedIndex = 0;
    return shownParts.map((p) => {
      const c = partColor(colors, p.detected, detectedIndex);
      if (p.detected) detectedIndex += 1;
      return c;
    });
  }, [shownParts, colors]);

  // User-added parts → RigPart shape, labelled "User-added" (never presented as detected).
  const manualRigParts: RigPartData[] = useMemo(() => {
    let otherIndex = 0;
    return manualParts.map((m) => {
      const place = manualPlacement(m.kind, m.kind === "other" ? otherIndex++ : 0);
      return {
        id: m.id,
        name: m.name || "User part",
        category: "User-added",
        kind: manualGeom(m.kind),
        detected: true,
        assembled: place.assembled,
        exploded: place.exploded,
        rotation: place.rotation,
        tagline: m.note || "Added by you",
        specs: [
          { label: "Source", value: "You added this" },
          ...(m.note ? [{ label: "Note", value: m.note }] : []),
        ],
      };
    });
  }, [manualParts]);

  // Live fans — polled only while no game is capturing (the hologram is paused then anyway).
  useEffect(() => {
    if (gameActive) return;
    let cancelled = false;
    const poll = () => {
      invoke<FanSensor[]>("get_fan_sensors")
        // Content-equal polls keep the previous reference (nextFanSensors) — a fresh-but-equal
        // array here re-renders the canvas tree and r3f invalidates, repainting the resting bay
        // every 2.5s (the T1.5 idle pulse; GL-draw-probe-proven). Real changes still repaint.
        .then((f) => !cancelled && setFanSensors((prev) => nextFanSensors(prev, f)))
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [gameActive]);

  const fans: FanInfo[] = useMemo(() => {
    if (fanSensors && fanSensors.length > 0) {
      return fanSensors.map((s, i) => ({ id: `fan-${i}`, label: s.label, rpm: s.rpm, detected: true }));
    }
    // Nothing publishing → honest static ghosts (the "run a monitor" nudge lives in RigViewer).
    return [
      { id: "fan-ghost-cpu", label: "CPU fan", rpm: null, detected: false },
      { id: "fan-ghost-front", label: "Front intake", rpm: null, detected: false },
      { id: "fan-ghost-rear", label: "Rear exhaust", rpm: null, detected: false },
    ];
  }, [fanSensors]);

  const fanPlacements = useMemo(() => {
    const casePos: Vec3[] = [
      [-1.36, 0.85, 0.85],
      [-1.36, -0.15, 0.85],
      [-1.36, -1.05, 0.85],
      [1.36, 0.55, 0.85],
      [0, 2.0, 0.45],
    ];
    const caseExp: Vec3[] = [
      [3.4, 1.1, 0.9],
      [3.4, 0.1, 0.9],
      [3.4, -0.9, 0.9],
      [-3.4, 0.55, 0.9],
      [0, 3.6, 0.7],
    ];
    let ci = 0;
    return fans.map((f) => {
      if (/cpu/i.test(f.label)) {
        return { fan: f, assembled: [0.05, 1.15, 0.08] as Vec3, exploded: [0.3, 3.3, 0.7] as Vec3 };
      }
      const idx = ci++;
      return { fan: f, assembled: casePos[idx % casePos.length], exploded: caseExp[idx % caseExp.length] };
    });
  }, [fans]);

  // Drop the WebGL render loop to on-demand whenever the user can't see it — during a game (step-aside),
  // under reduced-motion, OR while this window is hidden/minimized — so the orbiting hologram never
  // burns GPU off-screen. (Was the highest-cost hidden-work leak: a full-rate r3f canvas painting while
  // the window was occluded.)
  // V2 tightens the law to "idle GPU ~0": continuous frames run ONLY while something is genuinely
  // animating (the user-opted orbit, or a glitch burst); at rest the bay renders on demand — drags
  // and resizes invalidate, a still hologram costs nothing.
  const orbiting = autoRotate && !gameActive && !reduced;
  const frameloop: "always" | "demand" = holoV2
    ? (orbiting || glitching) && visible && !gameActive
      ? "always"
      : "demand"
    : gameActive || reduced || !visible
      ? "demand"
      : "always";

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0.6, 1.5, cameraDist], fov: 45 }}
      onPointerMissed={() => onSelect("")}
    >
      <fogExp2 attach="fog" args={["#0a1320", 0.045]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[5, 5, 5]} intensity={55} color={colors.palette[0]} />
      <pointLight position={[-6, -1, 4]} intensity={38} color={colors.palette[1]} />
      <pointLight position={[0, 6, -4]} intensity={28} color={colors.accent} />

      <group position={[0, 0.2, 0]}>
        {/* V2 holo shell — the "bay glass" around the assembled rig, painted by the vendored
            holographic shader in the LIVE theme accent (never the vendor default). Hidden when
            exploded (the glitch burst covers the transition); fully static under reduced motion
            (signalSpeed 0 + no blinking). clearSpot opens a soft translucency spotlight on
            whatever panel faces the viewer so the parts inside stay readable (owner ask
            2026-07-07); view-dependent only — repaints ride the existing invalidations. */}
        {holoV2 && !exploded && (
          <mesh>
            <boxGeometry args={[4.15, 5.35, 2.55]} />
            <HolographicMaterial
              hologramColor={colors.accent}
              hologramOpacity={0.18}
              hologramBrightness={0.9}
              fresnelAmount={0.6}
              fresnelOpacity={0.7}
              scanlineSize={9}
              signalSpeed={reduced ? 0 : 0.4}
              enableBlinking={!reduced}
              blinkFresnelOnly
              clearSpot={0.85}
              side="DoubleSide"
            />
          </mesh>
        )}
        <RigCase exploded={exploded} color={colors.accent} reduced={reduced} />
        {shownParts.map((p, i) => (
          <RigPart
            key={p.id}
            part={p}
            index={i}
            color={partColors[i]}
            exploded={exploded}
            selectedId={selectedId}
            hoveredId={hoveredId}
            reduced={reduced}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
        {manualRigParts.map((p, i) => (
          <RigPart
            key={p.id}
            part={p}
            index={i}
            color={colors.palette[1]}
            exploded={exploded}
            selectedId={selectedId}
            hoveredId={hoveredId}
            reduced={reduced}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))}
        {fanPlacements.map((fp) => (
          <RigFan
            key={fp.fan.id}
            fan={fp.fan}
            color={fp.fan.detected ? colors.palette[2] : colors.ghost}
            assembled={fp.assembled}
            exploded={fp.exploded}
            isExploded={exploded}
            reduced={reduced}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onHover={onHover}
            onSelect={onSelect}
          />
        ))}
      </group>

      <mesh position={[0, -2.75, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.4, 2.7, 64]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.5} />
      </mesh>
      <Grid
        position={[0, -2.78, 0]}
        args={[40, 40]}
        cellSize={0.6}
        cellThickness={0.6}
        cellColor={colors.palette[0]}
        sectionSize={3}
        sectionThickness={1}
        sectionColor={colors.accent}
        fadeDistance={28}
        fadeStrength={4}
        infiniteGrid
      />

      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={5}
        maxDistance={28}
        minPolarAngle={0.2}
        maxPolarAngle={Math.PI / 1.9}
        autoRotate={orbiting}
        autoRotateSpeed={0.5}
        target={[0, 0.2, 0]}
      />
      {/* Fit the model to whatever container it's in (must sit AFTER OrbitControls so
          useThree().controls is registered via makeDefault). */}
      <FitCamera baseDist={cameraDist} />

      {/* V2 post stack — restrained Bloom lifts the holo shell + accent lights; Glitch fires
          ONLY during the explode/reassemble burst (event-driven, never ambient). */}
      {holoV2 && (
        <EffectComposer>
          <Bloom intensity={0.35} luminanceThreshold={0.25} luminanceSmoothing={0.7} mipmapBlur />
          <Glitch
            active={glitching}
            mode={GlitchMode.SPORADIC}
            duration={GLITCH_DURATION}
            delay={GLITCH_DELAY}
            strength={GLITCH_STRENGTH}
            ratio={0.6}
          />
        </EffectComposer>
      )}
    </Canvas>
  );
});
