import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { afterEach } from "vitest";
import { invalidateProbe } from "../data/probe-cache";

// vitest.config.ts budgets a test at 15s because heavy render tests really do take 5-7s under
// full-suite contention. testing-library keeps its OWN clock for findBy*/waitFor and it defaults to
// 1s — so a test permitted 15s gives up looking for its element after one. That gap is the whole
// defect: on 2026-08-11 a single `findByRole` in optimize-v2-ia.test.tsx failed an otherwise green
// pre-push gate and passed in isolation, because findByRole recomputes the accessibility tree on
// every retry and 1s of a loaded machine is not 1s of an idle one.
//
// This is a BUDGET, not a retry. The config above refuses `retry` on purpose — retries hide a
// defect by running it again. Raising a deadline that was never deliberately chosen hides nothing:
// an element that is genuinely absent is still absent at 5s, and the test still fails, with the
// same message. What it stops is a PASSING assertion being reported as a failure because the CPU
// was busy. Deliberately below vitest's 15s so a real hang still surfaces as the assertion that
// hung, not as an opaque file-level timeout.
configure({ asyncUtilTimeout: 5000 });

// The probe cache (src/data/probe-cache.ts) is module-level and intentionally survives component
// unmounts in production (instant tab re-visits). In tests that means one test's cached probe value
// would leak into the next mount — so reset it between tests for isolation.
afterEach(() => invalidateProbe());

// Node-environment test files (e.g. scripts/export-library.test.mjs, which must run vite/esbuild
// outside jsdom) have no DOM at all — the stubs below are jsdom-only.
if (typeof window !== "undefined") {
  // jsdom doesn't implement scrollIntoView; stub it so components that reveal/scroll don't throw in tests.
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }

  // jsdom doesn't implement matchMedia; stub it (no match) so motion guards don't throw.
  if (!window.matchMedia) {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
}
