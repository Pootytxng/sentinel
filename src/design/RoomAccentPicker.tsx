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
import {
  ROOM_ACCENT_SWATCHES,
  defaultRoomAccent,
  type PickableRoom,
} from "./room-identity";
import { readRoomAccents, setRoomAccent } from "./theme";
import "./room-accent-picker.css";

export function RoomAccentPicker({
  room,
  roomLabel,
}: {
  room: PickableRoom;
  roomLabel: string;
}) {
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
        aria-label={`${roomLabel} accent color`}
        title={`${roomLabel} accent color`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="v2-accent-dot" style={{ background: effective }} aria-hidden="true" />
        <span className="v2-accent-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="v2-accent-pop" role="menu" aria-label={`${roomLabel} accent`}>
          <div className="v2-accent-pop-head">{roomLabel} accent</div>
          <div className="v2-accent-grid">
            {ROOM_ACCENT_SWATCHES.map((s) => {
              const selected = effective.toLowerCase() === s.hex.toLowerCase();
              return (
                <button
                  key={s.hex}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  className={"v2-accent-swatch" + (selected ? " is-selected" : "")}
                  style={{ background: s.hex }}
                  title={s.name}
                  aria-label={s.name}
                  onClick={() => choose(s.hex)}
                />
              );
            })}
          </div>
          <button
            type="button"
            className="v2-accent-reset"
            onClick={() => choose(null)}
            disabled={pick == null}
          >
            Reset to default
          </button>
        </div>
      )}
    </div>
  );
}
