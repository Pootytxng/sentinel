// bug → guard, fourth and most-seen instance of the ledger-completeness class (Optimize/Fix closed
// by `b60a314`/`a1d5f53`, the Blackbook Logbook by `61e092c`, the Benchmark tab by `4150eb3`).
//
// `get_applied_changes` degrades a Trust Ledger it cannot READ to an empty array. Home is the first
// surface every user sees, and BOTH its faces print that emptiness as two readings plus a sentence:
//
//     Active changes   0    every one reversible from the ledger
//     Trust ledger     0    nothing applied yet — your PC is untouched
//
// That last clause is a claim ABOUT THE MACHINE, read off a record Compy cannot read — the strongest
// assertion in the app, made at the exact moment every apply and every rollback is refusing. And the
// "0" is not innocent either: HomeHud's own column header says every number is measured or honestly
// absent, and an unreadable ledger makes that zero an ABSENCE, not a measurement. The rule, in the
// wording intelligence.rs uses for the same distinction: the user must be able to tell "Compy did
// nothing" apart from "Compy can't tell you what it did".
//
// Home differs from the Benchmark tab in where the signal comes from. The list arrives as a PROP
// (App.tsx owns the fetch), so a transient failure never reaches these components at all — the only
// in-component signal is the health probe. Both incomplete shapes therefore arrive the same way and
// both are pinned below: transient (load_history() failing right now → `error`) and durable
// (quarantined on an earlier run, so every later load returns Ok(vec![]) forever, byte-identical to
// a genuine first run — the shape that actually lands this defect). And the case that is NOT a
// defect: health UNKNOWN (the probe itself failed or is disabled) must leave Home EXACTLY as it was,
// byte for byte — claiming incompleteness from a failed read is the same sin, mirrored.
//
// Narrowing applies to the EMPTY branch only. A PARTIAL list still names its real (floor) count and
// its latest change; the notice above it discloses that the number is a floor.
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

const health: { value: unknown; reject: boolean } = { value: null, reject: false };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    switch (cmd) {
      case "get_ledger_health":
        return health.reject ? Promise.reject(new Error("ipc down")) : Promise.resolve(health.value);
      case "get_build_stamp":
        return Promise.resolve("ab12cd3 · dev");
      case "get_gpu_sensors":
        return Promise.resolve([{ temperature_c: 62 }]);
      case "get_memory_pressure":
        return Promise.resolve({
          used_bytes: 14.2 * 1024 ** 3,
          total_bytes: 29.4 * 1024 ** 3,
          level: "ok",
        });
      default:
        return Promise.resolve(null);
    }
  }),
}));

// The r3f hologram can't mount in jsdom — stub it, same as home-v2.test.tsx. This file is about
// two readings in the telemetry column, nothing on the stage.
vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

import { HomeHud } from "./HomeHud";
import { HomeV2 } from "./HomeV2";
import { HomeRoom } from "./HomeRoom";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";

