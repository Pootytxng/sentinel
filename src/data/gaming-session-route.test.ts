import { describe, it, expect } from "vitest";
import { routeSession } from "./gaming-session-route";

describe("routeSession — only the live in-run session resumes", () => {
  it("active + live this run (a tab-switch remount) → resume", () => {
    expect(routeSession("active", true)).toBe("resume");
  });

  it("active from a prior run that died — reboot/crash → recover", () => {
    // The trap we're closing: never show this as 'Gaming Mode on'.
    expect(routeSession("active", false)).toBe("recover");
  });

  it("interrupted-restore statuses → recover, regardless of the live flag", () => {
    for (const s of ["ending", "restore-pending", "restore-failed"]) {
      expect(routeSession(s, false)).toBe("recover");
      expect(routeSession(s, true)).toBe("recover");
    }
  });
});
