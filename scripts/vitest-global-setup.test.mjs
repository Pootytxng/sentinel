// #339: the one call in the suite that leaves the machine is made ONCE, in the main process before
// the worker pool exists, and its refusal still fails closed where it is consumed. Pins the wiring
// in both directions so neither side can quietly go back to measuring inside the storm -- and
// checks, live, that the run it is part of went through the setup at all.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, inject, it, vi } from "vitest";
import setup, {
  CONSUMER,
  ORIGIN_HEADS_KEY,
  ORIGIN_MEASURED_KEY,
  measureOriginHeads,
  providedLsRemote,
  wantsOrigin,
} from "./lib/vitest-global-setup.mjs";
import { originHeads, trustedExclusions } from "./fleet-snapshot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("vitest global setup (#339): origin is asked once, before the pool", () => {
  it("measureOriginHeads asks for origin's heads with a deadline, and answers null when it cannot", () => {
    const exec = vi.fn(() => "abc\trefs/heads/main\ndef\trefs/heads/lane/x\n");
    expect(measureOriginHeads(exec)).toBe("abc\trefs/heads/main\ndef\trefs/heads/lane/x");
    expect(exec).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = exec.mock.calls[0];
    expect(cmd).toBe("git");
    expect(args).toEqual(["ls-remote", "--heads", "origin"]);
    expect(opts.timeout).toBeGreaterThan(0);
    expect(
      measureOriginHeads(() => {
        throw new Error("fatal: unable to access 'github.com'");
      }),
    ).toBeNull();
  });

  it("a whole-suite run and a run naming the consumer measure; a run naming only other files does not", () => {
    expect(wantsOrigin([])).toBe(true);
    expect(wantsOrigin(["run"])).toBe(true);
    expect(wantsOrigin(["run", "--maxWorkers=4"])).toBe(true);
    expect(wantsOrigin(["run", `scripts/${CONSUMER}.test.mjs`, "--maxWorkers=1"])).toBe(true);
    expect(wantsOrigin(["run", "scripts/process-mutex-guard.test.mjs", `scripts/${CONSUMER}.test.mjs`])).toBe(true);
    expect(wantsOrigin(["run", "src/App.test.tsx"])).toBe(false);
    expect(wantsOrigin(["run", "scripts/process-mutex-guard.test.mjs"])).toBe(false);
    // The two-token option form leaves a stray positional. It narrows towards skip, where the
    // consumer measures for itself -- never towards a pass.
    expect(wantsOrigin(["run", "--maxWorkers", "4"])).toBe(false);
  });

  it("setup provides the flag always and the measurement when wanted, as METHOD calls on the project", async () => {
    const calls = [];
    const project = {
      provide(key, value) {
        calls.push({ asMethod: this === project, key, value });
      },
    };
    await setup(project, { argv: ["run"], measure: () => "x\trefs/heads/main" });
    expect(calls).toEqual([
      { asMethod: true, key: ORIGIN_MEASURED_KEY, value: true },
      { asMethod: true, key: ORIGIN_HEADS_KEY, value: "x\trefs/heads/main" },
    ]);

    calls.length = 0;
    await setup(project, {
      argv: ["run", "src/App.test.tsx"],
      measure: () => {
        throw new Error("a run that does not reach the consumer must not reach the network");
      },
    });
    expect(calls).toEqual([{ asMethod: true, key: ORIGIN_MEASURED_KEY, value: false }]);

    // Never throws for an unreachable origin: it provides the refusal, and the consumer fails closed.
    calls.length = 0;
    await setup(project, { argv: ["run"], measure: () => null });
    expect(calls).toEqual([
      { asMethod: true, key: ORIGIN_MEASURED_KEY, value: true },
      { asMethod: true, key: ORIGIN_HEADS_KEY, value: null },
    ]);
  });

  it("the refusal stays a refusal where it is consumed: null reaches snapshot as an untrusted origin", () => {
    // undefined: the setup did not run, snapshot keeps its own runner (the status quo, in-pool).
    expect(providedLsRemote(undefined)).toBeUndefined();
    expect(originHeads(providedLsRemote(null))).toBeNull();
    expect(trustedExclusions(["origin/main"], originHeads(providedLsRemote(null)))).toBeNull();
    expect(originHeads(providedLsRemote("abc\trefs/heads/main\ndef\trefs/heads/lane/x"))).toEqual(["main", "lane/x"]);
  });

  it("live: the run this file is part of went through the setup", () => {
    // The flag is provided on every run the setup sees, so its absence is the wiring gone from
    // vitest.config.ts -- not a skipped measurement, which reads as `false` with no heads.
    const measured = inject(ORIGIN_MEASURED_KEY);
    expect(measured, "globalSetup did not run: vitest.config.ts no longer registers the setup").toBeTypeOf("boolean");
    const heads = inject(ORIGIN_HEADS_KEY);
    if (measured) expect(heads === null || typeof heads === "string").toBe(true);
    else expect(heads).toBeUndefined();
  });

  it("wiring: the config registers the setup, and rule C injects instead of measuring inside the pool", () => {
    const config = read("vitest.config.ts");
    expect(config).toContain('globalSetup: ["./scripts/lib/vitest-global-setup.mjs"]');
    const consumer = read(`scripts/${CONSUMER}.test.mjs`);
    expect(consumer).toMatch(/import \{[^}]*\binject\b[^}]*\} from "vitest"/);
    expect(consumer).toContain("providedLsRemote(inject(ORIGIN_HEADS_KEY))");
    // The in-pool deadline left with the call it bounded: this file no longer leaves the machine.
    expect(consumer).not.toContain("TALK_TO_ORIGIN");
  });
});
