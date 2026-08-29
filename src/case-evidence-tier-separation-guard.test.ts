import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join, basename } from "path";

// CASE-EVIDENCE TIER SEPARATION GUARD (Q9b Stage 1, #252) — the contract's §12 rows that go live
// with the Stage 1 module: docs/superpowers/specs/2026-08-29-q9b-tier3-case-evidence-contract.md.
//
// WHY THIS EXISTS: Tier 3 (`case_evidence_upload.rs`) is the module that will one day carry user
// evidence off the machine — the ONLY tier ever authorized to. Its §4 discipline is that it shares
// NOTHING with the other trust domains: not Tier 2's module (receipts), not Tier 1's (the advisory
// catalog), not the privileged remote-rules domain, and above all not the local evidence store.
// The one sanctioned sharing is `hw_class.rs`, a tier-NEUTRAL module of pure classification
// helpers — and neutrality is only real while that module reaches no tier either. None of that
// survives as prose; each line here makes an import a build failure instead of a review hope.
//
// Stage discipline is pinned too: at Stage 1 the module is PURE — no Tauri command, no transport,
// no background construct, and a gate that is hard-false with no caller. Stage 4 (the dark,
// refusing send command) must amend these rows by name, in a diff that says so.

const TIER3 = join("src-tauri", "src", "case_evidence_upload.rs");
const HW_CLASS = join("src-tauri", "src", "hw_class.rs");
const RUST_ROOT = join("src-tauri", "src");

// ── Source normalisation + reachability (local copies) ─────────────────────────────────────────
// Deliberately copied from support-evidence-outbound-guard.test.ts rather than imported — importing
// a test module re-registers its suite and runs every one of its tests a second time under this
// file. Comments legitimately NAME the modules this one must never touch (that is the ban's
// documentation, not its violation), so only executable source is in scope.

function stripRustComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

const PATH_LEAD = /(?:\bmod\s+|\buse\s+|crate::|super::)/;
const NOT_WORD_CHAR = /(?![A-Za-z0-9_])/;

function referencesModule(source: string, moduleStem: string): boolean {
  const re = new RegExp(PATH_LEAD.source + moduleStem + NOT_WORD_CHAR.source);
  return re.test(stripRustComments(source));
}

// Rust-side transports, same vocabulary as the outbound guard's — a Stage 1 module that can reach
// the network is Stage 4 arriving without its review.
const RUST_DETECTORS = [
  { id: "http client crate", re: /\b(reqwest|ureq|isahc|attohttpc|surf|hyper|tungstenite)\b/ },
  { id: "raw socket", re: /\b(std::net|TcpStream|TcpListener|UdpSocket|SocketAddr)\b/ },
  { id: "tauri http surface", re: /\b(tauri_plugin_http|tauri::api::http)\b/ },
  { id: "hard-coded URL", re: /\bhttps?:\/\// },
  { id: "shelled-out transfer", re: /\b(Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|bitsadmin|curl(\.exe)?|wget)\b/i },
  { id: "upload verb", re: /\b(upload|exfiltrat|post_json|send_report)\w*/i },
];

function detectRust(source: string): string[] {
  const body = stripRustComments(source);
  return RUST_DETECTORS.filter((d) => d.re.test(body)).map((d) => d.id);
}

function collectRustFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const rel = join(dir, name);
      const st = statSync(rel);
      if (st.isDirectory()) walk(rel);
      else if (name.endsWith(".rs")) out.push(rel);
    }
  };
  walk(RUST_ROOT);
  return out.sort();
}

// ── The guard ──────────────────────────────────────────────────────────────────────────────────

