import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Billboard, Html } from "@react-three/drei";
import * as THREE from "three";
import { invoke } from "@tauri-apps/api/core";
import type {
  ScoreboardView,
  BlackBoxReport,
  SessionSummary,
  AppliedChange,
} from "../../types";
import { useReducedMotion } from "../../design/use-motion";
import { useDocumentVisible } from "../../data/use-document-visible";
import { useRigColors, partColor } from "../rig/use-rig-colors";
import { FlyCamera } from "./fly-camera";
import { buildGalleryPieces, type GalleryPiece } from "./gallery-pieces";
import type { LabStationKey } from "../lab-guided-data";
import "./TelemetryGallery.css";

// TelemetryGallery — the Lab's COLLECT stage + trophy room (spec 2026-07-08 §3). A panoramic,
// drag-to-explore 3D space where every proven result the user earned floats as a tile: certified
// scoreboard awards, recorded sessions, live ledger receipts, honest crash records — each tracing to
// a REAL measured struct (buildGalleryPieces holds the anti-fabrication line). Drag to orbit the
// ring; click a piece and the camera glides to it (the FlyCamera primitive lifted from the hardware
// tour); its measured detail opens beside it. An empty gallery is honest — it invites the first
// proof and loops the user back to the bench. Reduced motion → a static grid of the same pieces
// (the sister-site's own "prefer the classic grid" fallback). GPU-cheap: demand frameloop at rest,
// continuous frames only while the camera is actually flying, paused when the window is hidden.

// Incidents aren't wins — they wear a muted warn ink, never a part-identity trophy colour.
const INCIDENT_INK = "#c9788a";

function pieceColor(piece: GalleryPiece, colors: ReturnType<typeof useRigColors>): string {
  if (piece.kind === "incident") return INCIDENT_INK;
  return partColor(colors, true, piece.part);
}

const KIND_LABEL: Record<GalleryPiece["kind"], string> = {
  award: "Proven win",
  session: "Session",
  receipt: "Applied",
  incident: "Record",
};

// Ring layout: pieces evenly around a circle in the XZ plane, radius growing with the count so a
// full gallery never crowds. A gentle y-wave lifts the ring off a dead-flat line.
function ringPosition(i: number, n: number, radius: number): THREE.Vector3 {
  const theta = (i / Math.max(1, n)) * Math.PI * 2;
  const y = Math.sin(i * 1.3) * 0.5;
  return new THREE.Vector3(Math.sin(theta) * radius, y, Math.cos(theta) * radius);
}

const OVERVIEW_LOOK = new THREE.Vector3(0, 0, 0);

function Tile({
  piece,
  position,
  color,
  focused,
  dimmed,
  reduced,
  onSelect,
}: {
  piece: GalleryPiece;
  position: THREE.Vector3;
  color: string;
  focused: boolean;
  dimmed: boolean;
  reduced: boolean;
  onSelect: (p: GalleryPiece) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const active = focused || hovered;
  // Emphasis: measured glow (awards) lifts the emissive; dimmed (something else focused) fades it.
  const emissive = dimmed ? 0.12 : Math.min(1.4, 0.42 * piece.glow) * (active ? 1.5 : 1);
  const scale = focused ? 1.28 : active ? 1.12 : 1;
  return (
    <Billboard position={position}>
      <group
        scale={reduced ? scale : undefined}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(piece);
        }}
      >
        {/* The tile — a thin lit panel in the piece's identity ink. */}
        <mesh scale={reduced ? 1 : scale}>
          <boxGeometry args={[1.9, 1.18, 0.07]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={emissive}
            transparent
            opacity={dimmed ? 0.4 : 0.9}
            metalness={0.3}
            roughness={0.5}
          />
        </mesh>
        {/* Caption — crisp DOM text billboarded with the tile. Title + the one measured line. */}
        <Html position={[0, 0, 0.06]} center distanceFactor={7} zIndexRange={[50, 0]} style={{ pointerEvents: "none" }}>
          <div className="tg-cap" style={{ opacity: dimmed ? 0.5 : 1, borderColor: color }}>
            <div className="tg-cap-kind" style={{ color }}>{KIND_LABEL[piece.kind]}</div>
            <div className="tg-cap-title">{piece.title}</div>
            <div className="tg-cap-metric">{piece.metric}</div>
          </div>
        </Html>
      </group>
    </Billboard>
  );
}

