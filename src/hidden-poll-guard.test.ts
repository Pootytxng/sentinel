import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

// HIDDEN-POLL GUARD (2026-08-04, Q7 idle-cost audit).
//
// WHY THIS EXISTS — an adoption gap, not a design disagreement:
//
//   `src/data/use-document-visible.ts` was written for exactly one job — pause main-window work
//   while the user can't see it — and its own doc comment states the contract. Four surfaces
//   adopted it. Seven did not, including `HomeConsole`, the DEFAULT room behind the default-ON
//   flag. So on a stock install, alt-tabbing into a fullscreen game left Home calling the vendor
//   GPU SDK every 5s, the rig hologram polling FPS status every 1.5s, and (with Monitoring open)
//   five IPC calls a second — indefinitely, invisibly. Compy's whole promise is "don't hurt the
//   game"; that is the exact cost it exists to avoid, and nothing mechanical was watching for it.
//
// So the rule is stated mechanically: a surface that polls a live SENSOR on a timer must reference
// `useDocumentVisible`. The corpus is INVERTED on purpose (walk everything, exempt explicitly, with
// a reason) — the same lesson the mutation-boundary and outbound-claim guards learned: the logic is
// never the weak part, the corpus is. A new sensor-polling surface is in scope the moment it
// exists, with no list to remember to update.
//
// SCOPE, stated honestly: this is a FILE-level check, not an AST one. It proves the hook is wired
// into a polling file; it cannot prove the gate landed on the right effect. That is deliberate —
// cheap and robust beats clever and brittle — and it catches the failure that actually happened
// (the hook simply absent). Deps-array correctness stays a review concern.
//
// Paths are repo-root-relative; vitest runs from the repo root (scripts/run-vitest.mjs).

const HOOK = "useDocumentVisible";

// Read-only sensor commands whose values are DISPLAY-ONLY. Polling one on a timer is idle cost the
// moment the window is hidden: the reading is stale before anyone can see it, and it re-reads on
// the first tick back.
const SENSOR_COMMANDS = [
  "get_gpu_sensors",
  "get_cpu_sensors",
  "get_fps_status",
  "get_fan_sensors",
  "get_memory_pressure",
  "get_cpu_temp",
];

// Exemptions carry a REASON, never a bare path — an unexplained exemption is how a guard rots into
// a formality. The one below is a refusal on the merits, not a deferral.
//
// RETRACTED 2026-08-04: `src/surfaces/MonitorV2.tsx` was exempted here on the claim that pausing
// its capture-door poll "could strand the door". Auditing the file disproved that — `capturing`
// feeds exactly two things, `doorOpen={!capturing}` and the masthead LED, both of which are
// invisible while the window is hidden, and the effect's tick() fires immediately when it re-runs.
// The exemption was reasoning, not evidence, and this is what an exemption-with-a-reason is for:
// the reason is a claim, and a claim can be checked. MonitorV2 now gates like everything else.
const EXEMPT: Record<string, string> = {
  "src/Overlay.tsx":
    "The in-game HUD. use-document-visible.ts forbids this surface BY NAME: a wrong 'hidden' read " +
    "here blanks the overlay over a fullscreen game. It gates on its own explicit show/hide signal.",
};

// ── Corpus ──────────────────────────────────────────────────────────────────────────────────────

function sources(): string[] {
  return readdirSync("src", { recursive: true })
    .map(String)
    .filter((p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith(".d.ts"))
    .map((p) => join("src", p).replace(/\\/g, "/"))
    .sort();
}

/** Files that poll a live sensor on a timer — the population this guard governs. */
function pollingSurfaces(): { file: string; commands: string[]; text: string }[] {
  const out: { file: string; commands: string[]; text: string }[] = [];
  for (const file of sources()) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("setInterval")) continue;
    const commands = SENSOR_COMMANDS.filter((c) => text.includes(`"${c}"`));
    if (commands.length === 0) continue;
    out.push({ file, commands, text });
  }
  return out;
}

// ── The guard ───────────────────────────────────────────────────────────────────────────────────

describe("hidden-poll guard", () => {
  it("finds the sensor-polling surfaces at all (the corpus is the weak part)", () => {
    // A refactor that renames the commands or the timer call would silently empty the corpus and
    // turn every assertion below into a no-op. Pin the floor: the census found 13 on 2026-08-04.
    expect(pollingSurfaces().length).toBeGreaterThanOrEqual(13);
  });

  it("every sensor-polling surface gates on document visibility", () => {
    const offenders = pollingSurfaces()
      .filter(({ file }) => !(file in EXEMPT))
      .filter(({ text }) => !text.includes(HOOK))
      .map(({ file, commands }) => `${file} polls ${commands.join(", ")} without ${HOOK}`);

    expect(
      offenders,
      `A surface polls a live sensor on a timer but never pauses while the window is hidden.\n` +
        `Import ${HOOK} from src/data/use-document-visible, and gate the effect:\n` +
        `    const visible = useDocumentVisible();\n` +
        `    useEffect(() => { if (!visible) return; ... }, [visible]);\n` +
        `Values freeze at their last reading and refresh on the first tick back — no blanking.\n` +
        `If the surface genuinely must keep polling while hidden, add it to EXEMPT WITH A REASON.\n`,
    ).toEqual([]);
  });

  it("every exemption still exists and still polls (no dead entries)", () => {
    // An exemption that outlives its file is a lie the next reader has to disprove.
    const polling = new Set(pollingSurfaces().map((s) => s.file));
    const stale = Object.keys(EXEMPT).filter((f) => !polling.has(f));
    expect(stale, `EXEMPT names files that no longer poll a sensor — delete them`).toEqual([]);
  });

  it("the hook it points at is the real one", () => {
    // The whole guard is a pointer to one file. If that file moves, every message above misleads.
    const hook = readFileSync("src/data/use-document-visible.ts", "utf8");
    expect(hook).toContain(`export function ${HOOK}(): boolean`);
    expect(hook).toContain("visibilitychange");
  });
});
