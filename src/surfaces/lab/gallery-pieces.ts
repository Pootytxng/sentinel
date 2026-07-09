// Pure logic for the telemetry GALLERY (spec 2026-07-08-lab-proving-ground §3, the COLLECT stage).
// Kept DOM-free / three-free so the anti-fabrication law is unit-tested hard (the two-futures-view.ts
// way): every piece in the gallery traces to a REAL measured struct that crossed IPC — a certified
// scoreboard award, a recorded game session, an applied ledger receipt, or an honest crash record.
// NOTHING here invents a number. An empty return is the honest empty gallery ("prove a tweak to earn
// your first piece"), never a fabricated trophy.
import type {
  ScoreboardView,
  SessionSummary,
  AppliedChange,
  BlackBoxReport,
} from "../../types";
import type { RigPartKind } from "../rig/rig-parts";

export type GalleryPieceKind = "award" | "session" | "receipt" | "incident";

export interface GalleryPiece {
  /** Stable per-piece id (kind + source key) — the React key + focus target. */
  id: string;
  kind: GalleryPieceKind;
  /** The rig part this proof anchors to (its identity colour + where the camera flies). */
  part: RigPartKind;
  /** Headline — the game, tweak, or incident, verbatim from the source struct. */
  title: string;
  /** ONE measured line — the honest number/verdict this piece carries (never fabricated). */
  metric: string;
  /** Secondary measured facts for the focused detail panel (label → value). */
  detail: { label: string; value: string }[];
  /** ISO timestamp for sort (newest piece first); null when the struct carries none. */
  at: string | null;
  /**
   * Emphasis for the 3D tile: >1 only where a REAL measured delta backs it (awards), 1 (neutral)
   * everywhere else. Incidents never glow — they are records, not wins. Clamped so an outlier
   * can't blow the material out (same rule as partGlow in two-futures-view).
   */
  glow: number;
}

// rec_id / title → the rig part a tweak most plausibly touches. Keyword-based, honest default to
// the board (the neutral platform slab) when nothing matches — the anchor is presentational (where
// the tile sits + its colour), never a measured claim. Deliberately covers the 16 appliable recs.
export function classifyPart(text: string): RigPartKind {
  const t = text.toLowerCase();
  if (/\bgpu\b|graphics|hags|nvidia|geforce|radeon|vram|pcie|aspm|video/.test(t)) return "gpu";
  if (/\bcpu\b|\bcore\b|power|scheduler|mmcss|affinity|ultimate|processor|clock/.test(t)) return "cpu";
  if (/\bram\b|memory|sysmain|superfetch|prefetch|paging|pagefile/.test(t)) return "ram";
  if (/disk|storage|\bssd\b|\bnvme\b|trim|search|index|reserved/.test(t)) return "storage";
  return "board";
}

// Crash faulting module → the part it most plausibly implicates. Same honest default (board).
function classifyIncident(module: string | null, app: string | null): RigPartKind {
  const m = `${module ?? ""} ${app ?? ""}`.toLowerCase();
  if (/nvlddmkm|amdkmdag|dxgkrnl|dxgmms|igdkmd|nvwgf|d3d/.test(m)) return "gpu";
  if (/ntoskrnl|hal\.|processr|intelppm/.test(m)) return "cpu";
  return "board";
}

