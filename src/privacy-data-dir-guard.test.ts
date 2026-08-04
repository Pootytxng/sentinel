import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// bug -> guard (Cowork audit 2026-08-03, product-quality-stabilization Q1 acceptance-list pass):
// docs/PRIVACY.md and site/privacy.html both claimed FPS runtime files live under
// %LOCALAPPDATA%\Compy\ -- the real fps_dir() in src-tauri/src/monitoring.rs resolves to
// compy_data_dir().join("runtime"), i.e. %APPDATA%\Compy\runtime\. The same two files also
// blanketed "You can delete any of these files; Compy will recreate what it needs" over
// history.json, silently framing Trust Ledger deletion as harmless. The stabilization spec
// (docs/superpowers/specs/2026-07-29-product-quality-stabilization-program.md, Q1 acceptance)
// requires both: data paths that match compy_data_dir()/fps_dir(), and explicit ledger-deletion
// consequences. Pin both so they can't drift back silently.

const FILES = ["docs/PRIVACY.md", "site/privacy.html"];

describe("privacy copy: FPS path matches the real fps_dir()", () => {
  it("fps_dir() resolves under compy_data_dir()/runtime, not %LOCALAPPDATA%", () => {
    const src = readFileSync(join("src-tauri", "src", "monitoring.rs"), "utf8");
    const m = src.match(/pub\(crate\) fn fps_dir\(\)[^{]*\{([\s\S]*?)\n\}/);
    expect(m, "could not find fps_dir() in monitoring.rs").toBeTruthy();
    expect(m![1]).toMatch(/compy_data_dir\(\)\.join\(\s*"runtime"\s*\)/);
  });

  for (const f of FILES) {
    it(`${f} states the real FPS path and never claims %LOCALAPPDATA%\\Compy\\`, () => {
      const text = readFileSync(f, "utf8");
      expect(text).toContain("APPDATA%\\Compy\\runtime\\");
      expect(text).not.toMatch(/LOCALAPPDATA%\\Compy\\/);
    });
  }
});

// Same defect class, second surface (2026-08-04, Q5): both privacy documents now publish the
// support record's on-disk path AND its retention caps as concrete numbers -- "capped at 400
// entries (about 250 KB)". Those numbers are ordinary Rust constants; nothing stopped someone
// tightening MAX_EVENTS and leaving two published policies quietly overstating what Compy keeps.
// The in-app copy cannot drift (it renders bundle.retention at preview time, pinned by
// src/surfaces/SupportEvidence.test.tsx) -- the DOCUMENTS were the only unpinned copy left.
//
// Deliberately pinned as bare "<n> entries" / "<n> KB" rather than the full sentence: rewording the
// disclosure stays free, changing the numbers without changing the source does not.
describe("privacy copy: support-record path and caps match support_evidence.rs", () => {
  const rs = readFileSync(join("src-tauri", "src", "support_evidence.rs"), "utf8");
  const constant = (name: string) => {
    const m = rs.match(new RegExp(`pub const ${name}: usize = (\\d+);`));
    expect(m, `could not read ${name} from support_evidence.rs`).toBeTruthy();
    return Number(m![1]);
  };
  const events = constant("MAX_EVENTS");
  const kb = Math.round((events * constant("MAX_RECORD_BYTES")) / 1024);

  it("the record really lives under compy_data_dir()/support/evidence.jsonl", () => {
    expect(rs).toMatch(/fn support_dir\(\)[^{]*\{\s*compy_data_dir\(\)\.join\(\s*"support"\s*\)/);
    expect(rs).toMatch(/fn evidence_path\(\)[^{]*\{\s*support_dir\(\)\.join\(\s*"evidence\.jsonl"\s*\)/);
  });

  for (const f of FILES) {
    it(`${f} states the real support-record path`, () => {
      expect(readFileSync(f, "utf8")).toContain("APPDATA%\\Compy\\support\\evidence.jsonl");
    });

    it(`${f} publishes the caps support_evidence.rs actually enforces`, () => {
      const text = readFileSync(f, "utf8");
      expect(text, `should say "${events} entries" (MAX_EVENTS)`).toMatch(
        new RegExp(`\\b${events} entries\\b`),
      );
      expect(text, `should say "${kb} KB" (MAX_EVENTS x MAX_RECORD_BYTES)`).toMatch(
        new RegExp(`\\b${kb} KB\\b`),
      );
    });
  }
});

describe("privacy copy: history.json deletion consequence is explicit", () => {
  for (const f of FILES) {
    it(`${f} never frames deleting history.json as harmless recreation`, () => {
      const text = readFileSync(f, "utf8");
      expect(text).not.toMatch(/delete any of these files;?\s*Compy will recreate what it needs/i);
    });

    it(`${f} states that deleting history.json loses rollback/audit history`, () => {
      const text = readFileSync(f, "utf8");
      // Match "Deleting `history.json`" (markdown) or "Deleting <code>history.json</code>" (HTML)
      // without pinning exact markup — just that "Deleting" and "history.json" sit close together.
      const m = text.match(/Deleting[^.]{0,20}history\.json[\s\S]{0,300}/i);
      expect(m, `${f} should say "Deleting ...history.json ..." with the consequence nearby`).toBeTruthy();
      expect(m![0]).toMatch(/eras|lose|los(e|s|t)|no longer|stop(s)? being reversible/i);
    });
  }
});
