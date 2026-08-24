// bug→guard (issue #211, 2026-08-24) — found by the `self-reviewer` subagent during #49's round 18
// and deliberately not failed there, because it was not that diff. Fixed here with its guard.
//
// All four rooms passed their `<RoomEyebrow>` as the first child of RoomShell's `verdict` prop, and
// `verdict` renders inside the `<h1>`. So the page's single top-level heading was the room's stable
// NAME welded to a live readout — on Live, "Session monitor" + "Last session ran smooth —
// MortalShell2 at 191 fps average". A heading that changes with data cannot be relied on for
// orientation, and a screen-reader user is handed the room name and its current measurement as one
// string. The eyebrow now has its own slot, rendering in the same place on screen, outside the
// heading.
//
// Two halves, because either alone would rot:
//   - the CONTRACT half renders RoomShell and proves the h1 holds the verdict and nothing else;
//   - the CALLER half reads the four room sources, because the contract cannot stop a room from
//     putting an eyebrow back inside `verdict` tomorrow.
import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach } from "vitest";

import { RoomShell } from "./room-shell";
import { RoomEyebrow } from "./room-eyebrow";

afterEach(cleanup);

const ROOMS = ["HomeConsole.tsx", "MonitorV2.tsx", "BlackbookV2.tsx", "LabConsole.tsx"];

/** The source of one JSX prop value, from `<name>={` to its matching brace. */
function propSource(source: string, name: string): string {
  const open = source.indexOf(`${name}={`);
  if (open === -1) return "";
  let depth = 0;
  const from = open + name.length + 1;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(from, i + 1);
    }
  }
  return source.slice(from);
}

describe("a room heading is a NAME, never a name welded to a readout (#211)", () => {
  it("keeps the eyebrow out of the h1 while still rendering it in the header", () => {
    const { container } = render(
      <RoomShell
        room="play"
        eyebrow={<RoomEyebrow tone="accent" label="Session monitor" />}
        verdict={<span>Last session ran smooth — MortalShell2 at 191 fps average.</span>}
      >
        <p>Room content</p>
      </RoomShell>,
    );
    const h1 = container.querySelector("h1");
    expect(h1, "the room lost its heading entirely").not.toBeNull();
    expect(
      h1!.querySelector(".v2-eyebrow"),
      "the eyebrow is inside the h1 again — the room's name and its live readout become one " +
        "heading string, which is exactly what #211 filed",
    ).toBeNull();
    expect(h1!.textContent).toBe("Last session ran smooth — MortalShell2 at 191 fps average.");
    // Anti-vacuous: the eyebrow must still be ON SCREEN, in the header, or this "fix" is a deletion.
    const header = container.querySelector(".v2-verdict");
    expect(header?.querySelector(".v2-eyebrow")?.textContent).toBe("Session monitor");
  });

  it("renders no eyebrow node at all when a room passes none", () => {
    const { container } = render(
      <RoomShell room="play" verdict={<span>Ready when you are</span>}>
        <p>Room content</p>
      </RoomShell>,
    );
    expect(container.querySelectorAll(".v2-eyebrow")).toHaveLength(0);
  });

  it("no room hands its eyebrow back to the verdict slot", () => {
    for (const file of ROOMS) {
      const source = readFileSync(join("src", "surfaces", file), "utf8");
      expect(
        propSource(source, "verdict"),
        `${file} passes a RoomEyebrow inside verdict={…}, which renders it inside the <h1> — pass ` +
          `it as eyebrow={…} instead`,
      ).not.toContain("RoomEyebrow");
    }
  });

  it("still finds a verdict prop in every room, so the scan above cannot pass on a miss", () => {
    for (const file of ROOMS) {
      const source = readFileSync(join("src", "surfaces", file), "utf8");
      expect(propSource(source, "verdict"), `${file} has no verdict prop to read`).not.toBe("");
    }
  });
});
