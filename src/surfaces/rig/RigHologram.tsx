import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom, Glitch } from "@react-three/postprocessing";
import { GlitchMode } from "postprocessing";
import { Vector2 } from "three";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import HolographicMaterial from "../../design/vendor/HolographicMaterial/HolographicMaterial";
import { readHologramV2 } from "../../design/theme";
import type { HardwareInfo } from "../../App";
import {
  buildRigParts,
  clickThroughIds,
  describeRigSelection,
  rigInventory,
  CPU_FAN_PLACEMENT,
  type Vec3,
  type RigPart as RigPartData,
  type RigSelection,
} from "./rig-parts";
import { nextFanSensors, type FanSensor } from "./fan-sensors";
import { type ManualPart, type ManualKind, manualGeom, manualPlacement } from "./manual-parts";
import { useRigColors, partColor, FAN_COLOR } from "./use-rig-colors";
import { useReducedMotion } from "../../design/use-motion";
import { useDocumentVisible } from "../../data/use-document-visible";
import { fitCameraDistance } from "./camera-fit";
import { RigCase } from "./RigCase";
import { RigPart } from "./RigPart";
import { RigFan, type FanInfo } from "./RigFan";

// The 3D hologram canvas — the user's REAL rig, theme-aware, doctrine-safe:
//  • parts + specs come from buildRigParts(hw) (real hardware; honest ghosts), never fabricated.
//  • part colours are the FIXED per-kind identity palette (PART_KIND_COLORS — theme-independent,
//    owner directive 2026-07-07); the bay itself (shell/case/grid/rim) follows the theme.
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
  /** `what` describes which of the three drawn lists the id came from — a host that only knows
      `buildRigParts` cannot resolve a fan or a user-added part, and silently showed nothing. Null
      when the click cleared the selection. */
  onSelect: (id: string, what: RigSelection | null) => void;
  onHover: (id: string | null) => void;
  /** Everything the scene drew that can be selected, re-emitted whenever those lists change. The
      host renders the DOM part picker from it — the canvas itself is unreachable by keyboard, so
      this is how a keyboard user selects a part at all. Must be referentially stable. */
  onInventory?: (items: RigSelection[]) => void;
  manualParts: ManualPart[];
  /** true → the host's DOM part picker has focus, so every on-canvas spec card stands down. The
      cards are anchored to their part's position in 3D and the picker panel is anchored to the
      stage, so the two collide over exactly the rows a keyboard user is reading. Highlighting is
      unaffected — the focused row still lights its part up in the model. */
  cardsSuppressed?: boolean;
  /** Initial camera distance. Default = the classic framing; the V2 hero stage pulls in closer
      so the model fills its bigger stage (additive — existing callers are untouched). */
  cameraDist?: number;
  /** Evidence-map mode (the Lab console). Clicking a part is the ONLY way to open its readings
      there — the orbit/explode chrome is hidden — so any ghost standing in front of a real part
      becomes transparent to the pointer. Off everywhere else: the Gaming rig viewer keeps its
      controls, so the ghosts stay selectable there and nothing about it changes. */
  evidenceMap?: boolean;
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
  onInventory,
  manualParts,
  cardsSuppressed = false,
  cameraDist = 9.5,
  evidenceMap = false,
}: Props) {
  const { t } = useTranslation();
  const colors = useRigColors();
  const parts = useMemo(() => buildRigParts(hw, t), [hw, t]);
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

  // Q7 idle-cost: the render loop already stands down while hidden; so must this watcher. Nothing
  // downstream needs a fresh game-active read while the user can't see the bay.
  useEffect(() => {
    if (!visible) return;
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
  }, [visible]);

  // Once the user manually adds a kind (cooler/psu), suppress the matching honest ghost.
  const manualKinds = useMemo(() => new Set(manualParts.map((m) => m.kind)), [manualParts]);
  const shownParts = useMemo(
    () => parts.filter((p) => p.detected || !manualKinds.has(p.id as ManualKind)),
    [parts, manualKinds],
  );

  // Colour per part: detected parts wear their kind's fixed identity hue (theme-independent —
  // owner directive 2026-07-07: one distinct colour per component); ghosts take the faint ink.
  const partColors = useMemo(
    () => shownParts.map((p) => partColor(colors, p.detected, p.kind)),
    [shownParts, colors],
  );

  // User-added parts → RigPart shape, labelled "User-added" (never presented as detected).
  const manualRigParts: RigPartData[] = useMemo(() => {
    let otherIndex = 0;
    return manualParts.map((m) => {
      const place = manualPlacement(m.kind, m.kind === "other" ? otherIndex++ : 0);
      return {
        id: m.id,
        name: m.name || t("gaming.rigViewer.manualPart.nameFallback", { defaultValue: "User part" }),
        category: t("gaming.rigViewer.manualPart.category", { defaultValue: "User-added" }),
        kind: manualGeom(m.kind),
        detected: true,
        assembled: place.assembled,
        exploded: place.exploded,
        rotation: place.rotation,
        tagline: m.note || t("gaming.rigViewer.manualPart.taglineFallback", { defaultValue: "Added by you" }),
        specs: [
          {
            label: t("gaming.rigViewer.manualPart.sourceLabel", { defaultValue: "Source" }),
            value: t("gaming.rigViewer.manualPart.sourceValue", { defaultValue: "You added this" }),
          },
          ...(m.note
            ? [{ label: t("gaming.rigViewer.manualPart.noteLabel", { defaultValue: "Note" }), value: m.note }]
            : []),
        ],
      };
    });
  }, [manualParts, t]);

  // Live fans — polled only while no game is capturing (the hologram is paused then anyway) and
  // only while the window is on screen (Q7 idle-cost; RPM readings are display-only).
  useEffect(() => {
    if (gameActive || !visible) return;
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
  }, [gameActive, visible]);

  const fans: FanInfo[] = useMemo(() => {
    if (fanSensors && fanSensors.length > 0) {
      return fanSensors.map((s, i) => ({ id: `fan-${i}`, label: s.label, rpm: s.rpm, detected: true }));
    }
    // Nothing publishing → honest static ghosts (the "run a monitor" nudge lives in RigViewer).
    return [
      {
        id: "fan-ghost-cpu",
        label: t("gaming.rigViewer.fan.ghostCpu", { defaultValue: "CPU fan" }),
        rpm: null,
        detected: false,
      },
      {
        id: "fan-ghost-front",
        label: t("gaming.rigViewer.fan.ghostFrontIntake", { defaultValue: "Front intake" }),
        rpm: null,
        detected: false,
      },
      {
        id: "fan-ghost-rear",
        label: t("gaming.rigViewer.fan.ghostRearExhaust", { defaultValue: "Rear exhaust" }),
        rpm: null,
        detected: false,
      },
    ];
  }, [fanSensors, t]);

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
        return { fan: f, ...CPU_FAN_PLACEMENT };
      }
      const idx = ci++;
      return { fan: f, assembled: casePos[idx % casePos.length], exploded: caseExp[idx % caseExp.length] };
    });
  }, [fans]);

  // Evidence-map mode only: ghosts standing between the camera and a real part hand their clicks
  // through, so the part behind them stays selectable. Fans ride the same rule via the shared
  // `Placed` shape — that is what stops the CPU-fan ghost swallowing every click on the CPU.
  const clickThrough = useMemo(() => {
    if (!evidenceMap) return new Set<string>();
    return new Set(
      clickThroughIds([
        ...shownParts,
        ...manualRigParts,
        ...fanPlacements.map((fp) => ({ id: fp.fan.id, detected: fp.fan.detected, assembled: fp.assembled })),
      ]),
    );
  }, [evidenceMap, shownParts, manualRigParts, fanPlacements]);

  // Every mesh reports its click through here, so the id is resolved ONCE, next to the three lists
  // that produced it, instead of in each host that mirrors the selection. useCallback keeps the
  // handler referentially stable — a new function per render re-commits it onto every mesh and r3f
  // invalidates, repainting the resting bay (the idle-GPU law the frameloop note below is about).
  const scene = useMemo(
    () => ({ parts: shownParts, manual: manualRigParts, fans }),
    [shownParts, manualRigParts, fans],
  );

  const emitSelect = useCallback(
    (id: string) => onSelect(id, describeRigSelection(id, scene)),
    [onSelect, scene],
  );

  // Hand the host the same list the meshes are built from — the picker it renders is the keyboard's
  // only route to a selection, and deriving it from anything else would let the two drift apart.
  useEffect(() => {
    onInventory?.(rigInventory(scene));
  }, [onInventory, scene]);

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

  // Alt text for the bay: the names of the parts actually drawn, plus an honest note about the ones
  // Compy can't read in software (the visible ghosts) — derived from the same `parts` the scene
  // renders, so it can never describe hardware that isn't there.
  const altText = useMemo(() => {
    const drawn = [...parts.map((p) => p.name), ...manualParts.map((p) => p.name)];
    const ghosts = parts.filter((p) => !p.detected).map((p) => p.name);
    const base = t("gaming.rigViewer.a11y.hologram", { parts: drawn.join(", ") });
    return ghosts.length > 0
      ? `${base} ${t("gaming.rigViewer.a11y.hologramGhosts", { ghosts: ghosts.join(", ") })}`
      : base;
  }, [parts, manualParts, t]);

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0.6, 1.5, cameraDist], fov: 45 }}
      onPointerMissed={() => emitSelect("")}
      // Q7 a11y: the bay was invisible to a screen reader in BOTH rooms that mount it (Home and
      // Lab) — canvas with no name, no role, no fallback, no adjacent text. It is a picture of the
      // user's own machine, so it gets a picture's alt text, built from the SAME parts list the
      // scene draws (never a fabricated description of hardware).
      //
      // r3f trap, load-bearing: CanvasProps extends HTMLAttributes<HTMLDivElement> and `...props`
      // is spread onto the OUTER wrapper div — role/aria-label land THERE, not on <canvas>. The
      // only prop that reaches the canvas element is `fallback` (r3f's own words: "similar to
      // img's alt prop"). So both are set: role+label name the wrapper for the AX tree, `fallback`
      // names the canvas itself for anything that walks to it directly.
      role="img"
      aria-label={altText}
      fallback={altText}
    >
      <fogExp2 attach="fog" args={["#0a1320", 0.045]} />
      <ambientLight intensity={0.7} />
      {/* Neutral key lights: theme-tinted keys washed every part toward the accent, fighting the
          per-part identity hues. Theme flavour stays in the rim light, shell, case and grid. */}
      <pointLight position={[5, 5, 5]} intensity={55} color="#e8edf6" />
      <pointLight position={[-6, -1, 4]} intensity={38} color="#dfe6f2" />
      <pointLight position={[0, 6, -4]} intensity={28} color={colors.accent} />

      <group position={[0, 0.2, 0]}>
        {/* V2 holo shell — the "bay glass" around the assembled rig, painted by the vendored
            holographic shader in the LIVE theme accent (never the vendor default). Hidden when
            exploded (the glitch burst covers the transition); fully static under reduced motion
            (signalSpeed 0). clearSpot opens a soft translucency spotlight on whatever panel
            faces the viewer so the parts inside stay readable (owner ask 2026-07-07);
            view-dependent only — repaints ride the existing invalidations.
            enableBlinking stays FALSE for everyone: the upstream blink re-rolls a time-hash
            every frame, and on this DoubleSide additive shell the back faces carry max fresnel
            across the whole silhouette — so the "rim blink" pumped the ENTIRE case in irregular
            single frames and washed out the parts inside (owner clip 2026-07-08, Bloom-amplified;
            holo-shell-blink-guard.test.ts).
            Owner directive 2026-07-07 round 2: the case must be MUCH more see-through so the
            per-part identity colours read — hologramOpacity 0.18→0.08 and fresnelOpacity
            0.42→0.2 turn the shell into a whisper of glass; the parts inside carry the scene. */}
        {holoV2 && !exploded && (
          <mesh>
            <boxGeometry args={[4.15, 5.35, 2.55]} />
            <HolographicMaterial
              hologramColor={colors.accent}
              hologramOpacity={0.08}
              hologramBrightness={0.9}
              fresnelAmount={0.6}
              fresnelOpacity={0.2}
              scanlineSize={9}
              signalSpeed={reduced ? 0 : 0.4}
              enableBlinking={false}
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
            onSelect={emitSelect}
            onHover={onHover}
            pointerThrough={clickThrough.has(p.id)}
            cardOnSelect={!evidenceMap}
            suppressCard={cardsSuppressed}
          />
        ))}
        {manualRigParts.map((p, i) => (
          <RigPart
            key={p.id}
            part={p}
            index={i}
            color={partColor(colors, true, p.kind)}
            exploded={exploded}
            selectedId={selectedId}
            hoveredId={hoveredId}
            reduced={reduced}
            onSelect={emitSelect}
            onHover={onHover}
            pointerThrough={clickThrough.has(p.id)}
            cardOnSelect={!evidenceMap}
            suppressCard={cardsSuppressed}
          />
        ))}
        {fanPlacements.map((fp) => (
          <RigFan
            key={fp.fan.id}
            fan={fp.fan}
            color={fp.fan.detected ? FAN_COLOR : colors.ghost}
            assembled={fp.assembled}
            exploded={fp.exploded}
            isExploded={exploded}
            reduced={reduced}
            hoveredId={hoveredId}
            selectedId={selectedId}
            onHover={onHover}
            onSelect={emitSelect}
            suppressCard={cardsSuppressed}
            pointerThrough={clickThrough.has(fp.fan.id)}
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