describe("case-evidence tier separation: Tier 3 shares nothing with the other trust domains", () => {
  const tier3 = readFileSync(TIER3, "utf8");
  const hwClass = readFileSync(HW_CLASS, "utf8");

  it("has real modules to guard (the reads are not silently trivial)", () => {
    // A guard whose corpus vanished passes loudest of all — a rename must fail HERE, not report a
    // clean bill of health for files that no longer exist.
    expect(existsSync(TIER3) && existsSync(HW_CLASS)).toBe(true);
    expect(tier3).toContain("struct CasePayload");
    expect(tier3).toContain("deny_unknown_fields");
    expect(tier3).toContain("fn case_evidence_gate");
    expect(hwClass).toContain("fn sanitize_token");
    expect(hwClass).toContain("fn ram_gb_bucket");
    expect(hwClass).toContain("fn gpu_vendor_token");
  });

  it("keeps both modules' own claims of enforcement honest", () => {
    // Each module doc tells the reader THIS file is what makes its separation structural. If the
    // doc stops naming this guard — or this guard is renamed out from under it — the promise
    // silently reverts to prose.
    expect(tier3).toContain("src/case-evidence-tier-separation-guard.test.ts");
    expect(hwClass).toContain("src/case-evidence-tier-separation-guard.test.ts");
  });

  it("Tier 3 imports no tier module and never the evidence store (§4)", () => {
    for (const stem of ["receipts", "support_evidence", "case_intelligence", "remote_rules"]) {
      expect(
        referencesModule(tier3, stem),
        `case_evidence_upload.rs reaches ${stem}. Contract §4 is absolute: the shared hardware ` +
          `vocabularies come through the tier-neutral hw_class module, and everything else — ` +
          `consent, gating, transport, the evidence bundle — stays inside its own trust domain.`,
      ).toBe(false);
    }
  });

  it("hw_class stays tier-neutral — it reaches no tier module in either direction", () => {
    // The §4 sharing is only sound while the shared module is genuinely neutral: pure
    // classification helpers that know nothing about consent, gates, payloads, or stores.
    for (const stem of ["receipts", "support_evidence", "case_intelligence", "case_evidence_upload", "remote_rules"]) {
      expect(
        referencesModule(hwClass, stem),
        `hw_class.rs reaches ${stem} — a "neutral" module that imports a tier module is a corridor ` +
          `between trust domains wearing a neutral name.`,
      ).toBe(false);
    }
    expect(detectRust(hwClass), "hw_class carries pure string/number classification only").toEqual([]);
  });

  it("Stage 1 is pure: no transport, no Tauri command, no background construct", () => {
    const body = stripRustComments(tier3);
    expect(
      detectRust(tier3),
      "Tier 3's Stage 1 module gained a transport shape. The send path is Stage 4's, behind its " +
        "own review — it does not arrive as a quiet line inside the payload module.",
    ).toEqual([]);
    expect(body, "no command surface at Stage 1 — registration is Stage 4's diff").not.toContain("tauri::command");
    expect(
      body,
      "no background/queue construct — §7: sending is synchronous and user-attended, and nothing " +
        "here may run when the user is not looking",
    ).not.toMatch(/\b(std::thread|thread::spawn|tokio::|async\s+fn|\.await|set_interval|spawn)\b/);
  });

  it("the gate is hard-false and NOTHING calls through it", () => {
    // §11 Stage 1: "case_evidence_gate() may exist only as a hard-false constant nothing calls
    // through." Both halves are structural: the body is literally `false`, and no other file in
    // the crate names the symbol at all.
    expect(stripRustComments(tier3)).toMatch(/fn case_evidence_gate\(\)\s*->\s*bool\s*\{\s*false\s*\}/);
    const callers = collectRustFiles().filter(
      (f) => basename(f) !== "case_evidence_upload.rs" && stripRustComments(readFileSync(f, "utf8")).includes("case_evidence_gate"),
    );
    expect(callers, "a file outside the module names case_evidence_gate — Stage 4 territory, its own review").toEqual([]);
  });

  it("the module is wired into the crate as a declaration and nothing more", () => {
    // lib.rs must declare `mod case_evidence_upload;` (dark code that does not compile rots), and
    // no file anywhere may USE a path into it — reachable-by-name is how dark code goes live early.
    const reachers = collectRustFiles().filter((f) => {
      if (basename(f) === "case_evidence_upload.rs") return false;
      const body = stripRustComments(readFileSync(f, "utf8"));
      if (!/\bcase_evidence_upload\b/.test(body)) return false;
      return basename(f) !== "lib.rs" || /case_evidence_upload::/.test(body);
    });
    expect(reachers, "a file reaches INTO case_evidence_upload — at Stage 1 only lib.rs's bare `mod` line may name it").toEqual([]);
    expect(stripRustComments(readFileSync(join(RUST_ROOT, "lib.rs"), "utf8"))).toMatch(/\bmod\s+case_evidence_upload\s*;/);
  });

  it("catches the shapes it was written for (positive controls)", () => {
    expect(referencesModule("use crate::receipts::build_receipt_payload;", "receipts")).toBe(true);
    expect(referencesModule("mod support_evidence;", "support_evidence")).toBe(true);
    expect(referencesModule("let x = super::case_evidence_upload::CASE_SCHEMA_VERSION;", "case_evidence_upload")).toBe(true);
    // Describing the ban is not the ban being broken.
    expect(referencesModule("// never use crate::receipts here", "receipts")).toBe(false);
    // A different module with a similar prefix is not a match.
    expect(referencesModule("use crate::receipts_archive::X;", "receipts")).toBe(false);
    expect(detectRust(`let c = reqwest::Client::new();`)).toContain("http client crate");
    expect(detectRust(`fn upload_case(p: &CasePayload) {}`)).toContain("upload verb");
  });
});
