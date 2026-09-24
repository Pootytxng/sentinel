// Guard for the writer-lease store (#553).
//
// 2026-09-23T21:17:53Z a session followed a memory note that said the folder's session record under
// `%LOCALAPPDATA%\CompyEntry\sessions\*.json` must be cleared after a board edit, and ran
//
//   Remove-Item "$env:LOCALAPPDATA\CompyEntry\board.json","$env:LOCALAPPDATA\CompyEntry\sessions\*.json"
//
// The glob matched EVERY lane's record, not the folder's own. Lanes #541 and #543 lost their leases
// and had to re-run `tools/entry/cli.mjs adopt`. Both guards let it through: `CompyEntry` sits under
// no checkout, so `zoneOf` answered `unprotected`.
//
// The zone rule lives in the shared library (`leaseStoreZone` in `.claude/hooks/target-ownership.mjs`)
// and holds for both guards now. The PowerShell spelling above also needs the shell guard to read
// `$env:LOCALAPPDATA` as its value and `"a","b"` as two paths. That half is an owner-hand patch
// (`docs/superpowers/specs/2026-09-23-powershell-env-knowable-553.patch`), and its tests below stay
// visibly SKIPPED, never vacuously green, until it is applied.
//
// NOTHING HERE TOUCHES THE REAL STORE. Every record lives under a `mkdtempSync` directory handed to
// the zone library as `deps.entryDir`. The one check on the real layout is pure path classification
// with the filesystem stubbed out.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { decide } from "../../.claude/hooks/project-write-assert.mjs";
import { LINEAGE_DIR_NAME, TOKEN_DIR, lineageFile } from "../../.claude/hooks/session-root-assert.mjs";
import * as shell from "../../.claude/hooks/shell-ownership-assert.mjs";
import { ZONES, leaseStoreZone, toComparable, zoneOf } from "../../.claude/hooks/target-ownership.mjs";

const T = mkdtempSync(join(tmpdir(), "lease-store-553-"));
afterAll(() => rmSync(T, { recursive: true, force: true }));

const ENTRY = join(T, "CompyEntry"); // stands in for %LOCALAPPDATA%\CompyEntry
const STORE = join(ENTRY, LINEAGE_DIR_NAME);
const ROOT = join(T, "lane"); // this session's folder
const OTHER = join(T, "other-lane"); // a live peer lane
const OWN_RECORD = lineageFile({ root: ROOT, dir: ENTRY });
const OTHER_RECORD = lineageFile({ root: OTHER, dir: ENTRY });
const BOARD = join(ENTRY, "board.json");

mkdirSync(STORE, { recursive: true });
mkdirSync(ROOT, { recursive: true });
mkdirSync(OTHER, { recursive: true });
writeFileSync(OWN_RECORD, JSON.stringify({ folder: ROOT, issue: 553 }));
writeFileSync(OTHER_RECORD, JSON.stringify({ folder: OTHER, issue: 541 }));
writeFileSync(BOARD, "{}");

const fwd = (p) => p.replace(/\\/g, "/");
const deps = { entryDir: ENTRY };
const zoneIn = (target, extra = {}) => zoneOf({ target, sessionRoot: ROOT, cwd: ROOT, ...extra, deps });
/** The real zone library, pointed at the temp store. */
const zone = (args) => zoneOf({ ...args, deps: { ...args.deps, ...deps } });
const VERIFIED = () => ({ ok: true, root: ROOT, issue: 553, branch: "claude/553-lease-store-guard" });
const shellDecide = (toolName, command) =>
  shell.decideShell({ toolName, toolInput: { command }, sessionRoot: ROOT, cwd: ROOT, verify: VERIFIED, zone, env: { LOCALAPPDATA: T } });