function GalleryScene({
  pieces,
  focus,
  flying,
  reduced,
  visible,
  colors,
  onSelect,
  onBackground,
}: {
  pieces: GalleryPiece[];
  focus: GalleryPiece | null;
  flying: boolean;
  reduced: boolean;
  visible: boolean;
  colors: ReturnType<typeof useRigColors>;
  onSelect: (p: GalleryPiece) => void;
  onBackground: () => void;
}) {
  const radius = Math.max(4.6, pieces.length * 0.62);
  const positions = useMemo(
    () => pieces.map((_, i) => ringPosition(i, pieces.length, radius)),
    [pieces, radius],
  );
  const overview = useMemo(() => new THREE.Vector3(0, 2.6, radius + 5.5), [radius]);
  const focusIdx = focus ? pieces.findIndex((p) => p.id === focus.id) : -1;
  // Fly target: pull the camera out along the focused tile's radial line so the billboarded face
  // squares up to the lens; look straight at the tile.
  const flyTarget = focusIdx >= 0 ? positions[focusIdx].clone().multiplyScalar(1.52).setY(positions[focusIdx].y + 0.4) : overview;
  const flyLook = focusIdx >= 0 ? positions[focusIdx] : OVERVIEW_LOOK;

  // Continuous frames only while the camera is actually easing (or under reduced motion, where the
  // one-shot snap still needs a frame); otherwise demand — OrbitControls invalidates on drag.
  const frameloop: "always" | "demand" = flying && visible ? "always" : "demand";

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      camera={{ position: [overview.x, overview.y, overview.z], fov: 42 }}
      onPointerMissed={onBackground}
    >
      <fogExp2 attach="fog" args={["#070b12", 0.03]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[6, 8, 6]} intensity={60} color="#e8edf6" />
      <pointLight position={[-6, -2, -4]} intensity={26} color={colors.accent} />

      {pieces.map((p, i) => (
        <Tile
          key={p.id}
          piece={p}
          position={positions[i]}
          color={pieceColor(p, colors)}
          focused={focus?.id === p.id}
          dimmed={!!focus && focus.id !== p.id}
          reduced={reduced}
          onSelect={onSelect}
        />
      ))}

      {/* A quiet floor ring to seat the space. */}
      <mesh position={[0, -1.9, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius - 0.3, radius + 0.3, 96]} />
        <meshBasicMaterial color={colors.accent} transparent opacity={0.18} depthWrite={false} />
      </mesh>

      {/* Drag to explore when nothing is focused; the camera flies (and holds) when a piece is. */}
      <OrbitControls
        makeDefault
        enablePan={false}
        enabled={focus === null && !flying}
        minDistance={4}
        maxDistance={radius + 12}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 1.9}
        autoRotate={false}
        target={[0, 0, 0]}
      />
      {(focus !== null || flying) && <FlyCamera target={flyTarget} look={flyLook} reduced={reduced} />}
    </Canvas>
  );
}

