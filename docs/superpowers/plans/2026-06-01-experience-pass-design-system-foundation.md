# Experience Pass — Design-System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ EXECUTION GATE:** This plan touches product code (`src/`). Per the resumed-session locks and
> spec Decision E, **do not start execution until the owner approves.** It is also the
> *decision-independent* sub-project (#1 of 7 in the spec): pure substrate that's needed regardless
> of owner Decisions A–D. The other sub-projects (decomposition scope, SystemPosture/dashboard,
> per-surface passes, gamification reconciliation, modes) get their own plans **after** A–F land,
> because those decisions change their task structure. See
> `docs/superpowers/specs/2026-06-01-experience-design-system-pass-design.md`.

**Goal:** Build a small, tested design-system layer (`src/design/`) — token contract, pure UI
helpers, and presentational primitives — that every Sentinel surface can be restyled onto.

**Architecture:** Additive and non-breaking. New `src/design/` module with a CSS token contract
(extends, does not replace, the existing `:root` in `App.css`), two pure TS helper modules
(unit-tested with Vitest), and focused React primitives (render-smoke-tested). A dev-only Gallery
page renders every primitive for visual verification. No surface is rewritten in this plan; the
existing app keeps working unchanged.

**Tech Stack:** React 19, TypeScript 5.8, Vite 7, Vitest + @testing-library/react (added in Task 0),
CSS custom properties. Offline/zero-outbound preserved (no remote fonts/assets; inline SVG icons).

---

## File structure (created in this plan)

- `vitest.config.ts` — Vitest config (jsdom env).
- `src/test/setup.ts` — testing-library matchers setup.
- `src/design/tokens.css` — semantic status-token map + named motion/interaction tokens + reduced-motion.
- `src/design/status.ts` — `Status` type + pure `statusMeta()`; **unit-tested**.
- `src/design/geometry.ts` — pure `gaugePercent()` + `sparkPoints()`; **unit-tested**.
- `src/design/Icon.tsx` — icon set + `<Icon>` (extracted from `App.tsx`, plus status icons).
- `src/design/StatusPill.tsx` — `<StatusPill>`; render-smoke-tested.
- `src/design/Card.tsx` — `<Card>`, `<Panel>`, `<SectionHeader>`.
- `src/design/Stat.tsx` — `<Stat>`.
- `src/design/Gauge.tsx` — `<Gauge>` (radial instrument readout).
- `src/design/Sparkline.tsx` — `<Sparkline>`.
- `src/design/TrustCue.tsx` — `<TrustCue>`.
- `src/design/EmptyState.tsx` — `<EmptyState>`.
- `src/design/index.ts` — barrel export.
- `src/design/Gallery.tsx` — dev-only visual gallery of all primitives.
- Test files colocated: `src/design/*.test.ts` / `*.test.tsx`.

> **Note on `App.tsx`:** This plan does **not** modify `App.tsx` except the optional dev mount of
> `<Gallery>` in Task 12. Migrating real surfaces onto these primitives is sub-project #2+.

---

## Task 0: Add the Vitest test toolchain

**Files:**
- Modify: `package.json` (devDeps + `test` script)
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/design/smoke.test.ts`

- [ ] **Step 1: Install test deps**

Run:
```bash
npm install -D vitest@^2 jsdom@^25 @testing-library/react@^16 @testing-library/jest-dom@^6
```

- [ ] **Step 2: Add the `test` script to `package.json`**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 5: Create a trivial smoke test `src/design/smoke.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("test toolchain", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the test toolchain**

Run: `npm test`
Expected: PASS — 1 test passes (`test toolchain > runs`).

- [ ] **Step 7: Confirm the production build still works**

Run: `npm run build`
Expected: `tsc` clean + `vite build` succeeds (test deps don't affect the bundle).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/test/setup.ts src/design/smoke.test.ts
git commit -m "test: add Vitest + testing-library toolchain"
```

---

## Task 1: Token contract (`src/design/tokens.css`)

**Files:**
- Create: `src/design/tokens.css`
- Modify: `src/App.css:1` (add `@import "./design/tokens.css";` at the very top)

- [ ] **Step 1: Create `src/design/tokens.css`** (additive — names a status map + motion set, derived from existing tokens; overrides nothing)

```css
/* Design-system token contract. Additive over App.css :root. Semantic names so
   every surface reads status + motion from one place. Theme blocks already in
   App.css continue to drive the raw --ready/--attention/--accent values. */
:root {
  /* Status map — value + soft fill + line, keyed by semantic status. */
  --status-ready: var(--ready);
  --status-ready-soft: rgba(70, 217, 138, 0.12);
  --status-ready-line: rgba(70, 217, 138, 0.32);
  --status-attention: var(--attention);
  --status-attention-soft: rgba(245, 183, 64, 0.12);
  --status-attention-line: rgba(245, 183, 64, 0.32);
  --status-danger: var(--danger);
  --status-danger-soft: rgba(243, 113, 111, 0.12);
  --status-danger-line: rgba(243, 113, 111, 0.32);
  --status-protected: var(--accent);
  --status-protected-soft: var(--accent-soft);
  --status-protected-line: var(--accent-line);
  --status-unknown: var(--faint);

  /* Named interaction/motion tokens (durations/eases already exist in App.css). */
  --dur-tap: 90ms;
  --lift-hover: -2px;
  --press: translateY(1px);
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

- [ ] **Step 2: Import it at the top of `App.css`**

At `src/App.css` line 1, add as the first line:
```css
@import "./design/tokens.css";
```

- [ ] **Step 3: Verify build + that the app still renders unchanged**

Run: `npm run build`
Expected: clean. (Visual: `npm run tauri dev` shows the app identical — tokens are additive.)

- [ ] **Step 4: Commit**

```bash
git add src/design/tokens.css src/App.css
git commit -m "feat(design): add semantic status + motion token contract"
```

---

## Task 2: `status.ts` — pure status metadata (TDD)

**Files:**
- Create: `src/design/status.ts`
- Test: `src/design/status.test.ts`

- [ ] **Step 1: Write the failing test `src/design/status.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { statusMeta, type Status } from "./status";

describe("statusMeta", () => {
  it("maps ready to its label and CSS vars", () => {
    expect(statusMeta("ready")).toEqual({
      label: "Ready",
      colorVar: "var(--status-ready)",
      softVar: "var(--status-ready-soft)",
      lineVar: "var(--status-ready-line)",
    });
  });

  it("maps attention", () => {
    expect(statusMeta("attention").label).toBe("Attention");
  });

  it("maps protected, scanning, unknown to honest labels", () => {
    expect(statusMeta("protected").label).toBe("Protected");
    expect(statusMeta("scanning").label).toBe("Scanning");
    expect(statusMeta("unknown").label).toBe("Unavailable");
  });

  it("falls back to unknown for an unexpected value", () => {
    expect(statusMeta("bogus" as Status).label).toBe("Unavailable");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- status`
Expected: FAIL — `./status` cannot be resolved.

- [ ] **Step 3: Implement `src/design/status.ts`**

```ts
export type Status = "ready" | "attention" | "danger" | "protected" | "scanning" | "unknown";

export type StatusMeta = {
  label: string;
  colorVar: string;
  softVar: string;
  lineVar: string;
};

const MAP: Record<Status, StatusMeta> = {
  ready:     { label: "Ready",       colorVar: "var(--status-ready)",      softVar: "var(--status-ready-soft)",      lineVar: "var(--status-ready-line)" },
  attention: { label: "Attention",   colorVar: "var(--status-attention)",  softVar: "var(--status-attention-soft)",  lineVar: "var(--status-attention-line)" },
  danger:    { label: "Critical",    colorVar: "var(--status-danger)",     softVar: "var(--status-danger-soft)",     lineVar: "var(--status-danger-line)" },
  protected: { label: "Protected",   colorVar: "var(--status-protected)",  softVar: "var(--status-protected-soft)",  lineVar: "var(--status-protected-line)" },
  scanning:  { label: "Scanning",    colorVar: "var(--muted)",             softVar: "transparent",                   lineVar: "var(--border-strong)" },
  unknown:   { label: "Unavailable", colorVar: "var(--status-unknown)",    softVar: "transparent",                   lineVar: "var(--border-strong)" },
};

export function statusMeta(status: Status): StatusMeta {
  return MAP[status] ?? MAP.unknown;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- status`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/design/status.ts src/design/status.test.ts
git commit -m "feat(design): status metadata helper"
```

---

## Task 3: `geometry.ts` — pure gauge + sparkline math (TDD)

**Files:**
- Create: `src/design/geometry.ts`
- Test: `src/design/geometry.test.ts`

- [ ] **Step 1: Write the failing test `src/design/geometry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { gaugePercent, sparkPoints } from "./geometry";

describe("gaugePercent", () => {
  it("returns 0..100 within range", () => {
    expect(gaugePercent(50, 0, 100)).toBe(50);
    expect(gaugePercent(30, 0, 120)).toBe(25);
  });
  it("clamps out-of-range and handles a zero span", () => {
    expect(gaugePercent(-5, 0, 100)).toBe(0);
    expect(gaugePercent(150, 0, 100)).toBe(100);
    expect(gaugePercent(5, 10, 10)).toBe(0);
  });
});

describe("sparkPoints", () => {
  it("maps values to a polyline string across width/height", () => {
    const pts = sparkPoints([0, 5, 10], 100, 40);
    expect(pts).toBe("0,40 50,20 100,0");
  });
  it("returns empty string for <2 values", () => {
    expect(sparkPoints([1], 100, 40)).toBe("");
    expect(sparkPoints([], 100, 40)).toBe("");
  });
  it("flat series renders along the bottom", () => {
    expect(sparkPoints([7, 7, 7], 100, 40)).toBe("0,40 50,40 100,40");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- geometry`
Expected: FAIL — `./geometry` cannot be resolved.

- [ ] **Step 3: Implement `src/design/geometry.ts`**

```ts
/** Clamp a value into 0..100 percent across [min,max]; 0 when span is non-positive. */
export function gaugePercent(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return 0;
  const pct = ((value - min) / span) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** SVG polyline points spanning [0,width]x[0,height]; higher value = higher (smaller y). */
export function sparkPoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const stepX = width / (values.length - 1);
  return values
    .map((v, i) => {
      const x = Math.round(i * stepX);
      const y = span === 0 ? height : Math.round(height - ((v - lo) / span) * height);
      return `${x},${y}`;
    })
    .join(" ");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- geometry`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/design/geometry.ts src/design/geometry.test.ts
git commit -m "feat(design): pure gauge + sparkline geometry helpers"
```

---

## Task 4: Extract `<Icon>` into `src/design/Icon.tsx`

**Files:**
- Create: `src/design/Icon.tsx`
- Reference: `src/App.tsx:179-200` (existing `ICONS` map + `Icon` component — copy, don't yet delete)

- [ ] **Step 1: Create `src/design/Icon.tsx`** (move the existing inline icon set here and add status icons `check`, `alert`, `shield`)

```tsx
import type { ReactNode } from "react";

export const ICONS: Record<string, ReactNode> = {
  grid: (<><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></>),
  shield: (<><path d="M12 3l7 2.5v5.5c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V5.5L12 3z" /><path d="M9 12l2 2 4-4" /></>),
  target: (<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.4" /></>),
  pulse: (<path d="M3 12h4l2-6 4 12 2-6h6" />),
  chart: (<><line x1="4" y1="20" x2="20" y2="20" /><rect x="5.5" y="11" width="3" height="7" /><rect x="10.5" y="7" width="3" height="11" /><rect x="15.5" y="13" width="3" height="5" /></>),
  ledger: (<><rect x="5" y="3" width="14" height="18" rx="2" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" /></>),
  check: (<path d="M5 12l5 5 9-9" />),
  alert: (<><path d="M12 8v5" /><path d="M12 16h.01" /><circle cx="12" cy="12" r="9" /></>),
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}
```

- [ ] **Step 2: Render-smoke test `src/design/Icon.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Icon } from "./Icon";

describe("Icon", () => {
  it("renders an svg for a known name", () => {
    const { container } = render(<Icon name="check" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run + verify**

Run: `npm test -- Icon`
Expected: PASS — 1 test.

- [ ] **Step 4: Commit**

```bash
git add src/design/Icon.tsx src/design/Icon.test.tsx
git commit -m "feat(design): extract Icon set into design module + status glyphs"
```

---

## Task 5: `<StatusPill>` (render-smoke)

**Files:**
- Create: `src/design/StatusPill.tsx`, `src/design/StatusPill.test.tsx`, `src/design/StatusPill.css`

- [ ] **Step 1: Create `src/design/StatusPill.css`**

```css
.ds-pill{display:inline-flex;align-items:center;gap:6px;border-radius:var(--r-pill);
  padding:3px 10px;font-size:12px;font-weight:600;border:1px solid var(--lineVar,var(--border-strong));
  color:var(--colorVar,var(--fg-2));background:var(--softVar,var(--panel-2));}
.ds-pill .ds-dot{width:7px;height:7px;border-radius:50%;background:var(--colorVar,var(--muted));}
.ds-pill.is-scanning .ds-dot{animation:ds-pulse 1.1s var(--ease) infinite;}
@keyframes ds-pulse{50%{opacity:.3}}
```

- [ ] **Step 2: Create `src/design/StatusPill.tsx`**

```tsx
import "./StatusPill.css";
import { statusMeta, type Status } from "./status";

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const m = statusMeta(status);
  const style = {
    ["--colorVar" as string]: m.colorVar,
    ["--softVar" as string]: m.softVar,
    ["--lineVar" as string]: m.lineVar,
  } as React.CSSProperties;
  return (
    <span className={`ds-pill is-${status}`} style={style}>
      <span className="ds-dot" />
      {label ?? m.label}
    </span>
  );
}
```

- [ ] **Step 3: Test `src/design/StatusPill.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("shows the status label by default", () => {
    render(<StatusPill status="ready" />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
  it("respects a custom label", () => {
    render(<StatusPill status="attention" label="1 to review" />);
    expect(screen.getByText("1 to review")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run + verify**

Run: `npm test -- StatusPill`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/design/StatusPill.tsx src/design/StatusPill.test.tsx src/design/StatusPill.css
git commit -m "feat(design): StatusPill primitive"
```

---

## Task 6: `<Card>`, `<Panel>`, `<SectionHeader>`

**Files:**
- Create: `src/design/Card.tsx`, `src/design/Card.css`, `src/design/Card.test.tsx`

- [ ] **Step 1: Create `src/design/Card.css`**

```css
.ds-card{border:1px solid var(--border);border-radius:var(--r);background:var(--panel);
  padding:16px 17px;box-shadow:var(--edge),var(--shadow-1);
  transition:transform var(--dur) var(--ease),border-color var(--dur) var(--ease);}
.ds-card.is-interactive:hover{transform:translateY(var(--lift-hover));border-color:var(--border-strong);}
.ds-card.is-interactive:active{transform:var(--press);}
.ds-panel{border:1px solid var(--hairline);border-radius:var(--r-sm);background:var(--panel-2);padding:12px 13px;}
.ds-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.ds-section-head h3{margin:0;font-size:14px;}
```

- [ ] **Step 2: Create `src/design/Card.tsx`**

```tsx
import "./Card.css";
import type { ReactNode } from "react";

export function Card({ children, interactive, className = "" }: { children: ReactNode; interactive?: boolean; className?: string }) {
  return <div className={`ds-card ${interactive ? "is-interactive" : ""} ${className}`}>{children}</div>;
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`ds-panel ${className}`}>{children}</div>;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="ds-section-head">
      <h3>{title}</h3>
      {right}
    </div>
  );
}
```

- [ ] **Step 3: Test `src/design/Card.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card, SectionHeader } from "./Card";

describe("Card / SectionHeader", () => {
  it("renders children and a section title", () => {
    render(<Card><SectionHeader title="Readiness" /></Card>);
    expect(screen.getByText("Readiness")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run + verify**

Run: `npm test -- Card`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/design/Card.tsx src/design/Card.css src/design/Card.test.tsx
git commit -m "feat(design): Card / Panel / SectionHeader primitives"
```

---

## Task 7: `<Stat>`

**Files:**
- Create: `src/design/Stat.tsx`, `src/design/Stat.css`, `src/design/Stat.test.tsx`

- [ ] **Step 1: Create `src/design/Stat.css`**

```css
.ds-stat{display:flex;flex-direction:column;gap:2px;}
.ds-stat .ds-v{font-family:var(--font-mono);font-size:26px;font-weight:600;letter-spacing:-.02em;}
.ds-stat .ds-v .ds-u{font-size:13px;color:var(--muted);font-weight:500;margin-left:3px;}
.ds-stat .ds-l{color:var(--faint);font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;}
.ds-stat .ds-v.tone-ready{color:var(--status-ready);}
.ds-stat .ds-v.tone-attention{color:var(--status-attention);}
```

- [ ] **Step 2: Create `src/design/Stat.tsx`**

```tsx
import "./Stat.css";

export function Stat({ value, unit, label, tone }: { value: string; unit?: string; label: string; tone?: "ready" | "attention" }) {
  return (
    <div className="ds-stat">
      <span className={`ds-v ${tone ? `tone-${tone}` : ""}`}>
        {value}{unit ? <span className="ds-u">{unit}</span> : null}
      </span>
      <span className="ds-l">{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: Test `src/design/Stat.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders value, unit, and label", () => {
    render(<Stat value="142" unit="fps" label="Average" />);
    expect(screen.getByText("142")).toBeInTheDocument();
    expect(screen.getByText("fps")).toBeInTheDocument();
    expect(screen.getByText("Average")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run + verify**

Run: `npm test -- Stat`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/design/Stat.tsx src/design/Stat.css src/design/Stat.test.tsx
git commit -m "feat(design): Stat primitive"
```

---

## Task 8: `<Gauge>` (radial readout, uses `gaugePercent`)

**Files:**
- Create: `src/design/Gauge.tsx`, `src/design/Gauge.css`, `src/design/Gauge.test.tsx`

- [ ] **Step 1: Create `src/design/Gauge.css`**

```css
.ds-gauge{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 8px;
  border-radius:var(--r);background:var(--panel-2);border:1px solid var(--hairline);}
.ds-gauge .ds-dialwrap{position:relative;width:92px;height:92px;display:grid;place-items:center;}
.ds-gauge .ds-dial{width:92px;height:92px;border-radius:50%;
  background:conic-gradient(var(--gc,var(--accent)) calc(var(--p,0)*1%),var(--panel-3) 0);
  -webkit-mask:radial-gradient(circle 31px at 50% 50%,transparent 98%,#000 100%);
  mask:radial-gradient(circle 31px at 50% 50%,transparent 98%,#000 100%);
  transition:background var(--dur-slow) var(--ease);}
.ds-gauge .ds-dialval{position:absolute;font-family:var(--font-mono);font-size:18px;font-weight:600;}
.ds-gauge .ds-dialval .ds-u{font-size:10px;color:var(--muted);}
.ds-gauge .ds-gl{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.07em;}
```

- [ ] **Step 2: Create `src/design/Gauge.tsx`**

```tsx
import "./Gauge.css";
import { gaugePercent } from "./geometry";

export function Gauge({ value, min = 0, max = 100, display, unit, label, colorVar = "var(--accent)" }:
  { value: number; min?: number; max?: number; display?: string; unit?: string; label: string; colorVar?: string }) {
  const p = gaugePercent(value, min, max);
  const style = { ["--p" as string]: String(p), ["--gc" as string]: colorVar } as React.CSSProperties;
  return (
    <div className="ds-gauge">
      <div className="ds-dialwrap">
        <div className="ds-dial" style={style} />
        <span className="ds-dialval">{display ?? value}{unit ? <span className="ds-u">{unit}</span> : null}</span>
      </div>
      <span className="ds-gl">{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: Test `src/design/Gauge.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Gauge } from "./Gauge";

describe("Gauge", () => {
  it("renders the label and the display value", () => {
    render(<Gauge value={61} display="61" unit="°C" label="GPU temp" />);
    expect(screen.getByText("GPU temp")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run + verify**

Run: `npm test -- Gauge`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/design/Gauge.tsx src/design/Gauge.css src/design/Gauge.test.tsx
git commit -m "feat(design): Gauge instrument primitive"
```

---

## Task 9: `<Sparkline>` (uses `sparkPoints`)

**Files:**
- Create: `src/design/Sparkline.tsx`, `src/design/Sparkline.test.tsx`

- [ ] **Step 1: Create `src/design/Sparkline.tsx`**

```tsx
import { sparkPoints } from "./geometry";

export function Sparkline({ values, width = 320, height = 42, stroke = "var(--accent)" }:
  { values: number[]; width?: number; height?: number; stroke?: string }) {
  const pts = sparkPoints(values, width, height);
  return (
    <svg className="ds-spark" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="trend">
      {pts ? <polyline fill="none" stroke={stroke} strokeWidth="2" points={pts} /> : null}
    </svg>
  );
}
```

- [ ] **Step 2: Test `src/design/Sparkline.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

describe("Sparkline", () => {
  it("draws a polyline for >=2 values", () => {
    const { container } = render(<Sparkline values={[1, 5, 3, 8]} />);
    expect(container.querySelector("polyline")).toBeInTheDocument();
  });
  it("draws nothing for a single value", () => {
    const { container } = render(<Sparkline values={[1]} />);
    expect(container.querySelector("polyline")).toBeNull();
  });
});
```

- [ ] **Step 3: Run + verify**

Run: `npm test -- Sparkline`
Expected: PASS — 2 tests.

- [ ] **Step 4: Commit**

```bash
git add src/design/Sparkline.tsx src/design/Sparkline.test.tsx
git commit -m "feat(design): Sparkline primitive"
```

---

## Task 10: `<TrustCue>` and `<EmptyState>`

**Files:**
- Create: `src/design/TrustCue.tsx`, `src/design/EmptyState.tsx`, shared `src/design/cues.css`, tests.

- [ ] **Step 1: Create `src/design/cues.css`**

```css
.ds-trust{display:flex;align-items:center;gap:13px;padding:14px 16px;border-radius:var(--r);
  border:1px solid var(--accent-line);background:linear-gradient(180deg,var(--accent-soft),transparent);}
.ds-trust .ds-shield{color:var(--accent-bright);}
.ds-trust b{font-size:14px;}
.ds-trust .ds-sub{color:var(--muted);font-size:12.5px;}
.ds-empty{text-align:center;padding:34px 20px;color:var(--muted);}
.ds-empty .ds-eicon{color:var(--faint);margin-bottom:10px;}
.ds-empty b{display:block;color:var(--fg-2);font-size:15px;margin-bottom:4px;}
```

- [ ] **Step 2: Create `src/design/TrustCue.tsx`**

```tsx
import "./cues.css";
import { Icon } from "./Icon";

export function TrustCue({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="ds-trust">
      <span className="ds-shield"><Icon name="shield" size={30} /></span>
      <div><b>{title}</b><div className="ds-sub">{detail}</div></div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/design/EmptyState.tsx`**

```tsx
import "./cues.css";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

export function EmptyState({ icon, title, children, action }:
  { icon: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <span className="ds-eicon"><Icon name={icon} size={42} /></span>
      <b>{title}</b>
      {children}
      {action ? <div style={{ marginTop: 14 }}>{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 4: Test `src/design/cues.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustCue } from "./TrustCue";
import { EmptyState } from "./EmptyState";

describe("TrustCue / EmptyState", () => {
  it("TrustCue shows title + detail", () => {
    render(<TrustCue title="You're protected" detail="4 changes, all reversible." />);
    expect(screen.getByText("You're protected")).toBeInTheDocument();
  });
  it("EmptyState shows its title", () => {
    render(<EmptyState icon="chart" title="No sessions yet" />);
    expect(screen.getByText("No sessions yet")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run + verify**

Run: `npm test -- cues`
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/design/TrustCue.tsx src/design/EmptyState.tsx src/design/cues.css src/design/cues.test.tsx
git commit -m "feat(design): TrustCue + EmptyState primitives"
```

---

## Task 11: Barrel export + dev Gallery

**Files:**
- Create: `src/design/index.ts`, `src/design/Gallery.tsx`

- [ ] **Step 1: Create `src/design/index.ts`**

```ts
export { Icon, ICONS } from "./Icon";
export { StatusPill } from "./StatusPill";
export { Card, Panel, SectionHeader } from "./Card";
export { Stat } from "./Stat";
export { Gauge } from "./Gauge";
export { Sparkline } from "./Sparkline";
export { TrustCue } from "./TrustCue";
export { EmptyState } from "./EmptyState";
export { statusMeta } from "./status";
export type { Status, StatusMeta } from "./status";
export { gaugePercent, sparkPoints } from "./geometry";
```

- [ ] **Step 2: Create `src/design/Gallery.tsx`** (visual verification surface — one of every primitive)

```tsx
import { Card, SectionHeader, StatusPill, Stat, Gauge, Sparkline, TrustCue, EmptyState } from "./index";

export function Gallery() {
  return (
    <div style={{ display: "grid", gap: 16, padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <Card>
        <SectionHeader title="Status vocabulary" />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status="ready" /><StatusPill status="attention" />
          <StatusPill status="protected" /><StatusPill status="scanning" /><StatusPill status="unknown" />
        </div>
      </Card>
      <Card>
        <SectionHeader title="Stats" />
        <div style={{ display: "flex", gap: 24 }}>
          <Stat value="142" unit="fps" label="Average" tone="ready" />
          <Stat value="7.0" unit="ms" label="Frametime" />
          <Stat value="98" unit="fps" label="1% low · estimate" />
        </div>
      </Card>
      <Card>
        <SectionHeader title="Instrument cluster" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          <Gauge value={61} display="61" unit="°C" label="GPU temp" colorVar="var(--ready)" />
          <Gauge value={84} display="84" unit="%" label="GPU usage" />
          <Gauge value={47} display="47" unit="%" label="Fan" />
          <Gauge value={66} display="214" unit="W" label="Power" colorVar="var(--attention)" />
        </div>
        <Sparkline values={[30, 28, 31, 22, 26, 18, 24, 16, 20, 14, 22, 12]} />
      </Card>
      <Card><TrustCue title="You're protected" detail="4 changes active — all reversible from the Ledger." /></Card>
      <Card>
        <EmptyState icon="chart" title="No sessions yet">
          Play a game with monitoring on and Sentinel will write a debrief here.
        </EmptyState>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify the build compiles the new module**

Run: `npm run build`
Expected: `tsc` clean (no unused/type errors), `vite build` succeeds.

- [ ] **Step 4: (Optional) Temporarily mount the gallery to eyeball it**

In `src/main.tsx`, behind a dev check, render `<Gallery/>` instead of `<App/>` when
`import.meta.env.DEV && location.hash === "#gallery"`. Launch `npm run tauri dev`, open `#gallery`,
confirm every primitive renders on the graphite theme. **Revert this mount before committing** (the
gallery ships as a component but is not wired into the app in this plan).

- [ ] **Step 5: Commit**

```bash
git add src/design/index.ts src/design/Gallery.tsx
git commit -m "feat(design): barrel export + dev primitives gallery"
```

---

## Task 12: Final verification of the foundation

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: PASS — all suites green (toolchain, status×4, geometry×5, + render-smoke for Icon/StatusPill/Card/Stat/Gauge/Sparkline/cues).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: `tsc` clean + `vite build` success.

- [ ] **Step 3: App unchanged**

Run: `npm run tauri dev`; confirm the existing app renders and behaves exactly as before (this plan
added a parallel module + additive tokens; it did not modify any surface). No new outbound network.

- [ ] **Step 4: Confirm no `src-tauri/` changes**

Run: `git diff --stat 16069fa..HEAD -- src-tauri/`
Expected: empty — this plan is frontend-only; Rust/backend untouched; beta refs untouched.

---

## Self-Review

**Spec coverage (this sub-project = spec §3.1 + the substrate for §3.4/§3.6):** tokens (Task 1),
primitives Card/Panel/SectionHeader (6), StatusPill (5), Stat (7), Gauge (8), Sparkline (9),
TrustCue + EmptyState (10), Icon + status glyphs (4), status-language vocabulary via `statusMeta`
(2). Items deferred to later (decision-gated) sub-projects, by design: SystemPosture/dashboard
(§3.2–3.3 = spec #3, Decision A), App.tsx decomposition (§3.8 = #2, Decision B), per-surface feel
passes (§3.4 = #4), motion polish across surfaces (§3.5 = #5), gamification reconciliation (§4 = #6,
Decision A), modes (§3.7 = #7, Decision D), theme curation (Decision C).

**Placeholder scan:** none — every code step has complete code; the only "fill-in" is the optional,
explicitly-reverted dev mount in Task 11 Step 4.

**Type consistency:** `Status` (status.ts) is the single status union used by `statusMeta` and
`StatusPill`. `gaugePercent`/`sparkPoints` signatures in geometry.ts match their use in Gauge.tsx /
Sparkline.tsx. `Icon({name,size})` matches all callers. Barrel re-exports match each module's
exports.

---

## Execution Handoff

**This plan is HELD pending owner approval** (spec Decision E + product-code lock). It is the
decision-independent foundation; the remaining sub-projects (#2–#7) will each get their own plan
**after** Decisions A–F are made, since those decisions reshape their tasks.

When approved, two execution options:
1. **Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks.
2. **Inline Execution** — batch execution in-session with checkpoints.