describe("the writer-lease store is every lane's, not anybody's (#553)", () => {
  it("keeps this folder's own record in its own-claim zone", () => {
    const z = zoneIn(OWN_RECORD);
    expect(z.zone).toBe(ZONES.OWN);
    expect(toComparable(z.owner)).toBe(toComparable(ROOT));
  });

  it("protects another folder's record, and names that folder as its owner", () => {
    const z = zoneIn(OTHER_RECORD);
    expect(z.zone).toBe(ZONES.SIBLING);
    expect(toComparable(z.owner)).toBe(toComparable(OTHER));
    expect(z.why).toContain("adopt --issue");
  });

  it("protects the store, a wildcard over it, and an ancestor removed with its contents", () => {
    expect(zoneIn(STORE).zone).toBe(ZONES.SIBLING);
    expect(zoneIn(join(STORE, "*.json")).zone).toBe(ZONES.SIBLING);
    expect(zoneIn(STORE + sep, { wildcard: true }).zone).toBe(ZONES.SIBLING);
    expect(zoneIn(ENTRY, { descendants: true }).zone).toBe(ZONES.SIBLING);
    expect(zoneIn(T, { descendants: true }).zone).toBe(ZONES.SIBLING);
  });

  it("a wildcard never reads as the own record, even one that would match it", () => {
    const own = OWN_RECORD.slice(0, -"json".length) + "*";
    expect(zoneIn(own).zone).toBe(ZONES.SIBLING);
  });

  it("leaves the rest of CompyEntry alone: the board cache is still free to clear", () => {
    expect(zoneIn(BOARD).zone).toBe(ZONES.UNPROTECTED);
    expect(zoneIn(ENTRY).zone).toBe(ZONES.UNPROTECTED);
  });

  it("is the rule doing the protecting: the same paths are unprotected once the store is elsewhere", () => {
    // Evidence must be able to falsify. Without this, a SIBLING above could come from some other
    // protection and the tests would stay green with the lease rule deleted.
    const moved = { entryDir: join(T, "elsewhere") };
    for (const target of [OTHER_RECORD, join(STORE, "*.json"), STORE]) {
      expect(zoneOf({ target, sessionRoot: ROOT, cwd: ROOT, deps: moved }).zone, target).toBe(ZONES.UNPROTECTED);
    }
  });

  it("covers the real store's location, not just the fixture's", () => {
    // Pure classification: the filesystem is stubbed, so the real store is never read.
    const stub = { exists: () => false, real: (p) => p };
    const glob = join(TOKEN_DIR, LINEAGE_DIR_NAME, "*.json");
    expect(leaseStoreZone(glob, ROOT, { ...stub, wildcard: true })?.zone).toBe(ZONES.SIBLING);
    expect(leaseStoreZone(join(TOKEN_DIR, "board.json"), ROOT, stub)).toBeNull();
  });
});

describe("both guards refuse the delete, through any tool (#553)", () => {
  it("the shell guard denies the Bash spellings of the incident", () => {
    for (const command of [
      'rm -f "$LOCALAPPDATA"/CompyEntry/sessions/*.json',
      'rm -rf "$LOCALAPPDATA/CompyEntry/sessions"',
      'rm -rf "$LOCALAPPDATA/CompyEntry"',
      `rm -f "${fwd(OTHER_RECORD)}"`,
      `mv "${fwd(OTHER_RECORD)}" "${fwd(join(T, "x.json"))}"`,
    ]) {
      const d = shellDecide("Bash", command);
      expect(d.permission, command).toBe("deny");
      expect(d.zone, command).toBe(ZONES.SIBLING);
    }
  });

  it("the shell guard still lets a folder clear the board cache and its own record", () => {
    expect(shellDecide("Bash", 'rm -f "$LOCALAPPDATA/CompyEntry/board.json"').permission).toBe("allow");
    expect(shellDecide("Bash", `rm -f "${fwd(OWN_RECORD)}"`).permission).toBe("allow");
  });

  it("the write guard refuses an overwrite of another folder's record", () => {
    const d = decide({ toolName: "Write", toolInput: { file_path: OTHER_RECORD }, root: ROOT, cwd: ROOT, verdict: VERIFIED(), zone });
    expect(d.allow).toBe(false);
    expect(d.code).toBe("TARGET_NOT_OURS");
    expect(d.reason).toContain(OTHER);
  });
});

