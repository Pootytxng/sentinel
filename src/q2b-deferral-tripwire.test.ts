// TRIPWIRE for the Q2b deferral (issue #64), written 2026-08-03.
//
// #62 split main from overlay at the capability layer, and #64 DELIBERATELY deferred the second
// wall: a `require_main(window)` check inside each of ~22 state-changing commands. The reasoning
// was sound and is still true today — Tauri's ACL rejects an overlay `invoke()` of a main-only
// command BEFORE the command body runs, so the in-command check would never fire in practice, and
// adding a `Window` parameter to 22 signatures across seven modules is a large behaviour-preserving
// refactor to place a wall behind one that already holds.
//
// The DANGER is not the deferral. It is that the deferral's premises are prose in a closed issue,
// so nothing fails when one of them stops being true. #64 names the exact conditions that flip it
// from defense-in-depth to REQUIRED. This file mechanizes them, per the standing law that a rule
// which lives only in memory is a rule that rots (CLAUDE.md → SELF-REVIEW + BUG→GUARD).
//
// If a test here fails, do NOT "fix" it by loosening the expectation. The correct response is to
// implement the deferred check — scope is enumerated in issue #64.
//
// Trigger 3 ("a command registered without the capability split") is already mechanized by
// src/command-authority-guard.test.ts and is not duplicated here. Trigger 4 ("Tauri changes how
// app-command permissions resolve") is a dependency-behaviour change and is not statically
// detectable from this repo; it stays a human review item at Tauri major upgrades.
// Bare "fs"/"path" and a repo-root-relative path, matching command-authority-guard.test.ts: the
// src/ tsconfig is the browser profile and carries no node: types or __dirname.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const conf = JSON.parse(
  readFileSync(join("src-tauri", "tauri.conf.json"), "utf8"),
);

const REQUIRED = "the Q2b deferral in issue #64 is no longer safe — implement require_main() on the state-changing commands listed there BEFORE shipping this change";

describe("Q2b deferral tripwire (issue #64)", () => {
  // Trigger 1: "the overlay (or a future third window) ever loads remote or user-supplied content".
  // Every window must render content bundled INSIDE the app. A remote origin would put foreign
  // script on the same `invoke` bridge the capability split is the only thing guarding.
  it("serves every window from bundled local content, never a remote origin", () => {
    const windows: Array<{ label?: string; url?: string }> = conf.app.windows ?? [];
    expect(windows.length).toBeGreaterThan(0);
    const remote = windows
      // An absent url means Tauri's default (the bundled entry point), which is local by definition.
      .filter((w) => typeof w.url === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(w.url))
      .map((w) => `${w.label ?? "main"} -> ${w.url}`);
    expect(remote, `a window loads remote content; ${REQUIRED}`).toEqual([]);
  });

  // Trigger 2: "connect-src widens beyond 'self' ipc:". The production CSP is what makes "there is
  // no path for foreign content to reach the overlay's invoke" true. `http://ipc.localhost` is the
  // Windows IPC origin Tauri v2 requires and is part of the accepted baseline, not a widening.
  it("keeps the production connect-src pinned to the local IPC baseline", () => {
    const csp = conf.app.security.csp;
    const actual = String(csp["connect-src"] ?? "").trim().split(/\s+/).sort();
    expect(actual, `connect-src widened; ${REQUIRED}`).toEqual(
      ["'self'", "http://ipc.localhost", "ipc:"].sort(),
    );
  });

  // The rest of the production CSP that keeps foreign script off the bridge. devCsp is deliberately
  // NOT checked: it is the dev-server profile and never ships.
  it("keeps script and document origins closed in the production CSP", () => {
    const csp = conf.app.security.csp;
    expect(csp["default-src"], `default-src widened; ${REQUIRED}`).toBe("'self'");
    expect(csp["script-src"], `script-src widened; ${REQUIRED}`).toBe("'self'");
    expect(csp["object-src"], `object-src widened; ${REQUIRED}`).toBe("'none'");
    expect(csp["base-uri"], `base-uri widened; ${REQUIRED}`).toBe("'self'");
    expect(csp["frame-ancestors"], `frame-ancestors widened; ${REQUIRED}`).toBe("'none'");
  });
});