// Static, WebGL-free rendering of the same pieces: the reduced-motion fallback AND the safe render
// path for jsdom/no-canvas. Same honest data, laid out as a readable grid of cards.
function GalleryGrid({
  pieces,
  colors,
  onSelect,
  focus,
}: {
  pieces: GalleryPiece[];
  colors: ReturnType<typeof useRigColors>;
  onSelect: (p: GalleryPiece) => void;
  focus: GalleryPiece | null;
}) {
  return (
    <div className="tg-grid" role="list">
      {pieces.map((p) => {
        const color = pieceColor(p, colors);
        const open = focus?.id === p.id;
        return (
          <button
            key={p.id}
            role="listitem"
            className={`tg-card${open ? " tg-card-open" : ""}`}
            style={{ borderColor: color }}
            onClick={() => onSelect(p)}
          >
            <span className="tg-card-kind" style={{ color }}>{KIND_LABEL[p.kind]}</span>
            <span className="tg-card-title">{p.title}</span>
            <span className="tg-card-metric">{p.metric}</span>
            {open && (
              <span className="tg-card-detail">
                {p.detail.map((d) => (
                  <span className="tg-card-row" key={d.label}>
                    <span className="tg-card-row-l">{d.label}</span>
                    <span className="tg-card-row-v">{d.value}</span>
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TelemetryGallery({
  changes,
  sessions,
  onJump,
}: {
  changes: AppliedChange[] | null;
  sessions: SessionSummary[] | null;
  /** Loop the empty gallery back to the bench (the front door of the prove-it loop). */
  onJump?: (k: LabStationKey) => void;
}) {
  const reduced = useReducedMotion();
  const visible = useDocumentVisible();
  const colors = useRigColors();
  const [scoreboard, setScoreboard] = useState<ScoreboardView | null>(null);
  const [crash, setCrash] = useState<BlackBoxReport | null>(null);
  const [focus, setFocus] = useState<GalleryPiece | null>(null);
  const [flying, setFlying] = useState(false);

  // The two reads Lab doesn't already hold — fired once, only when this station body mounts (the
  // accordion opens). Both read-only; failure is honest absence, never a fabricated piece.
  useEffect(() => {
    invoke<ScoreboardView>("get_scoreboard").then(setScoreboard).catch(() => {});
    invoke<BlackBoxReport>("get_crash_blackbox").then(setCrash).catch(() => {});
  }, []);

  const pieces = useMemo(
    () => buildGalleryPieces({ scoreboard, sessions, changes, crash }),
    [scoreboard, sessions, changes, crash],
  );

  // Focus change → fly for ~900ms, then drop back to demand (camera settled). Covers both directions
  // (to a piece, and back to overview on clear).
  useEffect(() => {
    setFlying(true);
    const id = window.setTimeout(() => setFlying(false), 900);
    return () => window.clearTimeout(id);
  }, [focus]);

  // Keep the focused piece pinned to fresh data (a re-fetch could replace the object identity).
  useEffect(() => {
    if (focus && !pieces.some((p) => p.id === focus.id)) setFocus(null);
  }, [pieces, focus]);

  if (pieces.length === 0) {
    // The honest empty gallery — no fabricated trophies. It invites the first proof and loops back.
    return (
      <div className="tg-empty">
        <div className="tg-empty-glyph" aria-hidden="true">◇</div>
        <p className="tg-empty-head">Your gallery is empty — for now.</p>
        <p className="tg-empty-sub">
          Prove a tweak in the Benchmark station and your first measured win lands here as a piece you
          can explore. Sessions you play and changes you apply show up here too.
        </p>
        {onJump && (
          <button className="tg-empty-cta cmp-door" onClick={() => onJump("benchmark")}>
            Go prove a tweak
            <span className="cmp-door-chevron" aria-hidden="true">▸</span>
          </button>
        )}
      </div>
    );
  }

  const detail = focus;
  // Reduced motion (or a hidden window at mount) → the static grid; else the panoramic 3D space.
  const useGrid = reduced;

  return (
    <div className="tg-root">
      <div className="tg-stage">
        {useGrid ? (
          <GalleryGrid pieces={pieces} colors={colors} onSelect={setFocus} focus={focus} />
        ) : (
          <GalleryScene
            pieces={pieces}
            focus={focus}
            flying={flying}
            reduced={reduced}
            visible={visible}
            colors={colors}
            onSelect={setFocus}
            onBackground={() => setFocus(null)}
          />
        )}

        {/* Focused detail — one crisp DOM panel over the space (3D path only; the grid opens inline). */}
        {detail && !useGrid && (
          <aside className="tg-detail" style={{ borderColor: pieceColor(detail, colors) }}>
            <div className="tg-detail-kind" style={{ color: pieceColor(detail, colors) }}>
              {KIND_LABEL[detail.kind]}
            </div>
            <div className="tg-detail-title">{detail.title}</div>
            <div className="tg-detail-metric">{detail.metric}</div>
            <dl className="tg-detail-list">
              {detail.detail.map((d) => (
                <div className="tg-detail-row" key={d.label}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
            <button className="tg-detail-back" onClick={() => setFocus(null)}>
              ← Back to the space
            </button>
          </aside>
        )}
      </div>

      <p className="tg-foot">
        {pieces.length} {pieces.length === 1 ? "piece" : "pieces"} — every one measured, none invented.
        {useGrid ? " Tap a card to read its numbers." : " Drag to explore; click a piece to inspect it."}
      </p>
    </div>
  );
}

export default TelemetryGallery;
