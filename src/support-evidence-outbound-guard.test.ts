import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// SUPPORT-EVIDENCE OUTBOUND GUARD (2026-08-04) — spec §12: "network inspection confirms zero new
// outbound surface."
//
// WHY THIS EXISTS: the support evidence store is the first thing Compy has ever written that is
// SHAPED like telemetry — a bounded rolling log of what the app did, redacted and ready to hand to
// support. Every ingredient of an uploader is already there; the only thing standing between it and
// an outbound call is that nobody has written one. That is a promise, and a promise cannot fail a
// build. `support_evidence.rs`'s own module doc claims this file enforces it, so without this file
// the claim is prose asserting its own enforcement — the exact shape the mutation-boundary guard
// was written to kill.
//
// The user's action is the transport. Preview, then export to a local file, then THE USER attaches
// it. No endpoint, no queue, no background uploader, no automatic attachment.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const MODULE = join("src-tauri", "src", "support_evidence.rs");
const CARGO = join("src-tauri", "Cargo.toml");
const COMMANDS = ["preview_support_evidence", "export_support_evidence", "clear_support_evidence"];

// ── Source normalisation ────────────────────────────────────────────────────────────────────────

// Comments legitimately NAME what the module refuses to do ("no background uploader", "no endpoint")
// — that is the documentation of the ban, not a violation of it, and scanning raw text would make
// describing the rule the thing that breaks the rule. Only executable source is in scope.
//
// `(?<!:)` keeps `https://…` inside a string literal from reading as a line comment, which matters
// here: a hard-coded URL is precisely what this guard is looking for. Deliberately a local copy
// rather than an import from mutation-boundary-guard.test.ts — importing a test module would
// re-register its suite and run every one of its tests a second time under this file.
function stripRustComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// ── What counts as leaving the device ───────────────────────────────────────────────────────────

type Detector = { id: string; re: RegExp };

