// bug->guard: a remote is only the pinned repo if its HOST is GitHub, not just its owner/repo tail
//
// Caught 2026-08-02 reviewing this branch. `sameRepo` replaced a substring match (which accepted a
// fork) with a normalise-then-compare — but it compared only the `<owner>/<repo>` tail, because the
// pin constant is the bare string `Pootytxng/sentinel` with no host. The regex `^https?:\/\/[^/]+\/(.+)$`
// swallows the whole authority and throws it away, so ANY host paired with the right tail passed:
// the launcher would git fetch / merge --ff-only from it and then run that code.
//
// Verifying the apartment number and ignoring the street.
import { describe, expect, it } from "vitest";

import { sameRepo } from "./control-update.mjs";

const PIN = "Pootytxng/sentinel";

describe("the pinned remote must live on GitHub", () => {
  it("refuses a lookalike host that carries the right owner/repo tail", () => {
    expect(sameRepo("https://github.com.attacker.net/Pootytxng/sentinel", PIN)).toBe(false);
  });

  it("refuses a host that only has github.com as a prefix or suffix", () => {
    expect(sameRepo("https://github.company.internal/Pootytxng/sentinel", PIN)).toBe(false);
    expect(sameRepo("https://notgithub.com/Pootytxng/sentinel", PIN)).toBe(false);
  });

  it("refuses userinfo smuggling, where the real host hides after the @", () => {
    // `https://github.com@evil.net/...` connects to evil.net; a naive read sees "github.com" first.
    expect(sameRepo("https://github.com@evil.net/Pootytxng/sentinel", PIN)).toBe(false);
  });

  it("refuses a plain non-GitHub host", () => {
    expect(sameRepo("https://gitlab.com/Pootytxng/sentinel", PIN)).toBe(false);
  });
});

describe("the spellings git actually produces still pass", () => {
  it("accepts https, with and without .git and trailing slash", () => {
    expect(sameRepo("https://github.com/Pootytxng/sentinel", PIN)).toBe(true);
    expect(sameRepo("https://github.com/Pootytxng/sentinel.git", PIN)).toBe(true);
    expect(sameRepo("https://github.com/Pootytxng/sentinel/", PIN)).toBe(true);
  });

  it("accepts the SSH spellings", () => {
    expect(sameRepo("git@github.com:Pootytxng/sentinel.git", PIN)).toBe(true);
    expect(sameRepo("ssh://git@github.com/Pootytxng/sentinel.git", PIN)).toBe(true);
  });

  it("accepts www and a mixed-case host", () => {
    expect(sameRepo("https://www.github.com/Pootytxng/sentinel", PIN)).toBe(true);
    expect(sameRepo("https://GitHub.COM/Pootytxng/sentinel", PIN)).toBe(true);
  });

  it("accepts the bare owner/repo pin compared against itself", () => {
    expect(sameRepo(PIN, PIN)).toBe(true);
  });
});

describe("what the original fix already got right, kept pinned", () => {
  it("still refuses the fork the substring match used to accept", () => {
    expect(sameRepo("https://github.com/attacker/Pootytxng-sentinel-fork", PIN)).toBe(false);
  });

  it("still refuses a different repo under the same owner", () => {
    expect(sameRepo("https://github.com/Pootytxng/compy", PIN)).toBe(false);
  });

  it("still refuses empty and junk", () => {
    expect(sameRepo("", PIN)).toBe(false);
    expect(sameRepo(null, PIN)).toBe(false);
    expect(sameRepo(undefined, PIN)).toBe(false);
  });
});

describe("the PowerShell copy carries the same host check", () => {
  // compy-entry.ps1 is not executed by any test, so this asserts the two implementations have not
  // drifted apart — the JS tests above are what actually prove the behaviour.
  it("compy-entry.ps1 checks the host, not just the path", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const ps = readFileSync(join(repo, "compy-entry.ps1"), "utf8");
    expect(ps).toContain("Test-GitHubHost");
    expect(ps).toMatch(/github\\?\.com/);
  });
});
