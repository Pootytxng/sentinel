// The bento system's public surface. Rooms import from "../design/bento" and never reach into
// the individual files, so the internals (which element carries the stretched hit target, how the
// sheet measures its origin) stay free to change without touching every room.
export { BentoGrid, BentoTile } from "./BentoGrid";
export type { BentoSpan, BentoTone, BentoTileProps } from "./BentoGrid";
export { Sheet, useSheet } from "./Sheet";
export type { SheetProps } from "./Sheet";
