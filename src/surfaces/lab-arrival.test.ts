import { afterEach, describe, expect, it } from "vitest";
import {
  BENCH_ARRIVAL_KEY,
  markBenchArrival,
  markSinceArrival,
  takeBenchArrival,
  takeSinceArrival,
} from "./lab-arrival";

// P7-route: an arrival is one-shot. It is read once by the view it names and never fires on a
// later visit, and a value it does not recognise is not an arrival.
describe("lab arrivals are one-shot", () => {
  afterEach(() => localStorage.clear());

  it("the bench arrival is read once", () => {
    markBenchArrival("tested");
    expect(takeBenchArrival()).toBe("tested");
    expect(takeBenchArrival()).toBeNull();
  });

  it("a value it does not recognise is not an arrival, and is still cleared", () => {
    localStorage.setItem(BENCH_ARRIVAL_KEY, "elsewhere");
    expect(takeBenchArrival()).toBeNull();
    expect(localStorage.getItem(BENCH_ARRIVAL_KEY)).toBeNull();
  });

  it("the since arrival is read once", () => {
    expect(takeSinceArrival()).toBe(false);
    markSinceArrival();
    expect(takeSinceArrival()).toBe(true);
    expect(takeSinceArrival()).toBe(false);
  });
});
