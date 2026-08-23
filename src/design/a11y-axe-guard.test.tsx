import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { expectNoAxeViolations } from "../test/axe";

import { Card, Panel, SectionHeader } from "./Card";
import { EmptyState } from "./EmptyState";
import { Gauge } from "./Gauge";
import { Icon } from "./Icon";
import { NavGlyph } from "./NavGlyph";
import { Stat } from "./Stat";
import { StatusPill } from "./StatusPill";
import { Sparkline } from "./Sparkline";
import { Wordmark } from "./Wordmark";
import { AnimatedNumber } from "./AnimatedNumber";
import { BackButton, ForwardButton } from "./BackButton";
import { SegmentedControl } from "./SegmentedControl";
import { Picker, type PickerOption } from "./Picker";
import { TrustSwitch, TrustSnapshotLine } from "./TrustSwitch";
import { SlimRecRow, SlimDetailRow } from "./SlimRecRow";
import { TrustCue } from "./TrustCue";
import { WhatsThis } from "./WhatsThis";
import { KonamiWhisper } from "./KonamiWhisper";
import { LedgerHealthNotice } from "./LedgerHealthNotice";
import { KeepaliveRoom } from "./KeepaliveRoom";
import { ErrorBoundary } from "./ErrorBoundary";
import { RoomAccentPicker } from "./RoomAccentPicker";
import { Walkthrough } from "./Walkthrough";
import { WalkthroughDisclosure } from "./WalkthroughDisclosure";
import { Term, GlossText } from "./Term";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";
import { LibraryContext } from "../surfaces/library-context";
import { walkthroughForKey } from "../surfaces/walkthroughs";
import { BentoGrid, BentoTile } from "./bento/BentoGrid";
import { Sheet } from "./bento/Sheet";
import { ArcGauge } from "./console/ArcGauge";
import { Dock } from "./console/Dock";
import { HudFrame } from "./console/HudFrame";
import { Oscilloscope } from "./console/Oscilloscope";
import { Reading } from "./console/Reading";
import CountUp from "./vendor/CountUp/CountUp";
import DecryptedText from "./vendor/DecryptedText/DecryptedText";
import ElectricBorder from "./vendor/ElectricBorder/ElectricBorder";
import SpotlightCard from "./vendor/SpotlightCard/SpotlightCard";

// C-13, rank 3 of the design foundation's tooling asks: axe-core in the vitest suite. This file is
// the roster — every design-system component that renders standalone, mounted at a REAL prop shape
// and checked for structural accessibility violations.
//
// It is a guard, not a report. A control that ships with no accessible name fails `npm test`.
//
// Read `src/test/axe.ts` before adding to this file: contrast is NOT checked here and cannot be
// (jsdom has no canvas, no layout, and `css: false` means no stylesheet is ever attached). The
// contrast/type floors live in `src/theme-contrast.test.ts` and `src/design/type-scale-guard.test.ts`;
// this harness adds the structural half those two were never able to reach.
//
// Coverage is not optional and not by memory: `a11y-census-guard.test.ts` fails when a new
// `src/design/*.tsx` component appears without being rostered here or given a named reason.

afterEach(cleanup);

const OPTIONS: PickerOption[] = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Bravo" },
  { value: "c", label: "Charlie", disabled: true },
];

/** Components that hold state need a live driver, not a frozen prop. */
function PickerHarness({ named }: { named: "aria-label" | "labelledBy" | "id" }) {
  const [v, setV] = useState("a");
  // The Picker replaced a native <select>, which got its name from the wrapping <label> for free.
  // It has three naming paths and all three are exercised, because a combobox is one of the roles
  // ARIA does NOT let take its name from content — the visible "Alpha" inside the trigger names
  // nothing, so a Picker with no explicit name reads to a screen reader as an unnamed combobox.
  if (named === "labelledBy") {
    return (
      <div>
        <span id="pk-lbl">Theme</span>
        <Picker labelledBy="pk-lbl" value={v} options={OPTIONS} onChange={setV} />
      </div>
    );
  }
  if (named === "id") {
    return (
      <div>
        <label htmlFor="pk-id">Theme</label>
        <Picker id="pk-id" value={v} options={OPTIONS} onChange={setV} />
      </div>
    );
  }
  return <Picker aria-label="Theme" value={v} options={OPTIONS} onChange={setV} />;
}