describe("the PowerShell spelling of the incident (#553, owner-hand patch)", () => {
  const REPO = join(import.meta.dirname, "../..");
  const PATCH = join(REPO, "docs/superpowers/specs/2026-09-23-powershell-env-knowable-553.patch");
  const applied = typeof shell.expandPowerShellEnv === "function";
  const INCIDENT = String.raw`Remove-Item "$env:LOCALAPPDATA\CompyEntry\board.json","$env:LOCALAPPDATA\CompyEntry\sessions\*.json" -ErrorAction SilentlyContinue`;

  it("the owner-hand patch still applies to the hook as it is, and is gone once applied", () => {
    if (applied) {
      expect(existsSync(PATCH), "the patch is spent: delete it in the same commit that applies it").toBe(false);
      return;
    }
    expect(existsSync(PATCH), "the patch this test names must exist").toBe(true);
    expect(() => execFileSync("git", ["apply", "--check", PATCH], { cwd: REPO, stdio: "pipe" })).not.toThrow();
  });

  describe.skipIf(!applied)("once applied", () => {
    const env = { LOCALAPPDATA: T };
    const expand = (command) => shell.expandPowerShellEnv(command, { env });

    it("denies the exact 2026-09-23T21:17:53Z command", () => {
      const d = shellDecide("PowerShell", INCIDENT);
      expect(d.permission).toBe("deny");
      expect(d.zone).toBe(ZONES.SIBLING);
      expect(d.reason).toContain("writer-lease store");
    });

    it("denies the other PowerShell spellings, and still allows the board cache and the own record", () => {
      for (const command of [
        String.raw`Remove-Item -Recurse -Force "$env:LOCALAPPDATA\CompyEntry\sessions"`,
        String.raw`Remove-Item -Recurse "$env:LOCALAPPDATA\CompyEntry"`,
        String.raw`Remove-Item $ENV:localappdata\CompyEntry\sessions\*.json`,
        `Remove-Item "${OTHER_RECORD}"`,
      ]) {
        expect(shellDecide("PowerShell", command).permission, command).toBe("deny");
      }
      expect(shellDecide("PowerShell", String.raw`Remove-Item "$env:LOCALAPPDATA\CompyEntry\board.json"`).permission).toBe("allow");
      expect(shellDecide("PowerShell", `Remove-Item "${OWN_RECORD}"`).permission).toBe("allow");
    });

    it("reads an unquoted comma as two paths, and a quoted one as part of the path", () => {
      const words = (text) => shell.lex(text, "powershell").filter((t) => t.type === "word").map((t) => t.value);
      expect(words('Remove-Item "a","b"')).toEqual(["Remove-Item", "a", "b"]);
      expect(words("Remove-Item a, b")).toEqual(["Remove-Item", "a", "b"]);
      expect(words('Remove-Item "a,b"')).toEqual(["Remove-Item", "a,b"]);
    });

    it("expands only the well-known directories, only where PowerShell would", () => {
      const value = fwd(T);
      expect(expand(String.raw`rm $env:LOCALAPPDATA\x`)).toBe(String.raw`rm ${value}\x`);
      expect(expand("rm $" + String.raw`{env:localappdata}\x`)).toBe(String.raw`rm ${value}\x`);
      for (const same of [
        String.raw`rm '$env:LOCALAPPDATA\x'`, // single quotes are literal
        "rm \"`$env:LOCALAPPDATA\\x\"", // an escaped `$` is literal
        "Set-Content a.txt @'\n$env:LOCALAPPDATA\n'@", // a literal here-string
        String.raw`rm $env:PATH\x`, // not a well-known directory
        "rm $env:LOCALAPPDATA.x", // member access, not a path
        String.raw`rm "$env:LOCALAPPDATA:x"`, // the variable `LOCALAPPDATA:x`
      ]) {
        expect(expand(same), same).toBe(same);
      }
    });

    it("teaches nothing from a command that changes the environment it reads", () => {
      for (const command of [
        String.raw`$env:LOCALAPPDATA = "D:\x"; Remove-Item "$env:LOCALAPPDATA\CompyEntry\sessions\*.json"`,
        String.raw`$env:LOCALAPPDATA += "\y"; Remove-Item "$env:LOCALAPPDATA\z"`,
        String.raw`Set-Item Env:\LOCALAPPDATA D:\x; Remove-Item "$env:LOCALAPPDATA\z"`,
        String.raw`[Environment]::SetEnvironmentVariable('LOCALAPPDATA', 'D:\x'); Remove-Item "$env:LOCALAPPDATA\z"`,
      ]) {
        expect(expand(command), command).toBe(command);
      }
      // A comparison is a read, not an assignment.
      expect(expand(String.raw`if ($env:LOCALAPPDATA -eq 'x') { rm $env:LOCALAPPDATA\z }`)).not.toContain("$env:");
    });
  });
});
