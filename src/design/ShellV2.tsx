// V2 product shell (V2-2, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Linear/Geist-discipline
// chrome from the owner-approved mockup: 216px rail (wordmark · rooms with digit hints · the
// zero-outbound/reversible footer) + 46px topbar (room title · plain-English crumb · build stamp)
// + a scrolling content lane. Renders ONLY when App's compy_v2 state is on; flag off, this tree
// never mounts and the app is byte-identical (tokens-v2-guard.test.ts pins the CSS side).
//
// Deliberately ABSENT: the mockup's "Search or jump anywhere · Ctrl K" box. CommandPalette is
// PARKED (design-direction spec: a new feature, owner call post-P6) and a search box that does
// nothing would be a fake affordance — banned. It lands with the palette, if the owner calls it.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Wordmark } from "./Wordmark";
import { NavGlyph } from "./NavGlyph";
import { HOME_RAIL, type HomeRailId, type HomeRailItem } from "./homeRail";
import "./shell-v2.css";

// Plain-English crumb per room (topbar wayfinding). Says what the room is FOR — Sarah & Caleb bar.
export const ROOM_CRUMB: Record<HomeRailId, string> = {
  home: "how your PC is doing",
  check: "is anything holding you back?",
  fix: "find it, fix it, undo it",
  play: "watch it live",
  learn: "what actually works — measured",
  lab: "benchmarks, latency, diagnostics",
};

// Rail-navigation context: ForwardDoor (room-shell.tsx) navigates through the SAME handler the
// rail uses ("navigation never teleports" — P6 law), provided here so doors can't grow a parallel
// navigation path. labelFor resolves a destination's CURRENT rail label (e.g. fix → "Optimize"
// under the merge) so door arrows never drift from the rail.
type V2Nav = { navigate: (id: HomeRailId) => void; labelFor: (id: HomeRailId) => string };
const V2NavContext = createContext<V2Nav>({
  navigate: () => {},
  labelFor: (id) => HOME_RAIL.find((r) => r.id === id)?.label ?? id,
});
export const useV2Nav = () => useContext(V2NavContext);

export function ShellV2({
  items,
  activeId,
  onNavigate,
  ledgerCount,
  version,
  children,
}: {
  items: HomeRailItem[];
  activeId: HomeRailId | undefined;
  onNavigate: (id: HomeRailId) => void;
  ledgerCount: number;
  version: string;
  children: ReactNode;
}) {
  // Build stamp (compile-time provenance, same probe Settings→About uses). Fetch fails → no stamp
  // rendered — never a fabricated one.
  const [stamp, setStamp] = useState<string | null>(null);
  useEffect(() => {
    invoke<string>("get_build_stamp")
      .then(setStamp)
      .catch(() => {
        /* probe failed — the topbar just omits the stamp */
      });
  }, []);

  // Digit shortcuts 1..N (the rail's kbd hints must WORK — a hint that does nothing is a fake
  // affordance). Never while typing, never with a modifier held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > items.length) return;
      onNavigate(items[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, onNavigate]);

  const active = items.find((i) => i.id === activeId);
  const nav: V2Nav = {
    navigate: onNavigate,
    labelFor: (id) =>
      items.find((r) => r.id === id)?.label ?? HOME_RAIL.find((r) => r.id === id)?.label ?? id,
  };

  return (
    <V2NavContext.Provider value={nav}>
      <div className="v2-shell">
        <nav className="v2-rail" aria-label="Rooms">
          <div className="v2-wordmark">
            <Wordmark size={16} />
            <span className="v2-version">{version}</span>
          </div>
          <div className="v2-nav" role="tablist">
            {items.map((item, i) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={activeId === item.id}
                className="v2-nav-item"
                onClick={() => onNavigate(item.id)}
                title={item.label}
              >
                <NavGlyph name={item.icon} />
                <span>{item.label}</span>
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
          <div className="v2-foot">
            {/* The verified zero-outbound property (holds until opt-in Receipts ships through its
                own gate) + the rollback-first promise, with the measured ledger count. */}
            <div className="v2-zero">
              <span className="v2-zero-led" aria-hidden="true" />
              Zero outbound connections
            </div>
            <div>
              Every change reversible · <span className="v2-mono">ledger {ledgerCount}</span>
            </div>
          </div>
        </nav>

        <div className="v2-main">
          <div className="v2-top">
            <span className="v2-room-title">{active?.label ?? "Compy"}</span>
            {active && <span className="v2-crumb">· {ROOM_CRUMB[active.id]}</span>}
            {stamp && <span className="v2-stamp">{stamp}</span>}
          </div>
          <div className="v2-content">
            <div className="v2-content-wrap">{children}</div>
          </div>
        </div>
      </div>
    </V2NavContext.Provider>
  );
}