beforeAll(() => {
  // jsdom lacks both observers the vendored components use (ElectricBorder → ResizeObserver,
  // CountUp/DecryptedText → IntersectionObserver). Inert stubs — animation just never starts.
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const readiness: GameReadiness = {
  checks: [
    { id: "a", label: "A", status: "ready", detail: "", value: null },
    { id: "b", label: "B", status: "ready", detail: "", value: null },
    { id: "c", label: "C", status: "ready", detail: "", value: null },
  ],
  ready_count: 3,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const priorities: Priorities = {
  limiters: [
    {
      id: "disk",
      title: "C: drive is 87% full",
      reason: "Below ~10% free, load times suffer.",
      linked: null,
      confidence: "high",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const session = {
  started_at: "2026-07-01T18:00:00Z",
  duration_secs: 3600,
  process_name: "cyberpunk2077.exe",
  samples: 1000,
  avg_fps: 142.3,
  avg_frametime_ms: 7,
  low1_fps_est: 98.4,
  peak_gpu_temp_c: 71,
  peak_gpu_usage_pct: 97,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 1,
} as SessionSummary;

const CHANGE = {
  id: "ch1",
  rec_id: "hags-enable",
  rec_title: "Hardware-accelerated GPU scheduling",
  applied_at: "2026-06-28T18:22:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
} as unknown as AppliedChange;

const HEALTHY = { complete: true, error: null, quarantined: false };
const UNREADABLE = { complete: false, error: "failed to read history.json", quarantined: false };
const QUARANTINED = { complete: false, error: null, quarantined: true };

const UNREADABLE_TITLE = "Compy can't read its own record right now";
const QUARANTINED_TITLE = "Compy can't tell you everything it did";

// The sentence this file exists to keep off an unreadable ledger.
const FABRICATED = "nothing applied yet — your PC is untouched";
const REVERSIBLE_NOTE = "every one reversible from the ledger";
const ACTIVE_WITHDRAWN = "unknown — Compy can't read its own record";
const TRACKED_WITHDRAWN = "unknown — not the same as nothing applied";

type Face = {
  name: string;
  Comp: typeof HomeV2;
  /** localStorage state that makes HomeRoom render THIS face. */
  flags: Record<string, string>;
  card: string;
  key: string;
  num: string;
  activeLabel: string;
  ledgerLabel: string;
};

// HomeRoom renders one of these; both are user-reachable, so both must refuse. Note the number
// selectors are NEVER used positionally — the FIRST .hud-reading / .hv2-stat-n on either face is
// the session's fps, not the ledger (home-hud-flag.test.tsx:223, home-v2.test.tsx:336).
const FACES: Face[] = [
  {
    name: "HomeHud",
    Comp: HomeHud as typeof HomeV2,
    flags: { compy_home_console: "0", compy_editorial: "1" },
    card: ".hud-module",
    key: ".hud-eyebrow",
    num: ".hud-reading",
    activeLabel: "Active changes",
    ledgerLabel: "Trust ledger",
  },
  {
    name: "HomeV2",
    Comp: HomeV2,
    flags: { compy_home_console: "0", compy_editorial: "0" },
    card: ".hv2-stat",
    key: ".hv2-stat-k",
    num: ".hv2-stat-n",
    activeLabel: "Safe changes active",
    ledgerLabel: "Trust ledger",
  },
];

// Reduced motion → plain text/numbers (no DecryptedText/CountUp/ElectricBorder) — the paths the
// honesty assertions read directly.
const useReduced = () => localStorage.setItem("compy_motion", "reduced");

const props = (changes: AppliedChange[]) => ({
  hw,
  readiness,
  priorities,
  sessions: [session],
  changes,
  onRunCheck: vi.fn(),
  onSeeInFix: vi.fn(),
});

async function mount(face: Face, changes: AppliedChange[] = []) {
  useReduced();
  const Comp = face.Comp;
  const p = props(changes);
  const r = render(
    <ShellV2
      items={railFor(true)}
      activeId="home"
      onNavigate={() => {}}
      ledgerCount={changes.length}
      version="0.1.0"
    >
      <Comp {...p} />
    </ShellV2>,
  );
  // Flush the room's own probes, then the health probe keyed on the changes identity.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return r;
}

// Reads a claim off the ELEMENT that carries it rather than matching a page substring: a substring
// matcher keeps passing after a reword, which is exactly the failure this file exists to catch.
// Throws loudly if the anchor moved, so a rename fails as a rename and not as a false pass.
function cardFor(container: HTMLElement, face: Face, label: string): HTMLElement {
  const cards = Array.from(container.querySelectorAll<HTMLElement>(face.card));
  const hit = cards.find((c) => c.querySelector(face.key)?.textContent?.trim() === label);
  if (!hit) {
    throw new Error(
      `${face.name}: no "${face.card}" labelled "${label}" — the anchor moved, which is not the bug this file guards`,
    );
  }
  return hit;
}

beforeEach(() => {
  health.value = HEALTHY;
  health.reject = false;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe.each(FACES)("$name may not report a ledger it can't read as an untouched PC", (face) => {
  it("a quarantined ledger withdraws BOTH readings — the durable shape loads clean-and-empty forever", async () => {
    health.value = QUARANTINED;
    const { container } = await mount(face);

    const active = cardFor(container, face, face.activeLabel);
    const ledger = cardFor(container, face, face.ledgerLabel);

    // Zero is an absence here, not a measurement — so the reading goes, the note stays. That is
    // the same honest-absence idiom the last-session module above already uses.
    expect(active.querySelector(face.num)).toBeNull();
    expect(active.textContent).toContain(ACTIVE_WITHDRAWN);
    expect(active.textContent).not.toContain(REVERSIBLE_NOTE);

    expect(ledger.querySelector(face.num)).toBeNull();
    expect(ledger.textContent).toContain(TRACKED_WITHDRAWN);

    // The claim about the machine is gone from the WHOLE page, not just from that card.
    expect(container.textContent).not.toContain(FABRICATED);
    expect(screen.getByText(QUARANTINED_TITLE)).toBeTruthy();
  });

  it("an unreadable ledger does the same — apply and rollback are both refusing at that moment", async () => {
    health.value = UNREADABLE;
    const { container } = await mount(face);

    expect(cardFor(container, face, face.activeLabel).textContent).toContain(ACTIVE_WITHDRAWN);
    expect(cardFor(container, face, face.ledgerLabel).textContent).toContain(TRACKED_WITHDRAWN);
    expect(container.textContent).not.toContain(FABRICATED);
    expect(screen.getByText(UNREADABLE_TITLE)).toBeTruthy();
  });

  it("a healthy empty ledger keeps its numbers and its sentence — the honest empty case is untouched", async () => {
    const { container } = await mount(face);

    const active = cardFor(container, face, face.activeLabel);
    expect(active.querySelector(face.num)?.textContent).toContain("0");
    expect(active.textContent).toContain(REVERSIBLE_NOTE);
    expect(container.textContent).toContain(FABRICATED);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });

  it("the disclosure is read BEFORE the readings it qualifies, and exists exactly once", async () => {
    health.value = QUARANTINED;
    const { container } = await mount(face);

    const box = container.querySelector(".ledger-health")!;
    expect(box).toBeTruthy();
    // A caveat printed under the thing it qualifies has already failed at its job.
    const active = cardFor(container, face, face.activeLabel);
    const ledger = cardFor(container, face, face.ledgerLabel);
    expect(box.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(ledger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One notice covers both readings — two would read as two separate problems.
    expect(container.querySelectorAll(".ledger-health").length).toBe(1);
  });

  it("a PARTIAL list still names its real count — it is the dangerous case, because it looks whole", async () => {
    health.value = QUARANTINED;
    const { container } = await mount(face, [CHANGE]);

    // Narrowing applies only to the EMPTY branch. The floor is a real measurement; the notice
    // above it is what discloses that it is a floor.
    const active = cardFor(container, face, face.activeLabel);
    expect(active.querySelector(face.num)?.textContent).toContain("1");
    const ledger = cardFor(container, face, face.ledgerLabel);
    expect(ledger.textContent).toContain("Hardware-accelerated GPU scheduling");
    expect(container.querySelector(".ledger-health")).toBeTruthy();
  });
});

describe.each(FACES)("$name: UNKNOWN health is not incompleteness", (face) => {
  it("a failed probe leaves the room BYTE-IDENTICAL to a healthy ledger", async () => {
    // HudFrame prints the live wall clock (HH:MM:SS), so two renders microseconds apart can
    // straddle a second boundary and differ on the readout alone — a false-red on a byte-identity
    // failsafe (diagnosed 2026-07-17, home-hud-flag.test.tsx:177). Freeze ONLY Date: faking the
    // timer queue too would interfere with the async flush these mounts need.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-17T12:00:00"));
    try {
      const healthy = (await mount(face)).container.innerHTML;
      cleanup();

      health.reject = true;
      const unknown = (await mount(face)).container.innerHTML;

      expect(unknown).toBe(healthy);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a probe that resolves NOTHING is treated the same — silence is not a report of damage", async () => {
    // This is also why the 29 pre-existing Home tests never moved: their mocks answer
    // get_ledger_health with null, so health is UNKNOWN and nothing narrows.
    health.value = null;
    const { container } = await mount(face);

    expect(container.textContent).toContain(FABRICATED);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });

  it("a ledger that reports itself COMPLETE is left alone — complete:true is the backend vouching", async () => {
    const { container } = await mount(face);

    expect(container.textContent).toContain(FABRICATED);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });
});

describe("the refusal reaches the user, not just the component", () => {
  // A fix wired into a face nobody renders is not a fix. HomeRoom picks the face off two flags;
  // these mount THROUGH it so the guard fails if the routing ever leaves a face behind.
  it.each(FACES)("$name is reachable from HomeRoom and refuses there too", async (face) => {
    useReduced();
    for (const [k, v] of Object.entries(face.flags)) localStorage.setItem(k, v);
    health.value = QUARANTINED;

    const p = props([]);
    const { container } = render(
      <ShellV2
        items={railFor(true)}
        activeId="home"
        onNavigate={() => {}}
        ledgerCount={0}
        version="0.1.0"
      >
        <HomeRoom {...p} />
      </ShellV2>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cardFor(container, face, face.activeLabel).textContent).toContain(ACTIVE_WITHDRAWN);
    expect(container.textContent).not.toContain(FABRICATED);
  });
});
