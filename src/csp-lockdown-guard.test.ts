import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same pattern as voice-guard.test.ts.)

// CSP / webview-network lockdown guard (Measurement Platform 2.0, Task H).
// Compy's signed Rust-side updater is the one approved outbound surface; Receipts telemetry remains
// dark, default-OFF, and owner-gated. The production Content-Security-Policy is the separate wall
// that mechanically forbids the webview from reaching any remote host:
// connect-src is restricted to the app itself + the Tauri IPC/asset local schemes. This guard pins
// that wall so a well-meaning edit to tauri.conf.json can't silently widen it and open an outbound
// channel. If this fails: you loosened the production CSP — that is an owner-gated security change
// (welfare-check first), not a routine edit. Revert, or take it to the owner.
//
// NOTE: only the PRODUCTION `security.csp` object is checked. `devCsp` is intentionally looser
// (Vite HMR needs ws://localhost:1420) and never ships in a release bundle.

const conf = JSON.parse(readFileSync(join("src-tauri", "tauri.conf.json"), "utf8")) as {
  app?: { security?: { csp?: Record<string, string> } };
};
const csp = conf.app?.security?.csp;

// The ONLY tokens allowed to source content in the production CSP. All are the app itself or a
// Tauri-local scheme (ipc:/asset: bridges + their http://*.localhost origins, data:/blob: inline
// payloads). None can reach the public internet. A remote origin (https://, //host, a bare domain,
// or a wildcard) appearing in ANY directive is the failure this guard exists to catch.
const LOCAL_TOKENS = new Set([
  "'self'",
  "'none'",
  "'unsafe-inline'", // style-src only — inline styles, not a network origin
  "ipc:",
  "asset:",
  "data:",
  "blob:",
  "http://ipc.localhost",
  "http://asset.localhost",
]);

// A token that names (or wildcards to) a remote host. Anything not in LOCAL_TOKENS is checked here
// so the failure message is specific about WHY it's a leak.
function isRemoteOrigin(token: string): boolean {
  if (LOCAL_TOKENS.has(token)) return false;
  return (
    token.includes("*") || // wildcard host
    token.startsWith("https://") ||
    token.startsWith("//") ||
    token.startsWith("ws://") ||
    token.startsWith("wss://") ||
    // any http:// origin that is NOT one of the two allowed *.localhost bridges
    (token.startsWith("http://") &&
      token !== "http://ipc.localhost" &&
      token !== "http://asset.localhost") ||
    // a bare token containing a dot that isn't a known scheme keyword ⇒ looks like a domain
    /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(token)
  );
}

describe("CSP lockdown guard: the production webview cannot reach remote hosts", () => {
  it("has a structured production security.csp object", () => {
    expect(csp, "src-tauri/tauri.conf.json app.security.csp must be a directive object").toBeTruthy();
  });

  it("connect-src reaches no remote host (the outbound wall)", () => {
    const connect = csp?.["connect-src"] ?? "";
    const leaks = connect.split(/\s+/).filter(Boolean).filter(isRemoteOrigin);
    expect(
      leaks,
      `production connect-src names a remote origin — outbound channel opened:\n${leaks.join("\n")}\nfull directive: "${connect}"`,
    ).toEqual([]);
  });

  it("no directive names a remote origin", () => {
    const offenders: string[] = [];
    for (const [directive, value] of Object.entries(csp ?? {})) {
      for (const token of value.split(/\s+/).filter(Boolean)) {
        if (isRemoteOrigin(token)) offenders.push(`${directive}: "${token}"`);
      }
    }
    expect(
      offenders,
      `production CSP directive(s) name a remote origin:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the core directives locked (default/script/object/base/frame-ancestors)", () => {
    expect(csp?.["default-src"], "default-src must be 'self'").toBe("'self'");
    // script-src must not permit remote or eval: only 'self' executes.
    expect(csp?.["script-src"], "script-src must be 'self' (no eval, no remote)").toBe("'self'");
    expect(csp?.["object-src"], "object-src must be 'none'").toBe("'none'");
    expect(csp?.["base-uri"], "base-uri must be 'self'").toBe("'self'");
    expect(csp?.["frame-ancestors"], "frame-ancestors must be 'none'").toBe("'none'");
  });
});
