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

// ── One sheet that loads BEFORE App.tsx's chain in the real app ───────────────────────────────
// Settings.css is imported by Settings.tsx:35, which App.tsx pulls in at line 56 — sixteen lines
// ABOVE its own CSS chain. ESM evaluates imports depth-first in source order, so the shipped app
// inserts this sheet first, and it goes first here for the same reason rather than as a tidy
// afterthought. It owns every class the Q9a consent tile paints with (.set-row, .set-action,
// .set-row-title/-sub, .set-toggle, .receipts-hint, .receipts-preview); without it the tile
// renders as unstyled block text and the Toggle as a bare <button>, under a banner claiming these
// are the app's pixels.
import "../../../src/surfaces/Settings.css";

// ── App.tsx's stylesheet chain, verbatim and IN ORDER (src/App.tsx:72-89) ─────────────────────
// Order is load-bearing: instrument.css must follow App.css so the accent re-point wins, and the
// v2/hud token layers must come after the classics. Any reordering here silently re-skins the
// screenshots and the review would be reporting on a look the app does not have.
import "../../../src/design/type-scale.css";
import "../../../src/App.css";
import "../../../src/design/doorknob.css";
import "../../../src/design/instrument.css";
import "../../../src/arc-instrument.css";
import "../../../src/design/living-instrument.css";
import "../../../src/design/dashboard-skin.css";
import "../../../src/design/fonts-v2.css";
import "../../../src/design/tokens-v2.css";
import "../../../src/surfaces/room-identity.css";
import "../../../src/design/tokens-qpw.css";
import "../../../src/design/tokens-hud.css";
import "../../../src/surfaces/ambient-hud.css";
import "../../../src/surfaces/hud-rooms.css";

// ── One sheet BEYOND App.tsx's chain, and it is not optional ──────────────────────────────────
// lab-v2.css is imported by LabGround.tsx:16, not by App.tsx, so the chain above does not carry
// it. It must load here anyway: `:root[data-v2="on"] .v2-room[data-room="lab"]` is the DECLARING
// element for the whole --ix-* family that ExperimentBench.css resolves its palette from. A
// var() chain inside a custom property substitutes at its declaring element, so without this
// sheet AND the matching room wrapper below, the bench silently falls back to instrument.css's
// :root values — a different palette from the real app, under a banner claiming fidelity.
import "../../../src/surfaces/lab-v2.css";

// The shell's own sheet, imported by ShellV2.tsx rather than by App.tsx's chain. FirstWin does NOT
// render inside a room: App.tsx puts it directly in ShellV2's children, so its ancestry is
// `.v2-content > .v2-content-wrap` and nothing else. That wrap is what caps the card's measured
// width at 1160px and pads it 26/30 — the numbers a reviewer is judging line length against. A room
// wrapper here would be the more familiar-looking mount and the wrong one.
import "../../../src/design/shell-v2.css";

// And the Monitor room's re-point, for the same reason and by the same mechanism. The CPU-temp
// offer renders inside <section class="v2-room" data-room="play"> (MonitorV2.tsx:126), which is the
// DECLARING element for the --ix-* family CpuTempOffer.css resolves its accent, text and border
// from. Without this sheet the offer would paint in instrument.css's :root palette — a different
// accent from the shipped app, under a banner claiming fidelity.
import "../../../src/surfaces/monitor-v2.css";

// Play.css is imported by Play.tsx (line 32), which this page does not render — so the chain above
// does not carry it, and it owns the ONE element between the room body and the debrief card:
// `.play-debrief-wrap` (Play.css:311, padding 10px 2px 4px). Without it the card sits flush against
// the room body and every gap a reviewer measures at its top edge is 10px wrong.
import "../../../src/surfaces/Play.css";

