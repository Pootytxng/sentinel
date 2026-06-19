import "./SetupLauncherCard.css";

// The always-present Home affordance that opens the Setup & Tour. Dispatches a window event (mirrors
// the app's `compy:open-settings` pattern) so it needs no prop threading through CommandCenter →
// DashboardV2. This is the "front door" that fixes onboarding being buried in Settings.

export const START_TOUR_EVENT = "compy:start-tour";

export function SetupLauncherCard() {
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
        <span className="stl-title">Set up &amp; tour Compy</span>
        <span className="stl-sub">
          A guided setup and a 3D fly-through of everything Compy does — about 2 minutes.
        </span>
      </span>
      <span className="stl-go" aria-hidden="true">
        Start ▸
      </span>
    </button>
  );
}
