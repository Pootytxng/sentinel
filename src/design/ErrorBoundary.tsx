import React from "react";

// Top-level defense-in-depth: if any render throws (a storage SecurityError in a lazy initializer,
// a malformed-state crash, etc.) this catches it and shows a plain recovery screen instead of the
// white void a bare React tree renders on an uncaught throw. The app's own "Couldn't read your
// hardware" screen only guards the hardware-fetch path; this guards EVERYTHING, including crashes
// that happen before that branch is reached.
type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      // Inline styles on purpose: this must render even if a stylesheet failed to load, since the
      // boundary exists precisely to survive a broken startup.
      return (
        <div
          role="alert"
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
            padding: "32px",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
            color: "#e7e7ea",
            background: "#0d0d10",
          }}
        >
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
            Compy hit a snag starting up
          </h1>
          <p style={{ fontSize: "14px", opacity: 0.75, margin: 0, maxWidth: "34ch" }}>
            Something went wrong while loading. Restarting Compy usually clears it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "6px",
              padding: "9px 18px",
              fontSize: "14px",
              borderRadius: "8px",
              border: "1px solid #3a3a42",
              background: "#1b1b21",
              color: "#e7e7ea",
              cursor: "pointer",
            }}
          >
            Reload Compy
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