// i18next init (side-effect import) before first render, same as src/main.tsx. Tauri-free.
import "../../../src/i18n";
import { readLanguage } from "../../../src/i18n/language";
import { applyMotionAttribute } from "../../../src/design/use-motion";
import { applyRoomAccents } from "../../../src/design/theme";
import ExperimentBench from "../../../src/surfaces/ExperimentBench";
// The CPU panel is mounted whole, not just the offer: the offer's job is to replace a dead-end
// sublabel on the temperature row, so the row above it is part of what review has to judge.
import { CpuTempOffer } from "../../../src/surfaces/CpuTempOffer";
// Q9a's consent tile. Dark in every build — see the stub's receipts section for why no build,
// flag, or stored value on the owner's machine reaches these pixels.
import ReceiptsConsent from "../../../src/surfaces/ReceiptsConsent";
// The crash station, whole. Compy Care Tier 1's known-issue block is a section INSIDE an incident
// card, so rendering it alone would prove nothing about the question the review has to answer:
// whether a user can tell Compy's own reading apart from somebody else's quoted write-up sitting
// directly under it.
import { BlackBox } from "../../../src/surfaces/BlackBox";
// Home's first-win follow-through. Reaching its verdicts for real means applying a Windows change
// and then pressing the card's own buttons; review may not do the first. The stub answers its read
// and its rollback instead, so the pixels are the app's.
import { FirstWin } from "../../../src/surfaces/FirstWin";
import type { AppliedChange } from "../../../src/types";

// The Live room's session debrief. Mounted for the same reason FirstWin is: its three offer
// branches need a real recorded gaming session AND a specific machine state to appear, so the
// shipped app cannot be put into any of them on demand. ConfirmProvider comes along because the
// card calls useConfirm() for the replace-a-pending-comparison dialog — App.tsx wraps the whole
// tree in one, so this is the app's ancestry, not scaffolding.
import { SessionDebrief } from "../../../src/surfaces/SessionDebrief";
import { ConfirmProvider } from "../../../src/design/ConfirmDialog";
import type { Priorities, Recommendation, SessionSummary } from "../../../src/types";
import { BentoGrid, BentoTile } from "../../../src/design/bento";
// Same module instance the bench's aliased `@tauri-apps/api/core` import resolves to (both land on
// this directory's stub-core.ts), so this reads the state the bench is actually rendering.
import {
  debriefProps,
  firstWinChanges,
  getState,
  isBlackboxState,
  isCpuTempState,
  isDebriefState,
  isFirstWinState,
  isReceiptsState,
} from "./stub-core";

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
        state: <code>{getState()}</code> · no backend ·{" "}
        {isReceiptsState()
          ? "the receipts gate is HARD-FALSE in every build — nothing is armed and nothing is sent"
          : isCpuTempState()
            ? "nothing is started — every CPU number here is invented"
            : isBlackboxState()
              ? "case intelligence is HARD-FALSE in every build — nothing was downloaded, verified or matched"
              : isFirstWinState()
                ? "no change was applied and none can be rolled back — the ledger row below is invented"
                : isDebriefState()
                  ? "the session below was never played and the offer is inert — pressing it changes nothing"
                  : "Start / Conclude / Restore are blocked"}
      </span>
    </div>
  );
}

