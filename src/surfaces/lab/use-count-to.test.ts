import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCountTo } from "./use-count-to";

// Guards for the honesty-bound count-up (spec 2026-07-09 Phase 1, Task 4). The hook is the
// mechanism that keeps "living data" honest: null in ⇒ null out (render nothing, never a
// placeholder that animates); reduced ⇒ snap; a real target is reachable.

describe("useCountTo — honesty-bound numeric tween", () => {
  it("target null ⇒ returns null (no measured source → render nothing)", () => {
    const { result } = renderHook(() => useCountTo(null, { reduced: false }));
    expect(result.current).toBeNull();
  });

  it("reduced ⇒ snaps to the target immediately (no intermediate frame)", () => {
    const { result } = renderHook(() => useCountTo(7, { reduced: true }));
    expect(result.current).toBe(7);
  });

  it("a real target is reachable (the tween lands exactly on it)", async () => {
    const { result } = renderHook(() => useCountTo(5, { reduced: false }));
    await waitFor(() => expect(result.current).toBe(5), { timeout: 3000 });
  });

  it("null after a real target ⇒ returns to null (the gauge disappears honestly)", () => {
    const { result, rerender } = renderHook(
      ({ t }: { t: number | null }) => useCountTo(t, { reduced: true }),
      { initialProps: { t: 3 as number | null } },
    );
    expect(result.current).toBe(3);
    rerender({ t: null });
    expect(result.current).toBeNull();
  });
});
