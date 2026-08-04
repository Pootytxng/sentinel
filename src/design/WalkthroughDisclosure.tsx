import { useState } from "react";
import { Walkthrough } from "./Walkthrough";
import type { Walkthrough as WT, GpuVendor } from "../surfaces/walkthroughs";

// The "Show me the way" disclosure — one shared component, because the collapsed-`<details>` trap
// bit us in three places at once (Check + Fix ×2).
//
// THE TRAP: React renders `<details>` children into the DOM no matter what `open` says. The browser
// hides them, so it LOOKS collapsed — but the component mounted and its effects are running. An
// unconditional `<Walkthrough>` inside a closed disclosure therefore started its 2.2s auto-advance
// carousel for EVERY walkthrough-bearing row, immediately, whether or not anyone ever expanded one.
// Combined with the Optimize keepalive (App.tsx renders Optimize behind `display: none` forever
// after the first visit), one trip to Optimize left N carousels ticking in every other room and
// behind a fullscreen game. It also made `bumpLocalStat("walkthroughsOpened")` count disclosures
// nobody opened — a number the Export modal shows the user.
//
// So the fix is one line of intent: mount the walkthrough when it is genuinely open.
//
// CONTROLLED, not `onToggle`: React state is the single source of truth for `open`. The alternative
// — an uncontrolled `<details>` listening for the `toggle` event — depends on a UA behaviour jsdom
// isn't obliged to reproduce, and a controlled `open` prop paired with an event that never fires is
// a disclosure that silently stops opening. `preventDefault` + setState behaves identically in the
// browser and in tests. Keyboard access is unchanged: Enter/Space on a `<summary>` dispatch a click.
export function WalkthroughDisclosure({
  label,
  walkthrough,
  vendor,
}: {
  label: string;
  walkthrough: WT;
  vendor: GpuVendor;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="fix-walkthrough" open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        {label}
      </summary>
      {open && <Walkthrough walkthrough={walkthrough} vendor={vendor} />}
    </details>
  );
}