// The room wrapper is the real one from RoomShell (src/design/room-shell.tsx:86,93):
// <section class="v2-room" data-room="lab"> … <div class="v2-room-body">. It is what the Lab's
// --ix-* re-point selector matches — see the lab-v2.css note above. The rest of RoomShell (the
// verdict header, doors, quiet slot) is deliberately NOT replicated: it is chrome around the
// bench, not the subject of this review, and faking it would put invented copy on screen.
// The CPU-temp states mount the Monitor room, the bench states the Lab room. Each room element is
// the declaring element for its own --ix-* re-point (see the sheet notes above), so the wrapper is
// not decoration — swap it and the palette in the screenshot stops being the app's.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <FixtureBanner />
    {isReceiptsState() ? (
      // NOT a room. The consent tile lives in Settings, whose root is `.set-root > .set-shell`
      // (Settings.tsx:182-183) with no `v2-room` wrapper anywhere in the tree — Settings.css
      // resolves the --ix-* family straight from :root. The header, tagline and the other nine
      // tiles are deliberately absent: they are chrome around the subject, and replicating them
      // would put invented copy beside a privacy disclosure. The grid stays because
      // ReceiptsConsent renders a `span="full"` BentoTile and a tile outside a grid is not the
      // shipped layout.
      <div className="set-root">
        <div className="set-shell">
          <BentoGrid>
            <ReceiptsConsent />
          </BentoGrid>
        </div>
      </div>
    ) : isCpuTempState() ? (
      // The offer used to be reviewed through CpuMonitorPanel, its 2026-08 host. That panel — and
      // the whole monitor-panels.tsx / MonitorDomainCards / MonitoringTab subtree behind it — was
      // deleted once it turned out no route rendered any of it, so reviewing the offer there was
      // reviewing it on a surface no user could reach. It now mounts the way HomeConsole:1274
      // mounts it: Health's room, a full-span BentoTile, shown only while nothing publishes a
      // temperature. The offer takes no props — its own get_sensor_sources read is the branch.
      <section className="v2-room" data-room="home">
        <div className="v2-room-body">
          <BentoGrid>
            <BentoTile title="CPU temperature" span="full">
              <CpuTempOffer />
            </BentoTile>
          </BentoGrid>
        </div>
      </section>
    ) : isBlackboxState() ? (
      // The Lab room, same as the bench — the station mounts under LabConsole's "blackbox" tab
      // (LabConsole.tsx), which lives inside the Lab room body. So the --ix-* re-point above is the
      // one the shipped app resolves the block's border, ground and text from.
      //
      // The scan is NOT auto-fired here. The station renders nothing until its scan button is
      // clicked, and that is true in the app too; a reviewer clicks it, which also exercises the
      // one transition the block has.
      <section className="v2-room" data-room="lab">
        <div className="v2-room-body">
          <BlackBox />
        </div>
      </section>
    ) : isFirstWinState() ? (
      // NOT a room, and that is the fidelity point. App.tsx renders FirstWin as a direct child of
      // ShellV2 (App.tsx, beside TrustMoment in the Overview tab) — ABOVE <HomeRoom>, not inside it
      // — so no `.v2-room` element is ever an ancestor and FirstWin.css resolves every token from
      // :root. Wrapping it in a room here would look more like the app and measure less like it.
      //
      // The card is mounted ALONE: the rest of Home is chrome around it, and replicating the vitals
      // would put invented hardware numbers on screen beside a trust surface. `onChanged` is the
      // app's refresh, which has nothing to re-read here — there is no backend.
      <div className="v2-content">
        <div className="v2-content-wrap">
          <FirstWin changes={(firstWinChanges() ?? []) as AppliedChange[]} onChanged={() => {}} />
        </div>
      </div>
    ) : isDebriefState() ? (
      // The Live room, and the card's real ancestry inside it: App.tsx renders <MonitorV2>, which
      // is a RoomShell with room="play" (MonitorV2.tsx:157) — so `.v2-room[data-room="play"]` is
      // the declaring element for the --ix-* family the card's accents resolve from — and Play.tsx
      // puts the card in `.play-debrief-wrap` (Play.tsx:488). The `.play-sessions > ul.play-list >
      // li` chain between them is skipped deliberately: none of the three declares a box rule
      // (`.play-list` is list-style:none, margin:0, padding:0), so replicating them would change
      // nothing measurable and would require hand-faking the session door button's copy above the
      // card — invented text beside a card whose whole subject is honest wording.
      //
      // `vendor` and `sessions` are OMITTED, which is a shape the card documents rather than one
      // this page invented: absent → the tuning cluster and the session investigator do not render
      // (SessionDebrief.tsx, the prop's own doc comment — "classic Sessions tab"). Supplying them
      // would put a second invented session and a fabricated undervolt history on screen above the
      // two sentences being reviewed.
      <section className="v2-room" data-room="play">
        <div className="v2-room-body">
          <div className="play-debrief-wrap">
            <ConfirmProvider>
              <SessionDebrief
                s={debriefProps()!.session as SessionSummary}
                priorities={debriefProps()!.priorities as Priorities | null}
                recs={debriefProps()!.recs as Recommendation[]}
                apply={async (r) => {
                  // eslint-disable-next-line no-console
                  console.log("FIXTURE PREVIEW - apply:", r.id, "(nothing was applied)");
                }}
                busyId={null}
                onExport={() => {
                  // eslint-disable-next-line no-console
                  console.log("FIXTURE PREVIEW - export: nothing was written");
                }}
                changes={[]}
                rollback={async () => {
                  // eslint-disable-next-line no-console
                  console.log("FIXTURE PREVIEW - rollback: nothing was rolled back");
                }}
              />
            </ConfirmProvider>
          </div>
        </div>
      </section>
    ) : (
      <section className="v2-room" data-room="lab">
        <div className="v2-room-body">
          <ExperimentBench />
        </div>
      </section>
    )}
  </React.StrictMode>,
);
