// Latest-wins for an async flow that can run again before it settles (CR-1102-left: App.refresh).
// `begin()` starts a new run and hands back `isCurrent`, which stays true only until the next
// `begin()`. A slow read from an older run then can't land over a newer run's answer, and its late
// error can't re-raise a toast the newer run already cleared.
export function createGenerations(): { begin: () => () => boolean } {
  let generation = 0;
  return {
    begin() {
      const mine = ++generation;
      return () => mine === generation;
    },
  };
}
