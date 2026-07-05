import { useEffect, useState } from "react";
import { readEditorial } from "./theme";

// The compy_editorial flag as live React state (spec 2026-07-05-ui-deslop-organic-directive).
// Rooms use this to swap presentation-only details (serif masthead eyebrow, composed verdict
// instead of the decode scramble) the moment the Settings preview toggle flips — no reload.
// Flag off, every consumer renders its classic tree byte-identical (P-series contract).
export function useEditorialFlag(): boolean {
  const [on, setOn] = useState(readEditorial);
  useEffect(() => {
    const sync = () => setOn(readEditorial());
    window.addEventListener("compy:editorial-changed", sync);
    return () => window.removeEventListener("compy:editorial-changed", sync);
  }, []);
  return on;
}
