// V2 product shell (V2-2, spec 2026-07-02-v2-shell-sourcing-and-plan) — the Linear/Geist-discipline
// chrome from the owner-approved mockup: 216px rail (wordmark · rooms with digit hints · the
// outbound-honesty/reversible footer) + 46px topbar (room title · search · update pill when a
// signed update is live)
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
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized (resources loaded, language
// resolved) before this file's t() calls ever run — same bootstrap src/i18n/language.ts relies on.
import "../i18n";
import { Wordmark } from "./Wordmark";
import { NavGlyph } from "./NavGlyph";
import { UpdatePill } from "./UpdatePill";
import { HOME_RAIL, railGroups, type HomeRailId, type HomeRailItem } from "./homeRail";
import { useJarvisActive } from "./jarvis/use-jarvis";
import { useRoomIdentityFlag, useHudFrameFlag, useCommandPaletteFlag } from "./use-hud";
import { CommandPalette } from "./CommandPalette";
import type { LabStationKey } from "../surfaces/lab-guided-data";
import type { InterviewFindingId } from "../surfaces/home-interview-data";
import { RoomAccentPicker } from "./RoomAccentPicker";
import { PICKABLE_ROOMS, type PickableRoom } from "./room-identity";
import { LenisSpine } from "./jarvis/LenisSpine";
import { MagneticLayer } from "./jarvis/MagneticLayer";
import { HudFrame } from "./console/HudFrame";
import { ReticleCursor } from "./console/ReticleCursor";
import { useLedgerHealth, knownIncomplete } from "./LedgerHealthNotice";
import { undoTally } from "../data/live-changes";
import type { AppliedChange } from "../types";
import { LookButton, useLook } from "./LookPanel";
import "./shell-v2.css";
import "./jarvis/jarvis.css";

// Plain-English crumb per room (topbar wayfinding). Says what the room is FOR — Sarah & Caleb bar.
export const ROOM_CRUMB: Record<HomeRailId, string> = {
  home: "how your PC is doing",
  games: "make a game run better",
  problems: "find out what went wrong",
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

// The topbar's PC pill prints the probe's own names with the vendor boilerplate trimmed, so a
// 1440px window shows "Ryzen 7 9850X3D · RX 9070 XT" instead of cutting off at "AMD Ryzen 7 98…".
// Trimming only removes words; it never invents or reorders one. The full line stays in the
// accessibility tree.
export function shortRig(rig: string): string {
  return rig
    .split(" · ")
    .map((part) =>
      part
        .replace(/\((R|TM|tm|r)\)/g, "")
        .replace(/\b\d+-Core Processor\b/i, "")
        .replace(/\bProcessor\b/i, "")
        .replace(/\bCPU @ .*$/i, "")
        .replace(/^(AMD|Intel|NVIDIA)\s+/i, "")
        .replace(/^(GeForce|Radeon)\s+(?=(RTX|GTX|RX)\b)/i, "")
        .replace(/^Core\s+/i, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join(" · ");
}

export function ShellV2({
  items,
  activeId,
  onNavigate,
  ledger,
  rig,
  onOpenStation,
  tuningStation,
  onOpenEntry,
  onOpenSettings,
  onOpenIntent,
  badges,
  children,
}: {
  items: HomeRailItem[];
  activeId: HomeRailId | undefined;
  onNavigate: (id: HomeRailId) => void;
  /** The Trust Ledger rows as `get_applied_changes` returned them; null until they have been read.
   *  The footer counts what can be undone from these (`undoTally`, the Applied cards' groups). */
  ledger: readonly AppliedChange[] | null;
  /** Glass redesign: a count shown on a dock door (Problems: an incident waiting to be looked at).
   *  Only real counts are passed; absent or 0 draws nothing. */
  badges?: Partial<Record<HomeRailId, number>>;
  // Command-palette destinations beyond the rail. Each is the app's EXISTING single writer for that
  // kind of navigation, passed in rather than reached for — the shell owns chrome, not routing.
  // Any one omitted → the palette does not index that group, so it can never offer a dead door.
  onOpenStation?: (station: LabStationKey) => void;
  /** false = no Tuning station on this PC (CommandPalette's own note). */
  tuningStation?: boolean;
  onOpenEntry?: (entryId: string) => void;
  onOpenSettings?: () => void;
  /** P7-palette: a plain problem typed here opens the Home interview at its finding's card. */
  onOpenIntent?: (finding: InterviewFindingId) => void;
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
  // GLASS REDESIGN (owner decision 2026-10-30): the viewport brackets and the reticle cursor belong
  // to the console look. Over glass they read as a second frame on top of the picture, so they draw
  // only on the Solid surface, which is the classic look. The flag still governs Solid.
  const look = useLook();
  const hudFrame = useHudFrameFlag() && look.surface === "solid";
  /**
   * ...EXCEPT IN TEST, WHERE THE ROOM IS ALREADY THE INSTRUMENT.
   *
   * The frame's own doctrine is that it shows only what no other chrome shows, and Health already
   * stands the rig segment down on exactly that ground. Test breaks it harder than Health did: the
   * room's whole upper panel IS the 3D rig, named and annotated, so the bottom-right readout prints
   * the processor and GPU a third time — and it does it inside a bench that draws its own edge, so
   * the four viewport brackets read as a second frame competing with the first. The approved Test
   * composition has neither (verified 2026-08-27 by cropping the comp's own bottom-right corner:
   * empty), and the owner rejected the installed build for, among other things, "an unapproved
   * competing layer".
   *
   * Standing it down as a CLASS, not just a mount, is the load-bearing half: `.v2-shell-hud` also
   * reserves a 36px band at the foot of the scroll lane for the readout. A room with no readout
   * that still gave up 36px would be paying rent on a tenant who moved out — and at 1280x720, that
   * band is a station row.
   *
   * Room id "lab" is the tab labelled Test. Guard: hud-frame-room-standdown-guard.test.tsx.
   */
  const hudFrameHere = hudFrame && activeId !== "lab";
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

  // THE LANE GOES BACK TO ITS TOP ON EVERY ROOM CHANGE (DIR-1 first-timer walk, 2026-08-26,
  // finding #1). `.v2-content` below is ONE scroll container shared by every room and nothing ever
  // reset it, so the app handed a new room the PREVIOUS room's scroll offset: measured on the
  // installed build — scroll History to 300px, click Health, Health opens already 300px down. The
  // cost lands on exactly the person this walk was for: Live's only button ("Start capture") sits
  // 466px above the fold on a fresh visit, and a first-timer arriving mid-page sees a room with
  // nothing to press and no reason to suspect there is.
  //
  // Deliberately NOT part of the motion layer, and deliberately not smooth: this is navigation
  // MECHANICS (a room must be at its top the instant it paints), so it runs with `jarvis` off, with
  // reduced motion, and on the failsafe rails. Nothing is hidden and nothing is gated — the same
  // content is there, the reader just starts at its beginning.
  useEffect(() => {
    const lane = contentRef.current;
    if (!lane) return;
    lane.scrollTop = 0;
    // While the motion layer is on, Lenis owns this lane and eases toward a target of its own, so a
    // bare scrollTop write can be pulled back by the next frame of an in-flight lerp. The spine
    // listens for this and hard-syncs; with the layer off nothing is listening and the write above
    // is the whole fix. An event rather than a ref because LenisSpine's effect deps must stay
    // stable — adding a reset key to them would tear down and rebuild the Lenis instance per room.
    window.dispatchEvent(new CustomEvent("compy:lane-reset"));
  }, [activeId]);

  // NO BUILD-STAMP PROBE HERE. The topbar used to invoke `get_build_stamp` on every shell mount and
  // print `555e2996 · release` beside the room name. The command still exists and Settings → About
  // still shows it — that is where the navigation audit put build identifiers (§4), and it is the
  // surface a user visits deliberately rather than one they cannot escape. The invoke went with the
  // render on purpose: an IPC call per mount whose only consumer was deleted chrome is pure cost,
  // and Compy's standing bar is to be the least resource-hungry app on the machine.
  //
  // `get_build_stamp` remains the ship-verification path (CLAUDE.md: verify live == build via the
  // STAMP over a CDP port, never an exe hash) — that calls the COMMAND, not this DOM node, so
  // removing the node does not touch it.

  // Ledger health, for the footer count below. The rail is app-level chrome, so this one probe is
  // what stops EVERY room — including the ones that never mounted a health check of their own —
  // from printing a ledger total the record can't vouch for. Probed HERE rather than lifted into
  // App.tsx on purpose: a prop can be forgotten at a call site, and this gate must not be
  // forgettable. Cost is one cheap file-existence read per shell mount. Fails → UNKNOWN → the
  // footer reads exactly as it does today.
  const ledgerUnvouched = knownIncomplete(useLedgerHealth(ledger));
  const ledgerCount = ledger?.length ?? 0;
  // CR-footer-reversible: the line says only what the ledger it read can undo, counted from the
  // groups the Applied cards draw their Undo buttons from; rows not read yet print no claim.
  const tally = useMemo(() => (ledger ? undoTally(ledger) : null), [ledger]);

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
      <div className={hudFrameHere ? "v2-shell v2-shell-hud" : "v2-shell"} ref={shellRef}>
        {/* The picture behind the glass (Look → Backdrop). Purely decorative and static: one
            image, drawn once, no animation — the idle-cost bar is unchanged. Solid hides it. */}
        <div className="v2-backdrop" aria-hidden="true" />
        <nav className="v2-rail" aria-label={t("common.shellV2.navAriaLabel")}>
          {/* NO VERSION NUMBER HERE. Build identifiers are developer furniture, and the navigation
              audit ruled they belong in Settings → About, not in consumer chrome on every screen
              (docs/decisions/2026-08-11-design-navigation-audit.md §4). About already carries
              `v{appVersion}` AND the build stamp, and is test-pinned (Settings.test.tsx), so this
              is a removal with a destination, not a loss. The `version` prop went with it — a prop
              kept alive for a render that no longer exists is the next session's red herring. */}
          <div className="v2-wordmark">
            <Wordmark size={16} />
          </div>
          {/* Design foundation ⑤ — instruments behind a door. The rail is two groups, not four
              equal tabs: Health (the front door, full weight) and, under its own sign, the three
              instruments at a quieter weight. Every room stays rendered and digit-addressable —
              the digit is the item's position in the WHOLE rail, so "2" still means Live. */}
          <div className="v2-nav">
            {(["door", "instruments"] as const).map((group) => {
              const rooms = railGroups(items)[group];
              if (rooms.length === 0) return null;
              return (
                <div key={group} className={`v2-nav-group v2-nav-${group}`}>
                  {group === "instruments" && (
                    <div className="v2-nav-eyebrow" id="v2-nav-deeper">
                      {t("common.shellV2.deeperGroup")}
                    </div>
                  )}
                  <div role="tablist" aria-labelledby={group === "instruments" ? "v2-nav-deeper" : undefined}>
                    {rooms.map((item) => {
                      const i = items.indexOf(item);
                      const badge = badges?.[item.id] ?? 0;
                      return (
                        <button
                          key={item.id}
                          role="tab"
                          aria-selected={activeId === item.id}
                          className="v2-nav-item"
                          onClick={() => onNavigate(item.id)}
                          // NO `title` HERE (#213 A4). It carried the same string the <span> below
                          // renders, so hovering a nav item summoned the OS tooltip — white ground,
                          // black hairline, system font — over the rail, to say what was already on
                          // screen an inch away. A native control nobody styled, showing nothing
                          // new, is a rendering defect rather than a taste call. `title` still
                          // belongs on an icon-only control (the titlebar buttons keep theirs); it
                          // never belongs on a control that already shows its own label.
                          // Guard: shell-native-tooltip-guard.test.tsx.
                          // The digit is a keyboard hint, not part of the room's name. Left in the
                          // accessible name it concatenated into "Home1"/"Blackbook3" — a screen
                          // reader announced the shortcut as if it were the label, and every nav test
                          // that matched on name had to know about it. aria-keyshortcuts is the
                          // field that actually means "press this".
                          aria-keyshortcuts={String(i + 1)}
                          {...(jarvis ? { "data-magnetic": "" } : {})}
                        >
                          <NavGlyph name={item.icon} />
                          {/* In the glass dock this label is the hover/focus tooltip; it stays the
                              button's accessible name either way. */}
                          <span className="v2-nav-label">
                            {railLabel(item)}
                            {badge > 0 && (
                              <span className="v2-sr-only">
                                {", "}
                                {t("common.shellV2.badgeWaiting", { count: badge })}
                              </span>
                            )}
                          </span>
                          {badge > 0 && (
                            <span className="v2-nav-badge" aria-hidden="true">
                              {badge}
                            </span>
                          )}
                          <kbd aria-hidden="true">{i + 1}</kbd>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>

        <div className="v2-main">
          <div className="v2-top">
            {/* THE ROOM TITLE STAYS. Deleting it on 2026-08-22 rested on a re-reading of the
                comps that turns out to be false: Health's and Test's approved PNGs both print
                the room name here. Two comps keep it, two omit it, and a nameless bar in two
                rooms out of four is not a rule anyone designed — see shell-v2.css. */}
            {/* The PC this is (glass redesign): the real hardware line from the probe, never a
                guess — absent until the probe resolves. Display only; it is not a button. */}
            {rig && (
              <span className="v2-rig-pill">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" />
                  <path d="M8 20h8M12 16v4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
                <span className="v2-rig-text" aria-hidden="true">
                  {shortRig(rig)}
                </span>
                <span className="v2-sr-only">{rig}</span>
              </span>
            )}
            <span className="v2-room-title">
              {active ? railLabel(active) : t("common.shellV2.fallbackTitle")}
            </span>
            {/* NO TAGLINE HERE. The topbar printed `Live · watch it live` while the room below
                printed its own name as an h1 — the title-header law violation the navigation audit
                measured and ruled on: "drop the topbar tagline; keep one name per room"
                (docs/decisions/2026-08-11-design-navigation-audit.md §3 + order-of-work #3, shipped
                2026-08-18, six days late). The crumb STRINGS stay — CommandPalette reads the same
                `common.shellV2.crumb.*` keys as its per-door hint, where the room's own h1 is NOT on
                screen, so there it describes rather than duplicates. */}
            {/* The right-hand cluster is pushed over by this spacer, NOT by a margin-left:auto on
                its first member. `.v2-stamp` used to carry that margin, so deleting the stamp
                collapsed the whole cluster leftward against the room title. Every remaining member
                (search, update pill, accent picker) is CONDITIONAL, so hanging the margin on any
                one of them just moves the same bug behind a flag. An unconditional spacer cannot. */}
            <span className="v2-top-spacer" aria-hidden="true" />
            {/* Search box. */}
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
            <UpdatePill />
            {roomIdentity && active && PICKABLE_ROOMS.includes(active.id as PickableRoom) && (
              <RoomAccentPicker room={active.id as PickableRoom} roomLabel={railLabel(active)} />
            )}
            <LookButton />
          </div>
          <div className="v2-content" ref={contentRef}>
            <div className="v2-content-wrap" ref={wrapRef}>
              {children}
            </div>
          </div>
          {/* GLASS REDESIGN: the footer left the rail when the rail became a 64px dock. Both lines
              (the outbound disclosure and the ledger state) stay on every screen, now as the slim
              status line under the content instead of the rail's foot. */}
          <div className="v2-foot">
            {/* Outbound honesty line (updater ARMED 2026-07-22): the signed update check is now
                Compy's ONE outbound call, so the old "Zero outbound connections" absolute would
                be a lie. Copy states exactly what leaves the machine; opt-in Receipts still
                gates separately and would change this line again when (if) it ships.
                Through t() since CR-view-1111d-wording: the zh-CN footer printed this one line in
                English. The en string is still exactly the sentence ShellV2.test.tsx pins. */}
            <div className="v2-zero">
              <span className="v2-zero-led" aria-hidden="true" />
              {t("common.shellV2.footerOutbound")}
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
            ) : tally === null ? (
              // Rows not read yet (or the read failed): no count and no claim about undo.
              <div className="v2-undo-state">{t("common.shellV2.footerNotRead")}</div>
            ) : (
              // CR-footer-reversible: "Every change reversible" was printed on every screen while
              // rows had no undo. Now: how many changes the Applied cards can undo, then each kind
              // that can't be, by count. Nothing absolute.
              <div className="v2-undo-state">
                {[
                  tally.undoable > 0
                    ? t("common.shellV2.footerUndoable", { count: tally.undoable })
                    : t("common.shellV2.footerNothingToUndo"),
                  tally.noSavedUndo > 0 && t("common.shellV2.footerNoSavedUndo", { count: tally.noSavedUndo }),
                  tally.offOutside > 0 && t("common.shellV2.footerOffOutside", { count: tally.offOutside }),
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                · <span className="v2-mono">{t("common.shellV2.footerEmph", { n: ledgerCount })}</span>
              </div>
            )}
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
        {/* The readout shows only values NO other chrome shows (HudFrame.tsx doctrine). On
            Health the rig line is already on screen twice over -- the Detected record names the
            processor and GPU, and the 3D rig annotates them -- so it stands down there and the
            readout collapses to the clock. Room id "home" is the tab labelled Health.
            bug->guard, self-review round 2 (issue #49): hud-readout-no-duplicate-guard. */}
        {/* The topbar's PC pill now prints the rig line on every room, so the readout never repeats
            it (same no-duplicate rule as before, now app-wide). */}
        {hudFrameHere && <HudFrame rig={null} />}
        {hudFrame && <ReticleCursor scopeRef={shellRef} appWide />}
        {paletteEnabled && (
          <CommandPalette
            open={paletteOpen}
            onClose={() => setPaletteOpen(false)}
            rail={items}
            railLabel={railLabel}
            onNavigate={onNavigate}
            onOpenStation={onOpenStation}
            tuningStation={tuningStation}
            onOpenEntry={onOpenEntry}
            onOpenSettings={onOpenSettings}
            onOpenIntent={onOpenIntent}
          />
        )}
      </div>
    </V2NavContext.Provider>
  );
}
