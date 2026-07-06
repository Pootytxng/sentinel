import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ParticleCard } from "../design/vendor/MagicBento/MagicBento";
import { labBentoCards, labCheckup } from "./lab-bento-data";
import type { LabStationKey, LabStationFacts } from "./lab-guided-data";
import { useReducedMotion } from "../design/use-motion";
import "./lab-bento.css";

// Lab bento checkup (spec 2026-07-05-lab-bento-checkup) — the Lab's face as a bento grid of
// station cards in bench order + the synthesized checkup report. Cards are DOORS: clicking one
// runs the existing router jump (scroll + expand that station below — navigation never
// teleports). Interactions ride the vendored MagicBento ParticleCard (spotlighted border glow,
// hover particles, click ripple) re-pointed at the THEME accent — tilt and magnetism stay off
// (restraint rails), and everything animated is gated on the app's resolved reduced-motion.

// Theme accent → "r, g, b" for the vendor's rgba() glow strings. Computed from the mounted
// grid so it picks up the live theme (and any room-level override); a parse failure falls back
// to a neutral gray — the vendor purple can never paint.
function accentRgb(el: HTMLElement): string {
  const raw = getComputedStyle(el).getPropertyValue("--ix-accent").trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw);
  if (rgb) return `${rgb[1]}, ${rgb[2]}, ${rgb[3]}`;
  return "160, 160, 160";
}

const GLOW_RADIUS = 260;

export function LabBento({
  keys,
  facts,
  onOpen,
}: {
  keys: LabStationKey[];
  facts: LabStationFacts;
  onOpen: (k: LabStationKey) => void;
}) {
  const reduced = useReducedMotion();
  const gridRef = useRef<HTMLDivElement>(null);
  const [rgb, setRgb] = useState("160, 160, 160");
  useEffect(() => {
    if (gridRef.current) setRgb(accentRgb(gridRef.current));
  }, []);

  // Cursor-following border glow (the vendor GlobalSpotlight's per-card math, minus its
  // body-appended screen-blend overlay — too loud for the instrument voice). Pointer-driven
  // custom props only; skipped entirely under reduced motion.
  useEffect(() => {
    if (reduced) return;
    const grid = gridRef.current;
    if (!grid) return;
    const proximity = GLOW_RADIUS * 0.5;
    const fade = GLOW_RADIUS * 0.75;
    const cardsOf = () => grid.querySelectorAll<HTMLElement>(".lab-bento-card");
    const onMove = (e: PointerEvent) => {
      cardsOf().forEach((card) => {
        const r = card.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d =
          Math.hypot(e.clientX - cx, e.clientY - cy) - Math.max(r.width, r.height) / 2;
        const eff = Math.max(0, d);
        const glow =
          eff <= proximity ? 1 : eff <= fade ? (fade - eff) / (fade - proximity) : 0;
        card.style.setProperty("--glow-x", `${((e.clientX - r.left) / r.width) * 100}%`);
        card.style.setProperty("--glow-y", `${((e.clientY - r.top) / r.height) * 100}%`);
        card.style.setProperty("--glow-intensity", glow.toFixed(3));
      });
    };
    const onLeave = () => {
      cardsOf().forEach((c) => c.style.setProperty("--glow-intensity", "0"));
    };
    grid.addEventListener("pointermove", onMove);
    grid.addEventListener("pointerleave", onLeave);
    return () => {
      grid.removeEventListener("pointermove", onMove);
      grid.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  const cards = labBentoCards(keys, facts);
  const report = labCheckup(cards);

  return (
    <div className="lab-bento">
      {/* The needle rule: the read-only promise leads the room, so nobody's afraid to poke. */}
      <p className="lab-bento-lede">
        Your rig's checkup — five kinds of measurement, in order, left to right. Everything
        here only <em>reads</em>; nothing changes your PC, so tinker freely.
      </p>

      <div className="lab-bento-grid" ref={gridRef}>
        {cards.map((c) => (
          <ParticleCard
            key={c.key}
            className="lab-bento-card"
            style={{ "--glow-rgb": rgb } as CSSProperties}
            disableAnimations={reduced}
            particleCount={6}
            glowColor={rgb}
            enableTilt={false}
            enableMagnetism={false}
            clickEffect={!reduced}
          >
            <button
              className="lab-bento-door"
              onClick={() => onOpen(c.key)}
              aria-label={`Open station ${c.n} — ${c.name}`}
            >
              <span className="lab-bento-top">
                <span className="lab-bento-n">{String(c.n).padStart(2, "0")}</span>
                <span
                  className={`lab-bento-led ${c.hasReading ? "lab-bento-led-read" : ""}`}
                  aria-hidden="true"
                />
                <span className="lab-bento-state">
                  {c.hasReading ? "Measured" : "Not yet"}
                </span>
              </span>
              {/* One-mention law: the full reading sentence lives in the checkup report below
                  (and at the station itself) — the card face carries the status chip only. */}
              <span className="lab-bento-name">{c.name}</span>
              <span className="lab-bento-for">{c.forLine}</span>
              <span className="lab-bento-note">{c.note}</span>
            </button>
          </ParticleCard>
        ))}
      </div>

      {/* The checkup report — the annotated summary. Every reading line is stationReading()'s
          exact output (one source); the next-step points at the first unread station in order. */}
      <section className="lab-bento-report" aria-label="Checkup report">
        <div className="lab-bento-report-head">
          <span className="lab-bento-report-k">Checkup report</span>
          <span className="lab-bento-report-headline">{report.headline}</span>
        </div>
        <p className="lab-bento-report-sub">{report.sub}</p>
        <ul className="lab-bento-report-lines">
          {report.lines.map((l) => (
            <li
              key={l.key}
              className={`lab-bento-report-line${l.hasReading ? "" : " lab-bento-report-line-unread"}`}
            >
              <span className="lab-bento-line-name">{l.name}</span>
              <span className="lab-bento-line-reading">{l.reading}</span>
            </li>
          ))}
        </ul>
        {report.next && <div className="lab-bento-next">{report.next}</div>}
      </section>
    </div>
  );
}

export default LabBento;
