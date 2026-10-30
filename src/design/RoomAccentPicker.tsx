// Per-room accent picker (owner 2026-07-12b: "offer within the tabs themselves a … little dropdown
// … to individually change the color theme for each window"). A small accent dot in the topbar
// corner that always reflects the ACTIVE room; tap opens a popover of curated swatches. Picking one
// overrides that room's accent (theme.ts setRoomAccent), persisted per room, re-skinning its chrome
// + rig + sparkline via the same scoped --v2-accent mechanism as the presets. "Reset to default"
// clears the pick (back to the room's identity preset).
//
// Rendered ONLY when the room-identity flag is on (ShellV2 gates it) — with the flag off the whole
// feature is inert, so the topbar is byte-identical to today. Curated swatches only (no free hex),
// so no pick can break the dark-ink-on-accent legibility law. Every option is a DUO — the
// room's plain-violet DEFAULT is a fall-back state restored by "reset", never a sixth swatch.
//
// KEYBOARD — the ARIA APG menu pattern (BACKLOG C-13 residual (b), issue #150). The popover has
// declared `role="menu"` since it shipped, but carried none of the behaviour that role promises:
// no roving tabindex, so every item sat in the tab order and a keyboard user paid one stop per item
// to cross the topbar; no arrow keys, so the role's own navigation contract was a claim the
// component did not honour; and no focus restoration, so closing dropped focus onto <body> and lost the
// user's place. axe cannot see any of this — it reads the roles, which were already correct — which
// is why it survived the C-13 sweep that landed axe-core.
//
// WHY MENU AND NOT `Picker` (design/Picker.tsx). Picker is the select-only combobox and keeps DOM
// focus on the trigger via aria-activedescendant, which is the stronger pattern where it applies:
// there is no focus to restore, so the drop-focus bug cannot happen. It does not apply here. This
// popover mixes a single-select set (the menuitemradio swatches) with two COMMANDS (apply-to-all,
// reset), and a listbox may not contain commands — so menu is the correct contract and this
// completes it. Picker's warning is still paid, deliberately: every close path below restores focus
// to the trigger, because a menu, unlike a combobox, must take focus to work at all.
//
// Navigation is ONE LINEAR RING over every item, not 2-D grid movement: the swatch grid's column
// count comes from CSS, so JS cannot know it without measuring, and a guessed column count
// navigates wrongly at the wrap. Up/Left step back, Down/Right step forward, both wrap, Home/End
// jump to the ends. Disabled items are skipped (reset is disabled while the room has no pick).
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";
import {
  ROOM_ACCENT_SWATCHES,
  defaultRoomAccent,
  swatchDotCss,
  swatchKey,
  type PickableRoom,
} from "./room-identity";
import { readRoomAccents, setAccentForAllRooms, setRoomAccent } from "./theme";
import "./room-accent-picker.css";

// Swatch English `name` (room-identity.ts) → stable camelCase i18n key, for the swatch
// tooltip/aria-label ONLY. These five entries mirror ROOM_ACCENT_SWATCHES exactly, in order; an
// unmapped future swatch just won't translate (`?? s.name` fallback below) rather than crash.
// Frozen to the owner's five hybrids on 2026-08-27 — the singles' keys and the two unnamed duos'
// keys (redBlue, amberWine) went with them, here and in both locale files.
const SWATCH_NAME_KEYS: Record<string, string> = {
  "Cyan / Midnight": "cyanMidnight",
  "Lime / Cyan": "limeCyan",
  "Violet / Teal": "violetTeal",
  "Magenta / Violet": "magentaViolet",
  "Sky / Emerald": "skyEmerald",
};

/** Menu item count: every swatch, then apply-to-all, then reset. The two trailing commands are part
 *  of the SAME ring as the swatches — they are menu items, and a keyboard user arrowing past the
 *  last swatch expects to reach them rather than dead-end. Exported so the guard counts the ring
 *  from the palette itself and cannot drift when a swatch is added. */
export const ACCENT_MENU_ITEM_COUNT = ROOM_ACCENT_SWATCHES.length + 2;

