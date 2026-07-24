import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../../i18n";
import "./SetupLauncherCard.css";

// The always-present Home affordance that opens the Setup & Tour. Dispatches a window event (mirrors
// the app's `compy:open-settings` pattern) so it needs no prop threading through the Home surfaces.
// This is the "front door" that fixes onboarding being buried in Settings.

export const START_TOUR_EVENT = "compy:start-tour";

export function SetupLauncherCard() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="stl-card"
      onClick={() => window.dispatchEvent(new Event(START_TOUR_EVENT))}
    >
      <span className="stl-orb" aria-hidden="true">
        <span className="stl-ring" />
        <span className="stl-ring stl-ring-2" />
        <span className="stl-core" />
      </span>
      <span className="stl-text">
        <span className="stl-title">{t("home.setupLauncherCard.title")}</span>
        <span className="stl-sub">{t("home.setupLauncherCard.sub")}</span>
      </span>
      <span className="stl-go" aria-hidden="true">
        {t("home.setupLauncherCard.start")}
      </span>
    </button>
  );
}
