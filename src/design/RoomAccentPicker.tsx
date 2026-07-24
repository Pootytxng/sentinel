// Per-room accent picker (owner 2026-07-12b: "offer within the tabs themselves a … little dropdown
// … to individually change the color theme for each window"). A small accent dot in the topbar
// corner that always reflects the ACTIVE room; tap opens a popover of curated swatches. Picking one
// overrides that room's accent (theme.ts setRoomAccent), persisted per room, re-skinning its chrome
// + rig + sparkline via the same scoped --v2-accent mechanism as the presets. "Reset to default"
// clears the pick (back to the room's identity preset).
//
// Rendered ONLY when the room-identity flag is on (ShellV2 gates it) — with the flag off the whole
// feature is inert, so the topbar is byte-identical to today. Curated swatches only (no free hex),
// so no pick can break the dark-ink-on-accent legibility law.
import { useEffect, useRef, useState } from "react";
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

// Swatch English `name` (room-identity.ts, NOT modified here) → stable camelCase i18n key, for the
// swatch tooltip/aria-label ONLY. These 14 entries mirror ROOM_ACCENT_SWATCHES exactly, in order;
// an unmapped future swatch just won't translate (`?? s.name` fallback below) rather than crash.
const SWATCH_NAME_KEYS: Record<string, string> = {
  "Violet": "violet",
  "Teal": "teal",
  "Amber": "amber",
  "Emerald": "emerald",
  "Sky": "sky",
  "Red": "red",
  "Yellow": "yellow",
  "Magenta": "magenta",
  "Cyan / Midnight": "cyanMidnight",
  "Red / Blue": "redBlue",
  "Lime / Cyan": "limeCyan",
  "Violet / Teal": "violetTeal",
  "Magenta / Violet": "magentaViolet",
  "Amber / Wine": "amberWine",
  "Sky / Emerald": "skyEmerald",
};

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

  // On a ROOM change: re-read this room's pick AND close any open popover, so it never keeps
  // floating over the new room while silently re-labelling (self-review round-2 catch). The shared
  // event only re-reads the pick (a mid-open pick from elsewhere shouldn't slam the popover shut).
  useEffect(() => {
    setPick(readRoomAccents()[room] ?? null);
    setOpen(false);
    const sync = () => setPick(readRoomAccents()[room] ?? null);
    window.addEventListener("compy:room-identity-changed", sync);
    return () => window.removeEventListener("compy:room-identity-changed", sync);
  }, [room]);

  // Close the popover on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const effective = pick ?? defaultRoomAccent(room);
  const choose = (hex: string | null) => {
    setRoomAccent(room, hex);
    setPick(hex);
    setOpen(false);
  };

  return (
    <div className="v2-accent-pick" ref={rootRef}>
      <button
        type="button"
        className="v2-accent-pick-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("common.roomAccentPicker.accentColorAriaLabel", { room: roomLabel })}
        title={t("common.roomAccentPicker.accentColorAriaLabel", { room: roomLabel })}
        onClick={() => setOpen((o) => !o)}
      >
        {/* swatchDotCss: flat fill for a single, diagonal split for a duo (both colours visible) */}
        <span className="v2-accent-dot" style={{ background: swatchDotCss(effective) }} aria-hidden="true" />
        <span className="v2-accent-caret" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="v2-accent-pop"
          role="menu"
          aria-label={t("common.roomAccentPicker.accentHeading", { room: roomLabel })}
        >
          <div className="v2-accent-pop-head">
            {t("common.roomAccentPicker.accentHeading", { room: roomLabel })}
          </div>
          <div className="v2-accent-grid">
            {ROOM_ACCENT_SWATCHES.map((s) => {
              const key = swatchKey(s);
              const selected = effective.toLowerCase() === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
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
            className="v2-accent-all"
            title={t("common.roomAccentPicker.applyToAllTitle")}
            onClick={() => {
              setAccentForAllRooms(effective);
              setPick(effective.toLowerCase());
              setOpen(false);
            }}
          >
            {t("common.roomAccentPicker.applyToAll")}
          </button>
          <button
            type="button"
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
