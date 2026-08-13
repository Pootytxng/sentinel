// ══════════════════════════════════════════════════════════════════════════════════════════════
//  FIXTURE PREVIEW ENTRY — EVERY NUMBER ON THIS PAGE IS INVENTED. IT IS NOT A MEASUREMENT.
//  Served ONLY by docs/ui-sweep/fixture/vite.config.mts. The product build never sees this file,
//  and nothing in src/ imports it.
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS. Two of the Lab bench's states cannot be reached on the owner's machine without
// invoking `start_experiment`, which applies a real Windows change — review may not do that. This
// entry mounts the REAL <ExperimentBench /> against the build-time stub (see stub-core.ts) so the
// self-review law gets real CSS, real tokens, real layout, real pixels for those states.
//
// WHY NOT `import "src/main.tsx"`. The product entry calls `getCurrentWindow()` at module scope
// (throws outside Tauri) and imports no CSS at all — the stylesheets live on App.tsx. So the two
// halves are hand-replicated below: App.tsx's sheet chain, then main.tsx's pre-paint dataset block.
// Both are COPIES and can drift. `fixture-parity-guard.test.ts` is what keeps them honest.

import React from "react";
import ReactDOM from "react-dom/client";

// ── App.tsx's stylesheet chain, verbatim and IN ORDER (src/App.tsx:72-89) ─────────────────────
// Order is load-bearing: instrument.css must follow App.css so the accent re-point wins, and the
// v2/hud token layers must come after the classics. Any reordering here silently re-skins the
// screenshots and the review would be reporting on a look the app does not have.
import "../../../src/App.css";
import "../../../src/design/doorknob.css";
import "../../../src/design/instrument.css";
import "../../../src/Onboarding.css";
import "../../../src/arc-instrument.css";
import "../../../src/design/living-instrument.css";
import "../../../src/design/dashboard-skin.css";
import "../../../src/design/fonts-v2.css";
import "../../../src/design/tokens-v2.css";
import "../../../src/surfaces/room-identity.css";
import "../../../src/design/tokens-qpw.css";
import "../../../src/design/tokens-hud.css";
import "../../../src/surfaces/ambient-hud.css";

// ── One sheet BEYOND App.tsx's chain, and it is not optional ──────────────────────────────────
// lab-v2.css is imported by LabGround.tsx:16, not by App.tsx, so the chain above does not carry
// it. It must load here anyway: `:root[data-v2="on"] .v2-room[data-room="lab"]` is the DECLARING
// element for the whole --ix-* family that ExperimentBench.css resolves its palette from. A
// var() chain inside a custom property substitutes at its declaring element, so without this
// sheet AND the matching room wrapper below, the bench silently falls back to instrument.css's
// :root values — a different palette from the real app, under a banner claiming fidelity.
import "../../../src/surfaces/lab-v2.css";

// i18next init (side-effect import) before first render, same as src/main.tsx. Tauri-free.
import "../../../src/i18n";
import { readLanguage } from "../../../src/i18n/language";
import { applyMotionAttribute } from "../../../src/design/use-motion";
import { applyRoomAccents } from "../../../src/design/theme";
import ExperimentBench from "../../../src/surfaces/ExperimentBench";
// Same module instance the bench's aliased `@tauri-apps/api/core` import resolves to (both land on
// this directory's stub-core.ts), so this reads the state the bench is actually rendering.
import { getState } from "./stub-core";

// ══ src/main.tsx's pre-paint dataset block, hand-replicated ════════════════════════════════════
// The overlay branch is dropped on purpose: detecting it needs getCurrentWindow(). This page is
// always the main-window case, so it takes that branch's `else` unconditionally.
//
// Every attribute is set from the SAME localStorage keys and defaults as the product entry, so a
// non-default preference on this machine shows up in the preview exactly as it would in the app.

// Main window draws its own chrome. Inert here — WindowChrome.css is imported by WindowChrome.tsx,
// which this page does not render — but replicated so the <html> attribute set matches the app's.
document.documentElement.dataset.customChrome = "1";

try {
  const it = localStorage.getItem("compy_theme");
  const valid = ["midnight", "violet", "crimson", "emerald", "hearth"];
  const theme = it && valid.includes(it) ? it : "violet";
  document.documentElement.dataset.itheme = theme;
  if (theme === "hearth" && new Date().getMonth() === 11) {
    document.documentElement.dataset.hearthSeason = "december";
  }
} catch {
  document.documentElement.dataset.itheme = "violet";
}

try {
  if (localStorage.getItem("compy_living_instrument") !== "0") {
    document.documentElement.dataset.living = "on";
  }
} catch {
  document.documentElement.dataset.living = "on";
}

try {
  if (localStorage.getItem("compy_dash_v2") !== "0") {
    document.documentElement.dataset.dashV2 = "on";
  }
} catch {
  document.documentElement.dataset.dashV2 = "on";
}

// Unconditional, exactly as the product entry sets it. Every rule in tokens-v2.css AND the Lab
// token re-point above is scoped under [data-v2="on"] — drop this line and the preview renders
// an unskinned shell.
document.documentElement.dataset.v2 = "on";

try {
  if (localStorage.getItem("compy_editorial") !== "0") {
    document.documentElement.dataset.hud = "on";
  }
} catch {
  document.documentElement.dataset.hud = "on";
}

try {
  if (localStorage.getItem("compy_jarvis_motion") !== "0") {
    document.documentElement.dataset.jarvis = "on";
  }
} catch {
  document.documentElement.dataset.jarvis = "on";
}

try {
  if (localStorage.getItem("compy_room_identity") !== "0") {
    document.documentElement.dataset.roomIdentity = "on";
  }
} catch {
  document.documentElement.dataset.roomIdentity = "on";
}

applyRoomAccents();

try {
  document.documentElement.dataset.viewMode =
    localStorage.getItem("compy_view_mode") === "advanced" ? "advanced" : "basic";
} catch {
  document.documentElement.dataset.viewMode = "basic";
}

applyMotionAttribute();

document.documentElement.lang = readLanguage();

// ── The banner ────────────────────────────────────────────────────────────────────────────────
// Loud, fixed, and it names the state. A screenshot from this page must be unmistakable as a
// fixture at a glance — including months later, cropped, and out of context.
function FixtureBanner() {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 99999,
        background: "#ffd400",
        color: "#1a1400",
        font: '700 14px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: "0.02em",
        padding: "10px 16px",
        textAlign: "center",
        borderBottom: "3px solid #1a1400",
        textTransform: "uppercase",
      }}
    >
      Fixture preview — invented data, not a measurement
      <span style={{ display: "block", fontWeight: 500, textTransform: "none", opacity: 0.85 }}>
        state: <code>{getState()}</code> · no backend · Start / Conclude / Restore are blocked
      </span>
    </div>
  );
}

// The room wrapper is the real one from RoomShell (src/design/room-shell.tsx:86,93):
// <section class="v2-room" data-room="lab"> … <div class="v2-room-body">. It is what the Lab's
// --ix-* re-point selector matches — see the lab-v2.css note above. The rest of RoomShell (the
// verdict header, doors, quiet slot) is deliberately NOT replicated: it is chrome around the
// bench, not the subject of this review, and faking it would put invented copy on screen.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <FixtureBanner />
    <section className="v2-room" data-room="lab">
      <div className="v2-room-body">
        <ExperimentBench />
      </div>
    </section>
  </React.StrictMode>,
);
