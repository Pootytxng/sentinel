// V2 product shell (V2-2, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Linear/Geist-discipline
// chrome from the owner-approved mockup: 216px rail (wordmark · rooms with digit hints · the
// outbound-honesty/reversible footer) + 46px topbar (room title · plain-English crumb · build
// stamp · update pill when a signed update is live)
// + a scrolling content lane. Renders ONLY when App's compy_v2 state is on; flag off, this tree
// never mounts and the app is byte-identical (tokens-v2-guard.test.ts pins the CSS side).
//
// The mockup's "Search or jump anywhere · Ctrl K" box was ABSENT here from V2-2 until 2026-08-11:
// CommandPalette was parked pending an owner call, and a search box that does nothing would have
// been a fake affordance. The owner called it — a tester could not navigate the app, "honestly my
// biggest gripe" — so the box lands WITH the palette behind it, exactly as that note required.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
// Side-effect import: guarantees the i18next instance is initialized (resources loaded, language
// resolved) before this file's t() calls ever run — same bootstrap src/i18n/language.ts relies on.
import "../i18n";
import { Wordmark } from "./Wordmark";
import { NavGlyph } from "./NavGlyph";
import { UpdatePill } from "./UpdatePill";
import { HOME_RAIL, type HomeRailId, type HomeRailItem } from "./homeRail";
import { useJarvisActive } from "./jarvis/use-jarvis";
import { useRoomIdentityFlag, useHudFrameFlag, useCommandPaletteFlag } from "./use-hud";
import { CommandPalette } from "./CommandPalette";
import type { LabStationKey } from "../surfaces/lab-guided-data";
import { RoomAccentPicker } from "./RoomAccentPicker";
import { PICKABLE_ROOMS, type PickableRoom } from "./room-identity";
import { LenisSpine } from "./jarvis/LenisSpine";
import { MagneticLayer } from "./jarvis/MagneticLayer";
import { HudFrame } from "./console/HudFrame";
import { ReticleCursor } from "./console/ReticleCursor";
import { useLedgerHealth, knownIncomplete } from "./LedgerHealthNotice";
import "./shell-v2.css";
import "./jarvis/jarvis.css";

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
  rig,
  onOpenStation,
  onOpenEntry,
  onOpenSettings,
  children,
}: {
  items: HomeRailItem[];
  activeId: HomeRailId | undefined;
  onNavigate: (id: HomeRailId) => void;
  ledgerCount: number;
  version: string;
  // Command-palette destinations beyond the rail. Each is the app's EXISTING single writer for that
  // kind of navigation, passed in rather than reached for — the shell owns chrome, not routing.
  // Any one omitted → the palette does not index that group, so it can never offer a dead door.
  onOpenStation?: (station: LabStationKey) => void;
  onOpenEntry?: (entryId: string) => void;
  onOpenSettings?: () => void;
  // Real hardware line for the HUD-frame readout ("CPU · GPU" from the probe); null until the
  // probe resolves — the readout omits the segment, never fabricates one.
  rig?: string | null;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // Resolves a rail item's CURRENT display label by stable id — the one place a lookup-by-id is
  // required instead of a straightforward t() call, because the merged-room "fix" entry is
  // relabeled "Optimize" (see homeRail.ts railFor) without its id changing.
  const railLabel = (item: HomeRailItem): string =>
    item.label === "Optimize" ? t("common.rail.optimize") : t(`common.rail.${item.id}`);
  // JARVIS motion layer (§A.3/A.5/A.6, flag compy_jarvis_motion DEFAULT ON + motion full). When
  // inactive (the "0" failsafe or reduced motion), none of the layer's nodes/attributes render and
  // the shell is byte-identical.
  const jarvis = useJarvisActive();
  // Per-room accent picker (owner 2026-07-12b) — the topbar-corner control appears only when the
  // room-identity flag is on; with it off, the topbar is byte-identical to today.
  const roomIdentity = useRoomIdentityFlag();
  // App-wide viewport HUD frame + shell-scoped reticle (compy_hud_frame, console-HUD §viewport
  // frame 2026-07-15, DEFAULT ON). "0" failsafe: neither mounts, and the stage-scoped reticle
  // instances (which self-defer while this is on) take back over — byte-identical shell.
  const hudFrame = useHudFrameFlag();
  // Command palette (compy_command_palette, DEFAULT ON). "0" failsafe: no topbar box, no Ctrl+K
  // binding, no overlay — the shell is byte-identical to the pre-palette tree.
  const paletteEnabled = useCommandPaletteFlag();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // §A.6 retune wipe — replays once per ROOM change (keyed remount), never on first paint and
  // never on a bare flag flip (the ref tracks rooms unconditionally so a flip alone can't
  // fabricate a "navigation"). Removes itself on animationend.
  const [wipe, setWipe] = useState(0);
  const prevRoomRef = useRef(activeId);
  useEffect(() => {
    const changed = prevRoomRef.current !== activeId;
    prevRoomRef.current = activeId;
    if (changed && jarvis) setWipe((w) => w + 1);
  }, [activeId, jarvis]);

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

  // Ledger health, for the footer count below. The rail is app-level chrome, so this one probe is
  // what stops EVERY room — including the ones that never mounted a health check of their own —
  // from printing a ledger total the record can't vouch for. Probed HERE rather than lifted into
  // App.tsx on purpose: a prop can be forgotten at a call site, and this gate must not be
  // forgettable. Cost is one cheap file-existence read per shell mount. Fails → UNKNOWN → the
  // footer reads exactly as it does today.
  const ledgerUnvouched = knownIncomplete(useLedgerHealth(ledgerCount));

  // Digit shortcuts 1..N (the rail's kbd hints must WORK — a hint that does nothing is a fake
  // affordance). Never while typing, never with a modifier held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The palette owns the keyboard while it is open — otherwise typing "1" into the search box
      // would ALSO jump a room out from under the overlay. (The typing-target check below already
      // covers the input itself; this covers the moment before focus lands.)
      if (paletteOpen) return;
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
  }, [items, onNavigate, paletteOpen]);

  // Ctrl+K / Cmd+K opens the palette. A shortcut alone would be invisible to the exact user this
  // was built for, which is why the visible topbar box below is the primary affordance and this is
  // the accelerator — not the other way round. Works from anywhere, including inside a text field,
  // because that is the one thing every user who knows the shortcut expects it to do.
  useEffect(() => {
    if (!paletteEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.ctrlKey || e.metaKey) || e.defaultPrevented) return;
      e.preventDefault();
      setPaletteOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteEnabled]);

  const active = items.find((i) => i.id === activeId);
  const nav: V2Nav = {
    navigate: onNavigate,
    labelFor: (id) => {
      const item = items.find((r) => r.id === id) ?? HOME_RAIL.find((r) => r.id === id);
      return item ? railLabel(item) : id;
    },
  };

  return (
    <V2NavContext.Provider value={nav}>
      <div className={hudFrame ? "v2-shell v2-shell-hud" : "v2-shell"} ref={shellRef}>
        <nav className="v2-rail" aria-label={t("common.shellV2.navAriaLabel")}>
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
                title={railLabel(item)}
                {...(jarvis ? { "data-magnetic": "" } : {})}
              >
                <NavGlyph name={item.icon} />
                <span>{railLabel(item)}</span>
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
          <div className="v2-foot">
            {/* Outbound honesty line (updater ARMED 2026-07-22): the signed update check is now
                Compy's ONE outbound call, so the old "Zero outbound connections" absolute would
                be a lie. Copy states exactly what leaves the machine; opt-in Receipts still
                gates separately and would change this line again when (if) it ships.
                Intentionally NOT run through t() — ShellV2.test.tsx pins this exact English
                sentence literally (screen.getByText("Outbound: signed update check only")), so
                this one line stays hardcoded English regardless of app language (i18n task note). */}
            <div className="v2-zero">
              <span className="v2-zero-led" aria-hidden="true" />
              Outbound: signed update check only
            </div>
            {/* The reversible/ledger line, gated on the same health check HomeHud and HomeV2 use.
                BOTH halves are false under an incomplete record, not just the count: changes made
                before a quarantine genuinely cannot be undone, so "Every change reversible" is the
                bigger lie of the two. The incomplete branch therefore replaces the WHOLE line
                rather than swapping the number out from under a prefix that stopped being true.
                Known-incomplete ONLY — UNKNOWN health leaves this byte-identical to today. */}
            {ledgerUnvouched ? (
              <div className="v2-ledger-state">
                <span className="v2-ledger-led" aria-hidden="true" />
                {t("common.shellV2.footerIncompletePre")}{" "}
                <span className="v2-mono">
                  {ledgerCount > 0
                    ? t("common.shellV2.footerEmphFloor", { n: ledgerCount })
                    : t("common.shellV2.footerEmphUnknown")}
                </span>
              </div>
            ) : (
              <div>
                {t("common.shellV2.footerPre")}{" "}
                <span className="v2-mono">{t("common.shellV2.footerEmph", { n: ledgerCount })}</span>
              </div>
            )}
          </div>
        </nav>

        <div className="v2-main">
          <div className="v2-top">
            <span className="v2-room-title">
              {active ? railLabel(active) : t("common.shellV2.fallbackTitle")}
            </span>
            {active && (
              <span className="v2-crumb">· {t(`common.shellV2.crumb.${active.id}`)}</span>
            )}
            {/* Search box. `v2-stamp` carries the margin-left:auto that pushes the right-hand
                cluster over, so this sits before it and the cluster order is unchanged. */}
            {paletteEnabled && (
              <button
                type="button"
                className="v2-search"
                onClick={() => setPaletteOpen(true)}
                {...(jarvis ? { "data-magnetic": "" } : {})}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M10.5 10.5 L14 14"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="v2-search-label">{t("common.shellV2.searchPlaceholder")}</span>
                <kbd>Ctrl K</kbd>
              </button>
            )}
            {stamp && <span className="v2-stamp">{stamp}</span>}
            <UpdatePill />
            {roomIdentity && active && PICKABLE_ROOMS.includes(active.id as PickableRoom) && (
              <RoomAccentPicker room={active.id as PickableRoom} roomLabel={railLabel(active)} />
            )}
          </div>
          <div className="v2-content" ref={contentRef}>
            <div className="v2-content-wrap" ref={wrapRef}>
              {children}
            </div>
          </div>
          {jarvis && wipe > 0 && (
            <div
              key={wipe}
              className="jv-retune"
              aria-hidden="true"
              // Native listener (ref cleanup, React 19): the synthetic onAnimationEnd never
              // fires in this webview/jsdom pairing — the native event is the reliable one.
              ref={(el) => {
                if (!el) return;
                const done = () => setWipe(0);
                el.addEventListener("animationend", done, { once: true });
                return () => el.removeEventListener("animationend", done);
              }}
            />
          )}
        </div>
        {jarvis && <LenisSpine wrapperRef={contentRef} contentRef={wrapRef} />}
        {jarvis && <MagneticLayer scopeRef={shellRef} />}
        {hudFrame && <HudFrame rig={rig ?? null} />}
        {hudFrame && <ReticleCursor scopeRef={shellRef} appWide />}
        {paletteEnabled && (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            rail={items}
            railLabel={railLabel}
            onNavigate={onNavigate}
            onOpenStation={onOpenStation}
            onOpenEntry={onOpenEntry}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
    </V2NavContext.Provider>
  );
}
