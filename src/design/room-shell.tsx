// RoomShell (V2-2, re-scoping the P6 journey spec onto the V2 shell) — ONE skeleton every room
// composes, five slots in FIXED order: verdict → primaryAction → body → quiet → forward door.
// The rail already reads in story order (Home → Optimize → Monitor → Blackbook → Lab); the door
// makes that order *felt*: one quiet forward door per room, none in Lab (the last chapter — a
// loop-back door would teach circles, not order). Rooms migrate onto this in V2-3..V2-7.
//
// Slot contracts (P6 spec, test-pinned in room-shell.test.tsx):
//   verdict       ONE plain-English line, measured facts only (honesty law). Required.
//   primaryAction ONE affordance, never two. Optional.
//   children      the room body (ranked list / room content). Required.
//   quiet         the "nothing else needs attention" expander. Optional.
//   aside         the EVIDENCE column (four-room direction, issue #49). Optional.
//   below         full-width content under both columns (split layout only). Optional.
//   door          derived from DOOR_MAP by room id — rooms cannot pick their own destination.
//   doorOpen      P6 §2 placement rules (V2-8): a room may CLOSE its door while its chapter is
//                 unfinished — Optimize opens it only in the apply-complete/all-clear state (the
//                 door is the reward for finishing, not a bypass); Monitor closes it during a
//                 live capture session. Rooms still never pick the destination or label.
//
// THE SPLIT (owner-approved four-room visual direction, 2026-08-22 — issue #49). All four
// approved comps are ONE composition, not four layouts: a narrative column (eyebrow → verdict →
// one-sentence sub → one primary action → quiet routes) beside an evidence column (the rig, the
// last session, the record tape). `aside` is that second column, and passing it is the ONLY way a
// room enters split layout — `data-layout="split"` is derived, never passed, so a room cannot ask
// for the geometry without supplying the evidence that justifies it.
//
// WHY NO WRAPPER DIVS. The split is done with grid areas in shell-v2.css over the SAME children
// this shell has always rendered, so a non-split room's DOM is byte-identical to before and every
// existing room selector, query and slot-order guard keeps resolving.
//
// READING ORDER is the handoff's accessibility acceptance line verbatim: verdict → primary action
// → focal evidence → supporting evidence → deeper tools. So `aside` — the focal evidence — comes
// out of the DOM directly after the verdict block and BEFORE the room body, which carries the
// supporting routes. Grid areas place it visually regardless, so the two orders are set
// independently and neither has to compromise for the other.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { HOME_RAIL, type HomeRailId } from "./homeRail";
import { useV2Nav } from "./ShellV2";
import { NavGlyph } from "./NavGlyph";
import { Icon } from "./Icon";

// The journey door map — copy + destinations are the P6 spec table, pinned literally by
// room-shell.test.tsx so a copy/destination drift fails CI. Keyed by rail id (home/fix/play/
// learn are the persisted nav keys for Home/Optimize/Monitor/Blackbook).
export const DOOR_MAP: Record<HomeRailId, { to: HomeRailId; label: string } | null> = {
  home: { to: "fix", label: "Find what's worth fixing" },
  fix: { to: "play", label: "Watch it live" },
  // Re-copied 2026-08-23 to the approved Live comp, which names the destination inside the
  // sentence and draws this as a route row rather than a doorknob. The DESTINATION is
  // untouched, and still the map's to give -- a room may not pick where its door leads.
  play: { to: "learn", label: "View all sessions in History" },
  learn: { to: "lab", label: "Open the instruments" },
  lab: null, // last chapter — the rail is the way home
  check: null, // legacy escape-hatch room (merge-off only) — outside the journey, no door
  // Glass redesign (2026-10-30): the two journey doors draw their own pages (surfaces/glass), not a
  // RoomShell chapter, so they carry no forward door of their own.
  games: null,
  problems: null,
};

// Ground-aware door resolution (the proving-ground rail, 2026-07-10 flip): the standalone
// Optimize room is gone, so home's door — same invitation — leads to the Lab, where the
// Optimize station now lives. Every other door is unchanged; the "fix" room itself is
// unreachable under ground so its entry never renders. Pure; pinned by room-shell.test.tsx.
export function doorFor(room: HomeRailId, ground: boolean): { to: HomeRailId; label: string } | null {
  if (ground && room === "home") return { to: "lab", label: "Find what's worth fixing" };
  return DOOR_MAP[room];
}

