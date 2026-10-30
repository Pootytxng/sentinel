// Look panel (glass redesign, owner decision 2026-10-30). One topbar button opens a small panel with
// the three things that decide how Compy looks: the theme (the same five Settings themes, written
// through the same applyInstrumentTheme), the surface (glass / frosted / solid) and the backdrop
// behind the glass. Every choice applies at once and persists locally (theme.ts); nothing here
// touches the backend. Settings → Appearance stays the full page for the same theme choice.
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import {
  INSTRUMENT_THEMES,
  BACKDROP_CHOICES,
  SURFACE_STYLES,
  applyBackdrop,
  applyInstrumentTheme,
  applySurface,
  readBackdrop,
  readInstrumentTheme,
  readSurface,
  resolveBackdrop,
  type BackdropChoice,
  type InstrumentTheme,
  type SurfaceStyle,
} from "./theme";
import "./look-panel.css";

/** The live look, re-read whenever any writer announces a change (this panel or Settings). */
export function useLook(): { theme: InstrumentTheme; surface: SurfaceStyle; backdrop: BackdropChoice } {
  const read = () => ({ theme: readInstrumentTheme(), surface: readSurface(), backdrop: readBackdrop() });
  const [look, setLook] = useState(read);
  useEffect(() => {
    const sync = () => setLook(read());
    window.addEventListener("compy:look-changed", sync);
    return () => window.removeEventListener("compy:look-changed", sync);
  }, []);
  return look;
}

export function LookButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Outside click and Escape close the panel; Escape hands focus back to the button that opened it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      btnRef.current?.focus();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="v2-look" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="v2-look-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="v2-look-dot" aria-hidden="true" />
        {t("common.look.button")}
      </button>
      {open && <LookPanel />}
    </div>
  );
}

export function LookPanel() {
  const { t } = useTranslation();
  const look = useLook();
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
  }, []);
  const shownBackdrop = resolveBackdrop(look.backdrop, look.theme);

  return (
    <div className="v2-look-panel" role="dialog" aria-label={t("common.look.title")}>
      <p className="v2-look-title">{t("common.look.title")}</p>
      <p className="v2-look-sub">{t("common.look.sub")}</p>

      <p className="v2-look-label" id="v2-look-theme">
        {t("common.look.theme")}
      </p>
      <div className="v2-look-themes" role="radiogroup" aria-labelledby="v2-look-theme">
        {INSTRUMENT_THEMES.map((th, i) => (
          <button
            key={th.id}
            ref={i === 0 ? firstRef : undefined}
            type="button"
            role="radio"
            aria-checked={look.theme === th.id}
            className="v2-look-theme"
            data-theme-id={th.id}
            onClick={() => applyInstrumentTheme(th.id)}
          >
            <span className="v2-look-swatch" aria-hidden="true" />
            {t(`settings.appearance.themes.${th.id}`)}
          </button>
        ))}
      </div>

      <p className="v2-look-label" id="v2-look-surface">
        {t("common.look.surface")}
      </p>
      <div className="v2-look-seg" role="radiogroup" aria-labelledby="v2-look-surface">
        {SURFACE_STYLES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={look.surface === s}
            onClick={() => applySurface(s)}
          >
            {t(`common.look.surfaces.${s}`)}
          </button>
        ))}
      </div>

      <p className="v2-look-label" id="v2-look-backdrop">
        {t("common.look.backdrop")}
      </p>
      <div className="v2-look-backdrops" role="radiogroup" aria-labelledby="v2-look-backdrop">
        {BACKDROP_CHOICES.map((b) => (
          <button
            key={b}
            type="button"
            role="radio"
            aria-checked={look.backdrop === b}
            className="v2-look-bd"
            onClick={() => applyBackdrop(b)}
          >
            <span
              className="v2-look-thumb"
              data-thumb={b === "auto" ? shownBackdrop : b}
              aria-hidden="true"
            />
            {t(`common.look.backdrops.${b}`)}
          </button>
        ))}
      </div>
      {look.surface === "solid" && <p className="v2-look-note">{t("common.look.solidNote")}</p>}
    </div>
  );
}