function SegmentedHarness() {
  const [v, setV] = useState("one");
  return (
    <SegmentedControl
      segments={[
        { id: "one", label: "One" },
        { id: "two", label: "Two" },
      ]}
      value={v}
      onChange={setV}
      aria-label="View"
    />
  );
}

// Each entry is a real mount, not a smoke render: props are the shape the app actually passes.
const ROSTER: Array<[name: string, node: ReactNode]> = [
  ["Card", <Card>Body copy</Card>],
  ["Card (interactive)", <Card interactive>Body copy</Card>],
  ["Panel", <Panel>Body copy</Panel>],
  ["SectionHeader", <SectionHeader title="Applied changes" right={<StatusPill status="ready" />} />],
  [
    "EmptyState",
    <EmptyState icon="check" title="Nothing to fix" action={<button type="button">Run a check</button>}>
      Compy found nothing worth changing.
    </EmptyState>,
  ],
  ["Gauge", <Gauge value={62} label="GPU load" unit="%" />],
  ["Icon", <Icon name="check" />],
  ["NavGlyph", <NavGlyph name="home" />],
  ["Stat", <Stat value="118" unit="fps" label="Average" />],
  ["Stat (attention)", <Stat value="41" unit="fps" label="1% low" tone="attention" />],
  ["StatusPill", <StatusPill status="ready" label="Ready" />],
  ["Sparkline", <Sparkline values={[3, 9, 4, 12, 7, 15, 11]} />],
  ["Wordmark", <Wordmark />],
  ["AnimatedNumber", <AnimatedNumber value={42} />],
  ["BackButton", <BackButton onBack={() => {}} canGoBack />],
  ["BackButton (disabled)", <BackButton onBack={() => {}} canGoBack={false} />],
  ["ForwardButton", <ForwardButton onForward={() => {}} canGoForward />],
  ["SegmentedControl", <SegmentedHarness />],
  ["Picker (aria-label)", <PickerHarness named="aria-label" />],
  ["Picker (labelledBy)", <PickerHarness named="labelledBy" />],
  ["Picker (id + <label htmlFor>)", <PickerHarness named="id" />],
  ["TrustSwitch", <TrustSwitch applied={false} busy={false} onToggle={() => {}} ariaLabel="Turn on Game Mode" />],
  [
    "TrustSwitch (applied, busy)",
    <TrustSwitch applied busy onToggle={() => {}} ariaLabel="Turn off Game Mode" label="On" />,
  ],
  ["TrustSnapshotLine", <TrustSnapshotLine restoresLabel="Off" appliedLabel="On" />],
  [
    "SlimRecRow",
    // Renders an <li>. Its only caller (src/surfaces/Fix.tsx) always mounts it inside
    // <ul className="fix-list">, so the roster mounts it the same way — a bare <li> would fail the
    // `listitem` rule on the harness's shape, not the component's.
    <ul className="fix-list"><SlimRecRow
      title="Turn on Game Mode"
      proof="Measured +4 fps average on this machine."
      badge="recommended"
      status="attention"
      control={<TrustSwitch applied={false} busy={false} onToggle={() => {}} ariaLabel="Turn on Game Mode" />}
    >
      <SlimDetailRow k="Restores to" v="Off" />
    </SlimRecRow></ul>,
  ],
  [
    "SlimRecRow (open)",
    <ul className="fix-list"><SlimRecRow
      title="Turn on Game Mode"
      proof="Measured +4 fps average on this machine."
      meta="HKCU\Software\Microsoft\GameBar"
      badge="optional"
      status="ready"
      defaultOpen
      control={<TrustSwitch applied busy={false} onToggle={() => {}} ariaLabel="Turn off Game Mode" />}
    >
      <SlimDetailRow k="Restores to" v="Off" />
    </SlimRecRow></ul>,
  ],
  ["TrustCue", <TrustCue title="Reversible" detail="Compy saved what this was before changing it." />],
  ["WhatsThis", <WhatsThis id="vrr" onOpen={() => {}} />],
  ["KonamiWhisper", <KonamiWhisper />],
  [
    "LedgerHealthNotice",
    <LedgerHealthNotice health={{ complete: false, total: 12, readable: 9, note: "3 entries unreadable" } as never} />,
  ],
];

describe("axe · design-system components have no structural accessibility violations", () => {
  it.each(ROSTER)("%s", async (_name, node) => {
    const { container } = render(<>{node}</>);
    await expectNoAxeViolations(container);
  });
});

