// #631: `rollback_change` returns a distinct error when the undo ran on Windows but the history
// save failed. Every surface tells that case apart by the error's fixed lead sentence, so the TS
// copy of the lead must stay byte-equal to the Rust one, and the surfaces must route through the
// one helper.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ROLLBACK_UNRECORDED_LEAD, isUnrecordedUndo } from "./rollback-error";

describe("rollback-error — the unrecorded-undo lead", () => {
  it("equals ROLLBACK_UNRECORDED_LEAD in history.rs", () => {
    const rs = readFileSync(join("src-tauri", "src", "history.rs"), "utf8");
    const m = rs.match(/const ROLLBACK_UNRECORDED_LEAD: &str =\s*"([^"]*)";/);
    expect(m, "ROLLBACK_UNRECORDED_LEAD not found in history.rs").not.toBeNull();
    expect(ROLLBACK_UNRECORDED_LEAD).toBe(m![1]);
  });

  it("recognises the unrecorded case and nothing else", () => {
    expect(isUnrecordedUndo(`${ROLLBACK_UNRECORDED_LEAD} (disk full), so ...`)).toBe(true);
    expect(isUnrecordedUndo(new Error(`${ROLLBACK_UNRECORDED_LEAD} (x)`))).toBe(false); // "Error: ..." prefix
    expect(isUnrecordedUndo("access denied")).toBe(false);
    expect(isUnrecordedUndo(`rollback failed: ${ROLLBACK_UNRECORDED_LEAD}`)).toBe(false);
    expect(isUnrecordedUndo(undefined)).toBe(false);
  });

  it("App's rollback banner routes an unrecorded undo to its own copy", () => {
    // App is too large to render in a unit test; this pins the one catch that shows the banner.
    const app = readFileSync(join("src", "App.tsx"), "utf8");
    expect(app).toContain(
      'fail(isUnrecordedUndo(e) ? t("common.undoUnrecorded") : t("app.errors.rollbackFailed"), e);',
    );
  });
});