function pct(n: number): string {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

// Award emphasis: same shape as partGlow — scale by the measured effect, clamp to a safe band.
function awardGlow(effectPct: number): number {
  return Math.min(2.2, Math.max(0.9, 1 + Math.abs(effectPct) * 0.06));
}

/**
 * Assemble every gallery piece from the four measured sources. Order: newest first (by timestamp),
 * with pieces that carry no timestamp sinking to the end in a stable order. Pure + total — any
 * source may be null/empty (honest absence), and the result is simply what genuinely exists.
 */
export function buildGalleryPieces(sources: {
  scoreboard: ScoreboardView | null;
  sessions: SessionSummary[] | null;
  changes: AppliedChange[] | null;
  crash: BlackBoxReport | null;
}): GalleryPiece[] {
  const pieces: GalleryPiece[] = [];

  // ── Certified wins — the trophy pieces. Only "Keep" verdicts ever reach the scoreboard, so
  //    every award is a measured, CI-backed win (benchmark_scoreboard.rs). ──
  (sources.scoreboard?.awards ?? []).forEach((a, i) => {
    pieces.push({
      id: `award-${a.rec_id}-${a.at}-${i}`,
      kind: "award",
      part: classifyPart(`${a.rec_id} ${a.rec_title}`),
      title: a.rec_title,
      metric: `${pct(a.effect_pct)} ${a.metric}`,
      detail: [
        { label: "Effect", value: pct(a.effect_pct) },
        { label: "95% CI", value: `${pct(a.ci_lo_pct)} … ${pct(a.ci_hi_pct)}` },
        { label: "Metric", value: a.metric },
        { label: "Points", value: `${a.points}` },
      ],
      at: a.at,
      glow: awardGlow(a.effect_pct),
    });
  });

  // ── Recorded sessions — real gameplay Compy measured (frame-producing → anchored to the GPU).
  //    Only sessions that actually collected frames count (no zero-sample ghosts). ──
  (sources.sessions ?? [])
    .filter((s) => s.samples > 0 && s.avg_fps > 0)
    .forEach((s, i) => {
      const temp =
        s.peak_gpu_temp_c != null ? [{ label: "Peak GPU temp", value: `${s.peak_gpu_temp_c}°C` }] : [];
      pieces.push({
        id: `session-${s.started_at}-${i}`,
        kind: "session",
        part: "gpu",
        title: s.process_name || "Game session",
        metric: `${Math.round(s.avg_fps)} fps avg · ${s.avg_frametime_ms.toFixed(1)}ms`,
        detail: [
          { label: "Average", value: `${Math.round(s.avg_fps)} fps` },
          { label: "1% low", value: `${Math.round(s.low1_fps_est)} fps` },
          { label: "Frame time", value: `${s.avg_frametime_ms.toFixed(1)} ms` },
          ...temp,
          { label: "Length", value: `${Math.max(1, Math.round(s.duration_secs / 60))} min` },
        ],
        at: s.started_at,
        glow: 1,
      });
    });

  // ── Ledger receipts — what's applied on this rig RIGHT NOW (rolled-back entries are not shown;
  //    they're no longer proofs). Honest before→after labels only, no invented gain number. ──
  (sources.changes ?? [])
    .filter((c) => c.status === "applied" && c.is_still_active)
    .forEach((c) => {
      const after = c.applied_label ? [{ label: "Set to", value: c.applied_label }] : [];
      const prior = c.restores_label ? [{ label: "Undo restores", value: c.restores_label }] : [];
      const payoff = c.payoff_label ? [{ label: "Targets", value: c.payoff_label }] : [];
      pieces.push({
        id: `receipt-${c.id}`,
        kind: "receipt",
        part: classifyPart(`${c.rec_id} ${c.rec_title}`),
        title: c.rec_title,
        metric: c.applied_label
          ? `Applied → ${c.applied_label}`
          : c.payoff_label
            ? `Applied · ${c.payoff_label}`
            : "Applied — reversible",
        detail: [...after, ...prior, ...payoff],
        at: c.applied_at,
        glow: 1,
      });
    });

  // ── Honest failure records — the Black Box incidents. Zero causal claims: the piece carries only
  //    what Windows recorded (faulting app/module, code, when). Never a trophy, never a glow. ──
  (sources.crash?.incidents ?? []).forEach((inc, i) => {
    const r = inc.receipt;
    const mod = r.faulting_module ? [{ label: "Module", value: r.faulting_module }] : [];
    const code = r.code ? [{ label: "Code", value: r.code }] : [];
    pieces.push({
      id: `incident-${inc.when}-${i}`,
      kind: "incident",
      part: classifyIncident(r.faulting_module, r.faulting_app),
      title: inc.headline,
      metric: r.faulting_app ? `${inc.tag} · ${r.faulting_app}` : inc.tag,
      detail: [
        { label: "When", value: inc.when_display },
        ...(r.faulting_app ? [{ label: "App", value: r.faulting_app }] : []),
        ...mod,
        ...code,
      ],
      at: inc.when,
      glow: 1,
    });
  });

  // Newest first; timestamp-less pieces sink but keep insertion order (stable).
  return pieces.sort((a, b) => {
    if (a.at && b.at) return a.at < b.at ? 1 : a.at > b.at ? -1 : 0;
    if (a.at) return -1;
    if (b.at) return 1;
    return 0;
  });
}

/**
 * The cheap "does the user have any measured history yet?" signal for the gallery station's reading
 * line — derivable from what Lab already holds (active receipts + sessions with data), ZERO new IPC.
 * The full piece set (incl. awards + incidents) is assembled lazily inside the gallery body on open;
 * this only decides the invitation vs. "you have history" copy, so it never claims a precise total.
 */
export function galleryHasHistory(
  changes: AppliedChange[] | null | undefined,
  sessions: SessionSummary[] | null | undefined,
): boolean {
  const activeReceipt = (changes ?? []).some((c) => c.status === "applied" && c.is_still_active);
  const measuredSession = (sessions ?? []).some((s) => s.samples > 0 && s.avg_fps > 0);
  return activeReceipt || measuredSession;
}
