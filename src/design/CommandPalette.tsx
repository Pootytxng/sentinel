// The command palette — one box that searches every destination in the app and goes there.
//
// The mockup's "Search or jump anywhere · Ctrl K" box was deliberately left out of ShellV2 in 2026-07
// because CommandPalette was parked and "a search box that does nothing would be a fake affordance".
// It is unparked now (owner, 2026-08-11): a tester could not navigate the app, and the owner named
// that his biggest gripe with it. So the box lands WITH the palette, exactly as that note required.
//
// NAVIGATION NEVER TELEPORTS (P6 law). Every action here calls the SAME writer the rest of the app
// already uses — onNavigate is the rail's handler, onOpenStation is App's single
// `openLabStation` (which persists the station intent BEFORE the room mounts, the one ordering that
// has to be right), onOpenEntry is the LibraryContext `openLibrary(focusId)` every inline glossary
// term uses, onOpenSettings is App's settings toggle. The palette adds a DOOR, never a second
// hallway: nothing here knows how navigation works, so it cannot drift from the rail.
//
// Anything the host cannot do, the palette does not offer — the index simply omits that group.
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import, same bootstrap ShellV2 relies on: guarantees the i18next instance is
// initialized before this file's t() calls run. Required here too — the palette is rendered
// directly in its own tests, where ShellV2's copy of this import never executes.
import "../i18n";
import type { HomeRailId, HomeRailItem } from "./homeRail";
import { labStations, LAB_STATION_ORDER, type LabStationKey } from "../surfaces/lab-guided-data";
import { KNOWLEDGE } from "../data/knowledge";
import {
  buildPaletteIndex,
  filterPalette,
  GROUP_LABEL,
  GROUP_ORDER,
  type PaletteItem,
} from "./command-palette-data";
import "./command-palette.css";

export type CommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  /** The rail the app is actually showing, and its current labels — so the palette can't offer a
   *  door the rail has retired, or call a room by a name the rail no longer uses. */
  rail: HomeRailItem[];
  railLabel: (item: HomeRailItem) => string;
  onNavigate: (id: HomeRailId) => void;
  /** App's single station-intent writer. Omitted → Lab instruments are not indexed. */
  onOpenStation?: (station: LabStationKey) => void;
  /** LibraryContext's openLibrary(focusId). Omitted → Blackbook entries are not indexed. */
  onOpenEntry?: (entryId: string) => void;
  onOpenSettings?: () => void;
};

export function CommandPalette({
  open,
  onClose,
  rail,
  railLabel,
  onNavigate,
  onOpenStation,
  onOpenEntry,
  onOpenSettings,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const index = useMemo(
    () =>
      buildPaletteIndex({
        rail,
        railLabel,
        // The SAME crumb the topbar prints for that room — the palette describes a door exactly the
        // way the room itself does. Read through t() rather than importing ShellV2's ROOM_CRUMB
        // constant, which would be a circular import (ShellV2 renders this component).
        roomHint: (id) => t(`common.shellV2.crumb.${id}`),
        stations: onOpenStation
          ? (() => {
              const all = labStations(t);
              // "optimize" first: it is the fixes station, the one people are most often sent to,
              // and it sits outside LAB_STATION_ORDER (that list is the dock's own order).
              const keys: LabStationKey[] = ["optimize", ...LAB_STATION_ORDER];
              return keys
                .filter((k, i) => keys.indexOf(k) === i && all[k])
                .map((key) => ({ key, info: all[key] }));
            })()
          : undefined,
        entries: onOpenEntry ? KNOWLEDGE : undefined,
        settingsLabel: onOpenSettings ? t("common.palette.settingsLabel") : undefined,
        settingsHint: t("common.palette.settingsHint"),
      }),
    [rail, railLabel, onOpenStation, onOpenEntry, onOpenSettings, t],
  );

  const results = useMemo(() => filterPalette(index, query), [index, query]);

  // Reset per opening: a palette that reopens holding the last query makes the user clear it before
  // they can do the next thing, which is the opposite of "jump anywhere".
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Direct, not deferred through requestAnimationFrame: this effect runs after the DOM is
    // committed, so the input already exists and the ref is populated. (The shell-idle guard also
    // treats any rAF in the shell's import closure as a loop that owes a stand-down mechanism —
    // fair, and there is no reason to owe one for a single focus call.)
    inputRef.current?.focus();
  }, [open]);

  // Keep the cursor inside the result list as typing narrows it.
  useEffect(() => {
    setCursor((c) => (c >= results.length ? 0 : c));
  }, [results.length]);

  // Keep the highlighted row visible when arrowing past the fold.
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>('[data-cursor="1"]');
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);

  if (!open) return null;

  const run = (item: PaletteItem) => {
    // Close FIRST: every action below navigates, and an overlay still mounted over the room the user
    // just asked for is the jarring half-second that makes a palette feel broken.
    onClose();
    switch (item.action.kind) {
      case "room":
        onNavigate(item.action.room);
        break;
      case "station":
        onOpenStation?.(item.action.station);
        break;
      case "entry":
        onOpenEntry?.(item.action.entryId);
        break;
      case "settings":
        onOpenSettings?.();
        break;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (results.length === 0 ? 0 : (c + 1) % results.length));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (results.length === 0 ? 0 : (c - 1 + results.length) % results.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const item = results[cursor];
      if (item) run(item);
    }
  };

  // Group headers are rendered inline as the list is walked, so the DOM order IS the ranked order —
  // grouping never reorders results behind the user's back.
  let lastGroup: string | null = null;

  return (
    <div
      className="cp-scrim"
      // Clicking the backdrop dismisses; clicking the panel must not. Checking the target rather
      // than stopping propagation inside keeps the panel free of an event-eating wrapper.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="cp-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("common.palette.title")}
        onKeyDown={onKeyDown}
      >
        <div className="cp-field">
          <svg className="cp-field-icon" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-results"
            aria-activedescendant={results[cursor] ? `cp-${results[cursor].key}` : undefined}
            aria-autocomplete="list"
            placeholder={t("common.palette.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="cp-esc">Esc</kbd>
        </div>

        <div className="cp-results" id="cp-results" role="listbox" ref={listRef}>
          {results.length === 0 ? (
            // Names what was searched rather than a bare shrug — a dead end with no next move is the
            // thing this whole feature exists to remove.
            <div className="cp-empty">
              <strong>{t("common.palette.emptyTitle", { query })}</strong>
              <span>{t("common.palette.emptyHint")}</span>
            </div>
          ) : (
            results.map((item, i) => {
              const header =
                item.group !== lastGroup ? ((lastGroup = item.group), GROUP_LABEL[item.group]) : null;
              return (
                <div key={item.key}>
                  {header && <div className="cp-group">{header}</div>}
                  <button
                    id={`cp-${item.key}`}
                    role="option"
                    aria-selected={i === cursor}
                    data-cursor={i === cursor ? "1" : undefined}
                    className={i === cursor ? "cp-row cp-row-on" : "cp-row"}
                    // Mouse hover moves the cursor so keyboard and pointer never disagree about
                    // which row Enter would take.
                    onMouseMove={() => setCursor(i)}
                    onClick={() => run(item)}
                  >
                    <span className="cp-row-label">{item.label}</span>
                    {item.hint && <span className="cp-row-hint">{item.hint}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="cp-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {t("common.palette.footMove")}
          </span>
          <span>
            <kbd>↵</kbd> {t("common.palette.footOpen")}
          </span>
          <span className="cp-foot-count">
            {t("common.palette.footCount", { n: results.length })}
          </span>
        </div>
      </div>
    </div>
  );
}

export { GROUP_ORDER };