// ── components that need a provider, real data, or an interaction to reach their live shape ──────
// Same guard, mounted the way the app mounts them. A component checked only in its closed/empty
// state is checked in the state a user spends the least time in — the DIALOG a user must read and
// the TOOLTIP that explains a term are exactly where an ARIA mistake costs the most.

const WALKTHROUGH = walkthroughForKey("game-mode");

describe("axe · provider-backed and interactive components", () => {
  it("KeepaliveRoom", async () => {
    const { container } = render(
      <KeepaliveRoom active>
        <p>Room content</p>
      </KeepaliveRoom>,
    );
    await expectNoAxeViolations(container);
  });

  it("ErrorBoundary (caught-error recovery screen)", async () => {
    const Boom = (): never => {
      throw new Error("boom");
    };
    // React logs the caught error; silence it so a PASSING test doesn't print a stack.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { container } = render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
      await expectNoAxeViolations(container);
    } finally {
      spy.mockRestore();
    }
  });

  it("RoomAccentPicker (closed and open)", async () => {
    const { container } = render(<RoomAccentPicker room="fix" roomLabel="Fix" />);
    await expectNoAxeViolations(container);
    fireEvent.click(within(container).getByRole("button"));
    await expectNoAxeViolations(container);
  });

  it("Walkthrough", async () => {
    expect(WALKTHROUGH).not.toBeNull();
    const { container } = render(<Walkthrough walkthrough={WALKTHROUGH!} vendor="nvidia" />);
    await expectNoAxeViolations(container);
  });

  it("WalkthroughDisclosure (closed and open)", async () => {
    const { container } = render(
      <WalkthroughDisclosure label="Show me how" walkthrough={WALKTHROUGH!} vendor="nvidia" />,
    );
    await expectNoAxeViolations(container);
    fireEvent.click(within(container).getByText("Show me how"));
    await expectNoAxeViolations(container);
  });

  it("Term (trigger and revealed tooltip)", async () => {
    const { container } = render(
      <LibraryContext.Provider value={{ openLibrary: () => {} }}>
        <p>
          Turn on <Term id="vrr">VRR</Term> today
        </p>
      </LibraryContext.Provider>,
    );
    await expectNoAxeViolations(container);
    fireEvent.click(within(container).getByRole("button", { name: "VRR" }));
    expect(within(container).getByRole("tooltip")).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it("GlossText", async () => {
    const { container } = render(
      <LibraryContext.Provider value={{ openLibrary: () => {} }}>
        <GlossText text="Turn on VRR for a smoother picture" rules={[{ id: "vrr", match: ["VRR"] }]} />
      </LibraryContext.Provider>,
    );
    await expectNoAxeViolations(container);
  });

  it("ConfirmDialog (open, the state a user must actually read)", async () => {
    function Harness() {
      const confirm = useConfirm();
      return (
        <button type="button" onClick={() => void confirm({ title: "Roll back Game Mode?", body: "It'll return to Off", confirmLabel: "Roll back" })}>
          trigger
        </button>
      );
    }
    render(
      <ConfirmProvider>
        <Harness />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText("trigger"));
    await screen.findByText("Roll back Game Mode?");
    // The dialog portals outside the trigger's container — check the whole document body.
    await expectNoAxeViolations(document.body);
  });
});

describe("axe · the harness itself fails on a real violation", () => {
  // Without this, a harness that silently stopped running would read exactly like a clean roster.
  // Same reasoning as tokens-qpw-guard's "the suite must actually run" pin.
  it("catches a control with no accessible name", async () => {
    const { container } = render(
      <div>
        <button type="button" />
        <input type="text" />
      </div>,
    );
    await expect(expectNoAxeViolations(container)).rejects.toThrow(/button-name/);
  });
});

// ── the console / bento layer ────────────────────────────────────────────────────────────────────
// Not "extra" components: the bento tiles ARE the rooms' bodies, and Sheet is the app's one panel
// for anything a tile opens. Sheet is the highest-stakes mount in this file — a dialog is the one
// place where wrong ARIA doesn't just muddle the announcement, it traps a keyboard user.

describe("axe · console and bento", () => {
  it("BentoGrid + BentoTile (plain, badged, and openable)", async () => {
    const { container } = render(
      <BentoGrid>
        <BentoTile title="Health" span="half">
          <p>Nothing needs attention.</p>
        </BentoTile>
        <BentoTile title="Applied changes" span="half" tone="ok" badge={<StatusPill status="ready" label="3" />}>
          <p>Three changes, all reversible.</p>
        </BentoTile>
        <BentoTile title="Recent sessions" span="full" open={{ label: "See all 14", onOpen: () => {} }}>
          <p>Fourteen recorded.</p>
        </BentoTile>
      </BentoGrid>,
    );
    await expectNoAxeViolations(container);
  });

  it("Sheet (open, dismissible and mid-apply)", async () => {
    const open = render(
      <Sheet title="Recent sessions" sub="What Compy recorded while you played" onClose={() => {}} footer={<button type="button">Close</button>}>
        <p>Fourteen sessions.</p>
      </Sheet>,
    );
    await expectNoAxeViolations(document.body);
    open.unmount();

    // Mid-apply: the close button renders DISABLED rather than absent. A disabled control still has
    // to carry a name — "an unnamed disabled button" is the same dead end as an unnamed live one.
    render(
      <Sheet title="Applying 3 changes" onClose={() => {}} dismissible={false}>
        <p>Working…</p>
      </Sheet>,
    );
    await expectNoAxeViolations(document.body);
  });

  it("ArcGauge (measured, and the honest null reading)", async () => {
    const measured = render(<ArcGauge label="Average fps" value={118} max={240} unit="fps" />);
    await expectNoAxeViolations(measured.container);
    measured.unmount();
    const unknown = render(<ArcGauge label="1% low" value={null} max={240} unit="fps" measured={false} />);
    await expectNoAxeViolations(unknown.container);
  });

  it("Reading (measured, and the honest unmeasured cell with its reason)", async () => {
    const measured = render(<Reading id="avgFps" label="Average fps" value={118} unit="fps" />);
    await expectNoAxeViolations(measured.container);
    measured.unmount();
    // The absent reading is the state worth checking: it is text, not an empty node, and its reason
    // must be reachable rather than conveyed by the em-dashes alone.
    const unknown = render(
      <Reading id="cpuTemp" label="CPU temperature" value={null} note="no CPU temp - see below" />,
    );
    await expectNoAxeViolations(unknown.container);
  });

  it("Dock", async () => {
    const { container } = render(
      <Dock
        nodes={[
          { key: "fps", name: "Frames", icon: "gauge", primary: true, measured: true },
          { key: "temps", name: "Temperatures", icon: "thermometer", measured: false },
        ]}
        activeKey="fps"
        onOpen={() => {}}
      />,
    );
    await expectNoAxeViolations(container);
  });

  it("HudFrame (with a rig line, and without one)", async () => {
    const withRig = render(<HudFrame rig="Ryzen 7 · RX 9070 XT" />);
    await expectNoAxeViolations(withRig.container);
    withRig.unmount();
    const without = render(<HudFrame rig={null} />);
    await expectNoAxeViolations(without.container);
  });

  it("Oscilloscope", async () => {
    const { container } = render(
      <Oscilloscope samples={[8.1, 8.4, 9.9, 8.2, 16.7, 8.3]} label="Frametime" unit="ms" spikes reduced={false} />,
    );
    await expectNoAxeViolations(container);
  });
});

// ── vendored primitives ──────────────────────────────────────────────────────────────────────────
// Third-party in origin, ours in consequence: every one of these is mounted on a live surface, so
// a screen reader meets THIS markup, not the upstream project's README. Vendored code being someone
// else's is not a reason to check it less — it is the reason to check it here, where we can see it.

describe("axe · vendored primitives, at their live mount", () => {
  it("CountUp", async () => {
    const { container } = render(<CountUp to={118} />);
    await expectNoAxeViolations(container);
  });

  it("DecryptedText", async () => {
    const { container } = render(<DecryptedText text="Nothing needs attention" />);
    await expectNoAxeViolations(container);
  });

  it("ElectricBorder (a wrapper — its content must survive the wrapping)", async () => {
    const { container } = render(
      <ElectricBorder>
        <button type="button">Run a check</button>
      </ElectricBorder>,
    );
    await expectNoAxeViolations(container);
  });

  it("SpotlightCard (same: a wrapper that must not swallow its content's semantics)", async () => {
    const { container } = render(
      <SpotlightCard>
        <h3>Recent sessions</h3>
        <button type="button">See all 14</button>
      </SpotlightCard>,
    );
    await expectNoAxeViolations(container);
  });
});
