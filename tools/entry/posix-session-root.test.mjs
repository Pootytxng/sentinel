// Guard: a Linux session owns its own checkout (caught 2026-09-16, the #393 cloud lane).
//
// `resolveSessionRoot` hands both write guards `canonicalizePath(root)`, which rewrites `/` to `\`
// on every OS. `zoneOf` then resolved that spelling with the host's `node:path`. On Windows the two
// separators are one separator, so nothing showed. On Linux `resolve("\\home\\user\\sentinel")` is
// a RELATIVE path under the cwd that does not exist, the session read as "in no checkout", and
// every write into the session's own checkout was denied as somebody else's: `git commit`,
// `git hash-object`, a redirect, and the `Write` tool alike. The lane had to push through the API.
//
// The dev machine and the only live gate are Windows, where the real `node:path` cannot show the
// defect. So this file runs the REAL hooks with `node:path` swapped for its POSIX half, and with
// `process.platform` and `process.cwd()` reading what the cloud session read. The filesystem and
// git are injected through `zoneOf`'s own seams: the fixture checkouts exist only in `EXISTS`.
// The native twin is in target-ownership.test.mjs, and it bites on a real Linux host.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:path", async () => {
  const actual = await vi.importActual("node:path");
  return { ...actual.posix, default: actual.posix };
});

import { run as runWrite } from "../../.claude/hooks/project-write-assert.mjs";
import { run as runShell } from "../../.claude/hooks/shell-ownership-assert.mjs";
import { ZONES, zoneOf } from "../../.claude/hooks/target-ownership.mjs";

const HOME = "/home/user";
const ROOT = "/home/user/sentinel";
const CLONE = "/home/user/sentinel-other"; // another clone of the same repository
const SCRATCH = "/tmp/claude/scratchpad";
const ORIGIN = "https://github.com/pootytxng/sentinel.git";

const EXISTS = new Set(["/", "/home", HOME, ROOT, `${ROOT}/.git`, `${ROOT}/src`, CLONE, `${CLONE}/.git`, `${CLONE}/src`, "/tmp", "/tmp/claude", SCRATCH]);
const IDENTITY = new Map([
  [ROOT, `${ROOT}/.git`],
  [CLONE, `${CLONE}/.git`],
]);

const deps = {
  exists: (p) => EXISTS.has(p),
  real: (p) => p,
  // Real git refuses a cwd that does not exist; so does this one.
  git: (cwd, args) => {
    if (!IDENTITY.has(cwd)) return null;
    if (args[0] === "rev-parse") return IDENTITY.get(cwd);
    if (args[0] === "remote") return ORIGIN;
    return null;
  },
  home: HOME,
};
const zone = (q) => zoneOf({ ...q, deps: { ...q.deps, ...deps } });
const verify = () => ({ ok: false, code: "FOLDER_UNCLAIMED" });
const env = { CLAUDE_PROJECT_DIR: ROOT };

const shell = (command) =>
  runShell({ hookInput: { tool_name: "Bash", tool_input: { command }, cwd: ROOT, session_id: "linux" }, env, verify, zone, home: HOME });
const write = (file_path) =>
  runWrite({ hookInput: { tool_name: "Write", tool_input: { file_path, content: "x" }, cwd: ROOT, session_id: "linux" }, env, verify, issueLookup: () => null, zone });

const platform = Object.getOwnPropertyDescriptor(process, "platform");
let cwdSpy = null;

beforeAll(() => {
  Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(ROOT);
});

afterAll(() => {
  cwdSpy?.mockRestore();
  Object.defineProperty(process, "platform", platform);
});

describe("a POSIX session root, in the spelling the hooks hand over", () => {
  it("is the session's own checkout, not a relative path beneath it", () => {
    const z = zoneOf({ target: `${ROOT}/src/new.ts`, sessionRoot: "\\home\\user\\sentinel", cwd: ROOT, deps });
    expect(z.zone).toBe(ZONES.OWN);
    expect(z.owner).toBe(ROOT);
  });

  it("still names another clone of the same repository as somebody else's", () => {
    const z = zoneOf({ target: `${CLONE}/src/new.ts`, sessionRoot: "\\home\\user\\sentinel", cwd: ROOT, deps });
    expect(z.zone).toBe(ZONES.SIBLING);
    expect(z.owner).toBe(CLONE);
  });
});

describe("the shell guard in a Linux session", () => {
  it.each([
    ["git commit", 'git commit -m "fix: posix root"'],
    ["git hash-object on a scratchpad file", `git hash-object -w ${SCRATCH}/blob.txt`],
    ["a redirect into the checkout", "printf 'x' > src/new.ts"],
    ["an absolute redirect into the checkout", `printf 'x' > ${ROOT}/src/new.ts`],
    ["git clone into the scratchpad", `git clone ${ORIGIN} ${SCRATCH}/sentinel`],
  ])("does not deny %s", (_label, command) => {
    const decision = shell(command);
    expect(decision.permission, decision.reason).not.toBe("deny");
  });

  it("carries the unclaimed-folder advisory for the session's own checkout, not a sibling refusal", () => {
    const decision = shell("printf 'x' > src/new.ts");
    expect(decision).toMatchObject({ permission: "allow", zone: ZONES.OWN, code: "FOLDER_UNCLAIMED" });
  });

  it("still denies a write into another clone of the same repository", () => {
    const decision = shell(`printf 'x' > ${CLONE}/src/new.ts`);
    expect(decision).toMatchObject({ permission: "deny", zone: ZONES.SIBLING });
  });
});

describe("the Write guard in a Linux session", () => {
  it("allows a write into the session's own checkout", () => {
    const decision = write(`${ROOT}/src/new.ts`);
    expect(decision.allow, decision.reason).toBe(true);
  });

  it("still refuses a write into another clone of the same repository", () => {
    expect(write(`${CLONE}/src/new.ts`)).toMatchObject({ allow: false, code: "TARGET_NOT_OURS" });
  });
});
