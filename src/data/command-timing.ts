// Dev-only Tauri command latency sampler: p50 / p95 per command, measured as the full IPC round
// trip the UI waits on (request out, serialization, Rust handler, response back).
//
// WHERE IT HOOKS, AND WHY THERE. Wrapping the IPC object's `invoke` does not work in Tauri 2: the
// init script redefines it non-writable after page scripts run, so a wrapper is silently discarded
// and reports zero (measured, see scripts/q7-probe.mjs). What every invoke actually does is a
// `fetch` to the IPC custom protocol: `http://ipc.localhost/<command>` on Windows,
// `ipc://localhost/<command>` on macOS/Linux. `window.fetch` is writable, the command is the URL's
// last path segment, and plugin commands are covered too. Nothing else is touched: non-IPC requests
// pass straight through untimed.
//
// COST. Dev builds only (`import.meta.env.DEV`): a release bundle never installs it. In dev each
// IPC call pays one URL parse, two performance.now() reads and a bounded array push. Nothing is
// sent anywhere and nothing is written to disk; the samples live in memory for this window only.
//
// READING IT (devtools console): `__compyTiming.table()` prints n / p50 / p95 / max / errors per
// command, slowest p95 first; `__compyTiming.summary()` returns the same rows; `__compyTiming.reset()`
// clears them.

/** Samples kept per command (newest win). Bounds memory for a long dev session. */
export const MAX_SAMPLES_PER_COMMAND = 1000;

export interface CommandTimingRow {
  command: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  errors: number;
}

interface Bucket {
  samples: number[];
  next: number; // ring write position once full
  errors: number;
  total: number;
}

/** Nearest-rank percentile of an ascending array. Empty input returns NaN. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

/**
 * The command name of a Tauri IPC request URL, or null when the URL is not IPC.
 * Plugin commands arrive percent-encoded ("plugin%3Aevent%7Clisten").
 */
export function ipcCommandOf(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const isIpc =
    (u.protocol === "ipc:" && u.hostname === "localhost") ||
    ((u.protocol === "http:" || u.protocol === "https:") && u.hostname === "ipc.localhost");
  if (!isIpc) return null;
  const last = u.pathname.split("/").filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

export class CommandTimings {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly cap = MAX_SAMPLES_PER_COMMAND) {}

  record(command: string, ms: number, ok: boolean): void {
    let b = this.buckets.get(command);
    if (!b) {
      b = { samples: [], next: 0, errors: 0, total: 0 };
      this.buckets.set(command, b);
    }
    b.total += 1;
    if (!ok) b.errors += 1;
    if (b.samples.length < this.cap) {
      b.samples.push(ms);
    } else {
      b.samples[b.next] = ms;
      b.next = (b.next + 1) % this.cap;
    }
  }

  /** One row per command, slowest p95 first. Percentiles cover the retained window. */
  summary(): CommandTimingRow[] {
    const rows: CommandTimingRow[] = [];
    for (const [command, b] of this.buckets) {
      const sorted = [...b.samples].sort((x, y) => x - y);
      rows.push({
        command,
        count: b.total,
        p50: round1(percentile(sorted, 50)),
        p95: round1(percentile(sorted, 95)),
        max: round1(sorted[sorted.length - 1]),
        errors: b.errors,
      });
    }
    return rows.sort((a, b) => b.p95 - a.p95 || a.command.localeCompare(b.command));
  }

  reset(): void {
    this.buckets.clear();
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
interface TimingHost {
  fetch: FetchFn;
}

const INSTALLED = Symbol.for("cmd-timing-installed");

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * Wrap `host.fetch` so IPC requests are timed into `timings`. Idempotent per host.
 * Returns false if the host was already wrapped.
 */
export function installCommandTiming(
  host: TimingHost,
  timings: CommandTimings,
  now: () => number = () => performance.now(),
): boolean {
  const current = host.fetch as FetchFn & { [INSTALLED]?: true };
  if (current[INSTALLED]) return false;
  const original = current;
  const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const command = ipcCommandOf(urlOf(input));
    if (command === null) return original.call(this, input, init);
    const start = now();
    return original.call(this, input, init).then(
      (res) => {
        timings.record(command, now() - start, res.ok);
        return res;
      },
      (err: unknown) => {
        timings.record(command, now() - start, false);
        throw err;
      },
    );
  } as FetchFn & { [INSTALLED]?: true };
  wrapped[INSTALLED] = true;
  host.fetch = wrapped;
  return true;
}

/** Entry point for main.tsx: installs on `window` in dev builds only, exposes `__compyTiming`. */
export function maybeInstallCommandTiming(): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  const timings = new CommandTimings();
  if (!installCommandTiming(window, timings)) return;
  (window as unknown as { __compyTiming: unknown }).__compyTiming = {
    summary: () => timings.summary(),
    table: () => console.table(timings.summary()),
    reset: () => timings.reset(),
  };
}
