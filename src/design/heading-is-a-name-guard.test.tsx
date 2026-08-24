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
// Three halves, because any one alone would rot:
//   - the CONTRACT half renders RoomShell and proves the h1 holds the verdict and nothing else;
//   - the CALLER half reads the room sources, because the contract cannot stop a room from putting
//     an eyebrow back inside `verdict` tomorrow;
//   - the COVERAGE half discovers every RoomShell caller from disk and fails if the caller list has
//     missed one. That third half exists because the first version of this guard shipped with a
//     hand-written list of four, and the fifth room — the one still carrying the bug — was simply
//     not on it. A hand-written list of files to check is only ever as good as the memory that
//     wrote it.
import { describe, it, expect } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { afterEach } from "vitest";

import { RoomShell } from "./room-shell";
import { RoomEyebrow } from "./room-eyebrow";

afterEach(cleanup);

// MonitorConsole.tsx is in this list because leaving it out is exactly how #211 shipped half-fixed:
// the first pass corrected the four rooms below it and this list could not see the fifth — the file
// that actually renders when Live opens, since the segment defaults to "live". A caller-half guard
// that reads only the files someone already remembered to fix proves nothing. Add every room that
// mounts a RoomShell here; the list is the coverage.
// HomeHud.tsx and HomeV2.tsx were added by the coverage test below on its first run — neither had
// the bug (neither renders a RoomEyebrow at all), but neither was being read either. That is the
// list doing its job on the day it was written.
const ROOMS = [
  "HomeConsole.tsx",
  "HomeHud.tsx",
  "HomeV2.tsx",
  "MonitorConsole.tsx",
  "MonitorV2.tsx",
  "BlackbookV2.tsx",
  "LabConsole.tsx",
];

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

  // THE COVERAGE HALF. The two scans above are only worth the list they iterate, and that list was
  // wrong once already. This one asks the disk instead: every surface that mounts a <RoomShell> is
  // a room, so every one of them must be in ROOMS. A new room added tomorrow fails here on its
  // first commit, with the file name in the message, instead of shipping unscanned.
  it("ROOMS covers every surface that mounts a RoomShell", () => {
    const surfaces = join("src", "surfaces");
    const mounts = readdirSync(surfaces)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .filter((f) => readFileSync(join(surfaces, f), "utf8").includes("<RoomShell"));
    expect(mounts.length, "found no RoomShell callers at all — this scan is reading nothing").
      toBeGreaterThan(0);
    const missing = mounts.filter((f) => !ROOMS.includes(f));
    expect(
      missing,
      `these surfaces mount a RoomShell but are not in ROOMS, so neither scan above reads them: ` +
        `${missing.join(", ")}`,
    ).toEqual([]);
  });
});
