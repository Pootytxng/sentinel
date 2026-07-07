// Fan-sensor poll state helper for the hologram bay. The poll fires every 2.5s and always
// yields a FRESH array; if that reference reaches setState unchecked, the canvas tree
// re-renders, r3f commits referentially-new props and auto-invalidates — a repaint burst per
// poll even while the bay is at rest (the T1.5 idle pulse/hitch). Content-equal polls MUST
// return the previous reference so React bails and the demand-mode canvas stays asleep;
// only a real sensor change (rpm/label/source/count) may produce a new reference.

export interface FanSensor {
  label: string;
  rpm: number;
  source: string;
}

export function nextFanSensors(prev: FanSensor[] | null, incoming: FanSensor[]): FanSensor[] {
  if (
    prev &&
    prev.length === incoming.length &&
    prev.every(
      (p, i) =>
        p.label === incoming[i].label && p.rpm === incoming[i].rpm && p.source === incoming[i].source,
    )
  ) {
    return prev;
  }
  return incoming;
}
