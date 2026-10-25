import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts.)

// P4-comparable-show guard: Compy's own telemetry overlay must never be able to take focus. A
// session counts a tick as background (and leaves it out of every number) when the game's window
// isn't the one in front, so an overlay that activated itself would mark real play as alt-tabbed.
//
// The pins, each load-bearing on Windows (tao 0.35):
//  - `focus: false`  → every show uses SW_SHOWNOACTIVATE (MARKER_DONT_FOCUS), so showing it never
//    activates it;
//  - `focusable: false` → WS_EX_NOACTIVATE, so nothing (a click that slips past click-through, the
//    system re-activating a window) makes it the foreground window. Tauri's default is true;
//  - `show_overlay` turns on click-through and never calls set_focus;
//  - the window-state plugin, whose restore calls show()+set_focus(), skips the overlay.

const conf = JSON.parse(readFileSync(join("src-tauri", "tauri.conf.json"), "utf8"));
const monitoring = readFileSync(join("src-tauri", "src", "monitoring.rs"), "utf8");
const lib = readFileSync(join("src-tauri", "src", "lib.rs"), "utf8");

const overlay = (conf.app.windows as Array<Record<string, unknown>>).find((w) => w.label === "overlay");

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`fn ${name}(`);
  expect(start, `fn ${name} not found`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced fn ${name}`);
}

describe("overlay can't take focus", () => {
  it("the overlay window is declared, hidden, never focused on show and not focusable", () => {
    expect(overlay).toBeDefined();
    expect(overlay!.focus).toBe(false);
    expect(overlay!.focusable).toBe(false);
    expect(overlay!.visible).toBe(false);
  });

  it("show_overlay makes it click-through and never focuses it", () => {
    const body = fnBody(monitoring, "show_overlay");
    expect(body).toMatch(/set_ignore_cursor_events\(true\)/);
    expect(body).not.toMatch(/set_focus|set_focusable\(true\)/);
  });

  it("no Rust code focuses or re-enables focus on the overlay window", () => {
    for (const src of [monitoring, lib]) {
      for (const m of src.matchAll(/get_webview_window\("overlay"\)[\s\S]{0,400}/g)) {
        expect(m[0].split("\n").slice(0, 8).join("\n")).not.toMatch(/set_focus\b|set_focusable\(true\)/);
      }
    }
  });

  it("the window-state plugin (restore = show + set_focus) skips the overlay", () => {
    expect(lib).toMatch(/with_denylist\(&\[[^\]]*"overlay"/);
  });
});