// THE ROUTE ROW (approved four-room comps, 2026-08-23): the same door, drawn as a list row --
// the destination's own rail glyph, the sentence, and a chevron at the far edge. The glyph is the
// RAIL's, not a new one: the row teaches which room it opens by showing the mark the user already
// clicks to get there. It navigates through the same V2Nav handler as the doorknob below, so
// navigation still never teleports.
export function RouteRow({ to, label }: { to: HomeRailId; label: string }) {
  const nav = useV2Nav();
  const icon = HOME_RAIL.find((r) => r.id === to)?.icon;
  return (
    <button type="button" className="v2-route-row" onClick={() => nav.navigate(to)}>
      {icon != null && <NavGlyph name={icon} />}
      <span className="v2-route-label">{label}</span>
      <span className="v2-route-chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

// The forward door: quiet chrome (text + arrow, no accent fill — a doorknob, not a CTA), and it
// navigates via the SAME rail handler (V2Nav context) — navigation never teleports.
export function ForwardDoor({ to, label }: { to: HomeRailId; label: string }) {
  const nav = useV2Nav();
  return (
    <button type="button" className="v2-door" onClick={() => nav.navigate(to)}>
      {label}
      <span className="v2-door-arrow" aria-hidden="true">→ {nav.labelFor(to)}</span>
    </button>
  );
}

export function RoomShell({
  room,
  notice,
  eyebrow,
  verdict,
  sub,
  measured,
  primaryAction,
  quiet,
  aside,
  below,
  footnote,
  doorOpen = true,
  children,
}: {
  room: HomeRailId;
  /** UX-1: a caveat that QUALIFIES the verdict, so it must print ABOVE it — a warning placed
   *  under its subject has already failed at its job. Before UX-1 the verdict lived in the
   *  room body and a caveat could simply precede it there; now the verdict is the h1, so the
   *  shell owns the one slot that outranks it. Renders nothing when null (the healthy case). */
  notice?: ReactNode;
  /** The room's `<RoomEyebrow>`, and its own slot rather than a passenger inside `verdict`
   *  ([#211](https://github.com/Pootytxng/sentinel/issues/211)). All four rooms used to pass the
   *  eyebrow as the first child of `verdict`, which put it INSIDE the `<h1>` — so the page's one
   *  top-level heading read as "Session monitor" + "Last session ran smooth — MortalShell2 at 191
   *  fps average", a document title that mutates with a live measurement. A heading that changes
   *  with data cannot be relied on for orientation, and a screen-reader user gets the room's name
   *  and its current readout welded into one string. It renders in the same place it always did,
   *  as the header's first child — just no longer inside the heading. */
  eyebrow?: ReactNode;
  verdict: ReactNode;
  sub?: ReactNode;
  measured?: ReactNode;
  primaryAction?: ReactNode;
  quiet?: ReactNode;
  /** The evidence column of the approved split (issue #49). Present ⇒ split layout. */
  aside?: ReactNode;
  /** Full-width content beneath BOTH columns — where a split room keeps everything that is
   *  real but below the fold. Content moves down here; it is never deleted to make a comp fit. */
  below?: ReactNode;
  /** The room's METHOD, stated in one padlocked sentence at the foot of the narrative column.
   *  Live and Test's approved comps draw it there; Health's and History's draw none, so this is a
   *  room's choice and not shell furniture. A room that states its method here also brings its
   *  forward door up with it, as the comp's route row: that column gets exactly ONE forward
   *  affordance, and leaving the bottom doorknob in place as well would make two of them. */
  footnote?: ReactNode;
  /** P6 §2 placement: false hides the room's door while its chapter is unfinished. Default open. */
  doorOpen?: boolean;
  children: ReactNode;
}) {
  // `compy_lab_ground` was retired in the 2026-08-06 generation prune — the proving-ground rail is
  // the only rail, so the ground argument is now the literal `true` rather than a flag read.
  const door = doorOpen ? doorFor(room, true) : null;
  // door.label (DOOR_MAP/doorFor, above) is the literal English source of truth — pinned verbatim
  // by room-shell.test.tsx, so it stays untranslated there. The door's copy depends only on the
  // ORIGIN room (home still shows "Find what's worth fixing", it just leads to the Lab), so a
  // room-keyed lookup here — with the pinned English as its fallback — localizes the rendered text
  // without touching that pinned constant.
  const { t } = useTranslation();
  const doorLabel = door ? t(`common.roomShell.door.${room}`, door.label) : null;
  return (
    <section className="v2-room" data-room={room} data-layout={aside != null ? "split" : undefined}>
      {notice != null && <div className="v2-notice-slot">{notice}</div>}
      <header className="v2-verdict">
        {eyebrow}
        <h1>{verdict}</h1>
        {sub != null && <span className="v2-verdict-sub">{sub}</span>}
        {primaryAction != null && <div className="v2-verdict-action">{primaryAction}</div>}
      </header>
      {measured != null && <div className="v2-measured">{measured}</div>}
      {aside != null && <aside className="v2-room-aside">{aside}</aside>}
      <div className="v2-room-body">{children}</div>
      {quiet != null && <div className="v2-quiet-slot">{quiet}</div>}
      {footnote != null && (
        <div className="v2-footnote-slot">
          {door && <RouteRow to={door.to} label={doorLabel!} />}
          <p className="v2-footnote">
            <Icon name="lock" size={14} />
            <span>{footnote}</span>
          </p>
        </div>
      )}
      {below != null && <div className="v2-room-below">{below}</div>}
      {door && footnote == null && <ForwardDoor to={door.to} label={doorLabel!} />}
    </section>
  );
}