export function RoomAccentPicker({
  room,
  roomLabel,
}: {
  room: PickableRoom;
  roomLabel: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(() => readRoomAccents()[room] ?? null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // One slot per menu item, in ring order. Written by callback refs on render; read only while open.
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The single tabbable item (roving tabindex), and the one that holds real DOM focus.
  const [active, setActive] = useState(0);

  /** Close, and put focus back where the user can carry on from — the trigger. `restoreFocus` is
   *  false only for closes the user did not ask for, where stealing focus would yank them out of
   *  whatever they just did. */
  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // On a ROOM change: re-read this room's pick AND close any open popover, so it never keeps
  // floating over the new room while silently re-labelling (self-review round-2 catch). The shared
  // event only re-reads the pick (a mid-open pick from elsewhere shouldn't slam the popover shut).
  useEffect(() => {
    setPick(readRoomAccents()[room] ?? null);
    // Deliberately setOpen, not closeMenu: a room change is not the user closing the menu, so focus
    // stays wherever they put it.
    setOpen(false);
    const sync = () => setPick(readRoomAccents()[room] ?? null);
    window.addEventListener("compy:room-identity-changed", sync);
    return () => window.removeEventListener("compy:room-identity-changed", sync);
  }, [room]);

  // Close the popover on outside click or Escape. Escape lives here rather than on the popover so it
  // works wherever focus sits; both paths below decide focus deliberately rather than by accident.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // An outside CLICK is the user choosing somewhere else to be: close, but do not pull focus
      // back to the trigger and fight the thing they just clicked.
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) closeMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, closeMenu]);

  // Roving focus: when the active index moves (or the menu opens onto one), real DOM focus follows.
  // This is what makes the arrow keys mean anything to a screen reader, which announces the FOCUSED
  // item, not the styled one.
  useEffect(() => {
    if (!open) return;
    const el = itemRefs.current[active];
    // Opening onto the LAST item (End / ArrowUp from the trigger) can land on "reset to default"
    // while it is disabled — the refs do not exist yet at openWith() time, so disabled-skipping
    // cannot happen there and has to happen here, once the popover has actually rendered. Step
    // BACKWARD, because the only way to arrive on a disabled item is by arriving from beyond it.
    // Re-running with the corrected index is safe: the next pass lands on an enabled item and stops.
    if (el && el.disabled) {
      setActive((i) => seek(i, -1));
      return;
    }
    el?.focus();
  }, [open, active]);

  const effective = pick ?? defaultRoomAccent(room);
  const selectedIndex = ROOM_ACCENT_SWATCHES.findIndex((s) => swatchKey(s) === effective.toLowerCase());
  const choose = (hex: string | null) => {
    setRoomAccent(room, hex);
    setPick(hex);
    closeMenu();
  };

  /** First enabled item stepping from `from` by `dir`, wrapping. Returns `from` when nothing else is
   *  enabled, so a menu with a single live item never returns -1 and never drops focus. */
  const seek = (from: number, dir: 1 | -1): number => {
    const n = ACCENT_MENU_ITEM_COUNT;
    for (let step = 1; step <= n; step++) {
      const i = (((from + dir * step) % n) + n) % n;
      if (!itemRefs.current[i]?.disabled) return i;
    }
    return from;
  };
  const firstEnabled = () => (itemRefs.current[0]?.disabled ? seek(0, 1) : 0);
  const lastEnabled = () => {
    const last = ACCENT_MENU_ITEM_COUNT - 1;
    return itemRefs.current[last]?.disabled ? seek(last, -1) : last;
  };

  /** Open onto a chosen item; the effect above moves focus once the popover has actually rendered. */
  const openWith = (index: number) => {
    setActive(index);
    setOpen(true);
  };
  // Land on the current pick — the item the user is most likely changing away from.
  const openIndex = () => (selectedIndex >= 0 ? selectedIndex : 0);

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (open) return; // while open, focus is inside the menu and the menu's handler owns the keys
    const k = e.key;
    if (k === "ArrowDown" || k === "Enter" || k === " " || k === "Spacebar") {
      e.preventDefault();
      openWith(openIndex());
    } else if (k === "ArrowUp" || k === "End") {
      e.preventDefault();
      openWith(ACCENT_MENU_ITEM_COUNT - 1);
    } else if (k === "Home") {
      e.preventDefault();
      openWith(0);
    }
  };

  // Delegated on the popover so the ring is defined once rather than copied onto 17 buttons.
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowRight") {
      e.preventDefault();
      setActive((i) => seek(i, 1));
    } else if (k === "ArrowUp" || k === "ArrowLeft") {
      e.preventDefault();
      setActive((i) => seek(i, -1));
    } else if (k === "Home") {
      e.preventDefault();
      setActive(firstEnabled());
    } else if (k === "End") {
      e.preventDefault();
      setActive(lastEnabled());
    } else if (k === "Tab") {
      // Tab leaves the whole control. Close and hand focus back to the trigger WITHOUT preventing
      // the default, so the browser's own Tab then carries on to the next topbar control — the menu
      // is one tab stop, which is the entire point of the roving tabindex.
      closeMenu();
    }
  };

  /** Roving tabindex: exactly one item is reachable by Tab; the rest are reachable only by arrow. */
  const itemTabIndex = (index: number) => (index === active ? 0 : -1);

  return (
    <div className="v2-accent-pick" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="v2-accent-pick-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("common.roomAccentPicker.accentColorAriaLabel", { room: roomLabel })}
        title={t("common.roomAccentPicker.accentColorAriaLabel", { room: roomLabel })}
        onClick={() => (open ? closeMenu() : openWith(openIndex()))}
        onKeyDown={onTriggerKeyDown}
      >
        {/* swatchDotCss: flat fill for a single, diagonal split for a duo (both colours visible) */}
        {/* No pick = the room follows the theme (glass redesign 2026-10-30), so the dot shows the
            theme's accent rather than the old fixed violet default. */}
        <span
          className="v2-accent-dot"
          style={{ background: pick ? swatchDotCss(pick) : "var(--v2-accent)" }}
          aria-hidden="true"
        />
        <span className="v2-accent-caret" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="v2-accent-pop"
          role="menu"
          aria-label={t("common.roomAccentPicker.accentHeading", { room: roomLabel })}
          onKeyDown={onMenuKeyDown}
        >
          <div className="v2-accent-pop-head">
            {t("common.roomAccentPicker.accentHeading", { room: roomLabel })}
          </div>
          <div className="v2-accent-grid">
            {ROOM_ACCENT_SWATCHES.map((s, i) => {
              const key = swatchKey(s);
              const selected = effective.toLowerCase() === key;
              return (
                <button
                  key={key}
                  type="button"
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={itemTabIndex(i)}
                  className={"v2-accent-swatch" + (selected ? " is-selected" : "")}
                  style={{ background: swatchDotCss(key) }}
                  title={t(`common.roomAccentPicker.swatchNames.${SWATCH_NAME_KEYS[s.name] ?? s.name}`, s.name)}
                  aria-label={t(`common.roomAccentPicker.swatchNames.${SWATCH_NAME_KEYS[s.name] ?? s.name}`, s.name)}
                  onClick={() => choose(key)}
                />
              );
            })}
          </div>
          {/* One-tap whole-app match (owner taste call 2026-07-23): stamps the CURRENT accent on
              every room. A one-shot action, not a mode — per-room picking keeps working exactly as
              before, and there is no hidden state to remember. */}
          <button
            type="button"
            ref={(el) => {
              itemRefs.current[ROOM_ACCENT_SWATCHES.length] = el;
            }}
            // Inside role="menu" every actionable child must be a menuitem — a bare <button> is
            // not one, so AT announced these two as loose controls with no place in the menu's
            // item count. Caught by axe (aria-required-children) the day the C-13 guard landed;
            // the swatches above already had it right.
            role="menuitem"
            tabIndex={itemTabIndex(ROOM_ACCENT_SWATCHES.length)}
            className="v2-accent-all"
            title={t("common.roomAccentPicker.applyToAllTitle")}
            // Carries this room's PICK, not its resolved `effective` accent. Since the freeze the
            // plain-violet default is deliberately NOT a whitelisted swatch, so passing `effective`
            // from an unpicked room would be rejected and apply-to-all would silently do nothing.
            // `null` means "this room is on its default", and clearing every room reaches exactly
            // the same visible state — the whole app on the default — honestly.
            onClick={() => {
              setAccentForAllRooms(pick);
              closeMenu();
            }}
          >
            {t("common.roomAccentPicker.applyToAll")}
          </button>
          <button
            type="button"
            ref={(el) => {
              itemRefs.current[ROOM_ACCENT_SWATCHES.length + 1] = el;
            }}
            role="menuitem"
            tabIndex={itemTabIndex(ROOM_ACCENT_SWATCHES.length + 1)}
            className="v2-accent-reset"
            onClick={() => choose(null)}
            disabled={pick == null}
          >
            {t("common.roomAccentPicker.resetToDefault")}
          </button>
        </div>
      )}
    </div>
  );
}