// Rust-side transports, spelled every way this codebase could plausibly reach one: a crate, the
// std socket layer, Tauri's own HTTP plugin, a literal URL, or a shelled-out downloader. Reads are
// in scope too — an outbound surface is a surface in both directions, and a "check for a support
// ticket id" call would be just as much a new endpoint as an upload.
const RUST_DETECTORS: Detector[] = [
  { id: "http client crate", re: /\b(reqwest|ureq|isahc|attohttpc|surf|hyper|tungstenite)\b/ },
  { id: "raw socket", re: /\b(std::net|TcpStream|TcpListener|UdpSocket|SocketAddr)\b/ },
  { id: "tauri http surface", re: /\b(tauri_plugin_http|tauri::api::http)\b/ },
  { id: "hard-coded URL", re: /\bhttps?:\/\// },
  { id: "shelled-out transfer", re: /\b(Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|bitsadmin|curl(\.exe)?|wget)\b/i },
  { id: "upload verb", re: /\b(upload|exfiltrat|post_json|send_report)\w*/i },
];

// Frontend-side transports. The preview/export UI is not built yet (deferred while the owner is
// mid-game), so this side has an EMPTY corpus today — which is exactly how a guard rots into a
// standing pass. `detectWeb` is therefore pinned by its own positive control below, so the scan is
// proven non-blind now and simply starts covering files the day the UI lands.
const WEB_DETECTORS: Detector[] = [
  { id: "fetch", re: /\bfetch\s*\(/ },
  { id: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { id: "sendBeacon", re: /\bsendBeacon\s*\(/ },
  { id: "axios", re: /\baxios\b/ },
  { id: "WebSocket", re: /\bnew\s+WebSocket\b/ },
  { id: "EventSource", re: /\bnew\s+EventSource\b/ },
];

export function detectRust(source: string): string[] {
  const body = stripRustComments(source);
  return RUST_DETECTORS.filter((d) => d.re.test(body)).map((d) => d.id);
}

export function detectWeb(source: string): string[] {
  const body = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(?<!:)\/\/[^\n]*/g, " ");
  return WEB_DETECTORS.filter((d) => d.re.test(body)).map((d) => d.id);
}

// Production code only. The unit tests legitimately contain hostile-looking INPUT — a UNC path
// fixture proving the redactor masks `\\fileserver\share\…` is the redactor working, not a write
// target — so the destination check below reads only the half of the file that ships. The network
// scan above deliberately does NOT use this: a test opening a real socket is a real finding.
// Truncation is only honest while the test module is a single block at the tail, which is asserted.
function productionSource(source: string): string {
  return source.slice(0, source.indexOf("#[cfg(test)]"));
}

// ── Corpus helpers ──────────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", "dist", "dist-web", "dist-site", ".astro", ".vite"]);
const WEB_EXT = /\.(ts|tsx|js|jsx|mjs|astro|svelte|vue)$/;

function collectWeb(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const rel = join(dir, name);
      let st;
      try {
        st = statSync(rel);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(rel);
        continue;
      }
      if (WEB_EXT.test(name) && !/\.(test|spec)\.[tj]sx?$/.test(name)) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

function mentionsEvidence(source: string): boolean {
  return COMMANDS.some((c) => source.includes(c));
}

// ── The guard ───────────────────────────────────────────────────────────────────────────────────

describe("support-evidence outbound guard: the evidence bundle never leaves by itself", () => {
  const module = readFileSync(MODULE, "utf8");

  it("has a real module to guard (the read is not silently trivial)", () => {
    // A guard whose corpus vanished passes loudest of all. If the module is renamed or gutted, this
    // fails here rather than reporting a clean bill of health for a file that no longer exists.
    expect(module.length).toBeGreaterThan(8000);
    expect(module).toContain("pub fn record(");
    for (const command of COMMANDS) expect(module).toContain(`fn ${command}(`);
  });

  it("keeps the module's own claim of enforcement honest", () => {
    // support_evidence.rs tells the reader this file is what makes "nothing leaves the device"
    // structural. If the doc stops naming this guard — or this guard is renamed out from under the
    // doc — the promise silently reverts to prose.
    expect(module).toContain("src/support-evidence-outbound-guard.test.ts");
  });

  it("contains no outbound transport of any kind", () => {
    expect(
      detectRust(module),
      "The support evidence store gained a way to reach the network. Spec §12 is explicit: no " +
        "endpoint, no queue, no background uploader, no automatic attachment. Export writes a local " +
        "file and the USER attaches it — that is the transport, by design.",
    ).toEqual([]);
  });

  it("keeps its tests in one block at the tail (so the split below is honest)", () => {
    // productionSource() truncates at the first #[cfg(test)]. That is only a valid split while
    // there is exactly one, with nothing but the test module after it — otherwise the destination
    // check would quietly stop reading shipped code.
    expect(module.match(/#\[cfg\(test\)\]/g)).toHaveLength(1);
    expect(module.slice(module.indexOf("#[cfg(test)]"))).toMatch(
      /^#\[cfg\(test\)\]\s*mod tests \{[\s\S]*\}\s*$/,
    );
  });

  it("writes only into the local Compy data dir", () => {
    // The positive half of the rule: it is not enough that no socket exists — the destination has
    // to be somewhere the user owns, can read, and can delete.
    const shipped = stripRustComments(productionSource(module));
    expect(shipped).toContain("compy_data_dir()");
    expect(shipped, "a network share is not the local data dir").not.toMatch(/\\\\[A-Za-z0-9._-]+\\/);
  });

  it("adds no HTTP client to the crate", () => {
    // The structural backstop, and the one that survives a rewrite of the module: this crate has NO
    // http client dependency at all. Shipping an uploader would mean adding one here, in a diff
    // nobody can miss, rather than a quiet line inside a 700-line file.
    const deps = readFileSync(CARGO, "utf8").split("\n").filter((l) => !l.trim().startsWith("#"));
    const offenders = deps.filter((l) =>
      /^\s*(reqwest|ureq|isahc|attohttpc|surf|hyper|curl|tungstenite|tokio-tungstenite|tauri-plugin-http)\s*=/.test(l),
    );
    expect(
      offenders,
      "A network client crate appeared in src-tauri/Cargo.toml. Compy's only outbound surface is " +
        "the signed update check (tauri-plugin-updater, owner-armed 2026-07-22). A new one is a new " +
        "boundary: it needs its own spec, security review and owner sign-off (doctrine stop-rule 3).",
    ).toEqual([]);
  });

  it("keeps the update check as the only network-capable plugin", () => {
    const plugins = readFileSync(CARGO, "utf8")
      .split("\n")
      .map((l) => l.match(/^\s*(tauri-plugin-[a-z-]+)\s*=/)?.[1])
      .filter((p): p is string => Boolean(p));
    const networked = plugins.filter((p) => /updater|http|websocket|upload/.test(p));
    expect(networked).toEqual(["tauri-plugin-updater"]);
  });

  it("has no frontend surface that could send the bundle anywhere", () => {
    // Empty corpus TODAY (the preview/export UI is deferred), non-empty the day it lands — with no
    // list to remember to update. The detector itself is pinned below so this cannot pass by being
    // blind rather than by being clean.
    const offenders: string[] = [];
    for (const file of collectWeb("src")) {
      const source = readFileSync(file, "utf8");
      if (!mentionsEvidence(source)) continue;
      const found = detectWeb(source);
      if (found.length) offenders.push(`${file} → ${found.join(", ")}`);
    }
    expect(
      offenders,
      "A frontend file both touches the support evidence commands and talks to the network. The " +
        "bundle is exported to disk and attached by the user; nothing in the app sends it.",
    ).toEqual([]);
  });

  it("keeps support evidence out of the public site entirely", () => {
    // site-app/ is compy.gg. It has no business knowing these commands exist — a reference there
    // would mean evidence plumbing crossed into a surface that is, by definition, on the network.
    const leaked = collectWeb(join("site-app", "src")).filter((f) =>
      mentionsEvidence(readFileSync(f, "utf8")),
    );
    expect(leaked).toEqual([]);
  });

  it("catches the shapes it was written for (positive controls)", () => {
    // Each of these is a plausible next commit, not a strawman: the "helpful" auto-attach, the
    // quiet diagnostics ping, the shelled-out upload that dodges the crate list.
    expect(detectRust(`let c = reqwest::blocking::Client::new(); c.post(ENDPOINT).send();`)).toContain(
      "http client crate",
    );
    expect(detectRust(`const ENDPOINT: &str = "https://support.compy.gg/v1/evidence";`)).toContain(
      "hard-coded URL",
    );
    expect(detectRust(`fn upload_bundle(b: &EvidenceBundle) {}`)).toContain("upload verb");
    expect(detectRust(`quiet_command("powershell").arg("Invoke-RestMethod -Uri $u -Body $b");`)).toContain(
      "shelled-out transfer",
    );
    expect(detectRust(`let s = TcpStream::connect(addr)?;`)).toContain("raw socket");
    expect(detectWeb(`await fetch("/evidence", { method: "POST", body: bundle });`)).toContain("fetch");
    expect(detectWeb(`navigator.sendBeacon(url, JSON.stringify(bundle));`)).toContain("sendBeacon");
  });

  it("does not fire on the module's own description of the ban", () => {
    // The failure mode that would make this guard unusable: the doc comment saying "no endpoint, no
    // queue, no background uploader" is the clearest statement of the rule in the repo, and must not
    // be the thing that breaks it.
    const benign = `
      //! No endpoint, no queue, no background uploader, no automatic attachment.
      /* An earlier draft considered reqwest and https://support.example/ — both rejected. */
      fn export(projection: Projection) -> PathBuf {
          compy_data_dir().join("exports").join(format!("compy-support-{}.txt", projection.slug()))
      }`;
    expect(detectRust(benign)).toEqual([]);
  });
});
