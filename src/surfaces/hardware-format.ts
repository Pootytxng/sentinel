// Shared hardware-value formatters. Used by the App monitoring tabs AND the shared HardwareGrid
// (which renders in both the classic Overview and the CommandCenter Home). Kept here, dependency-
// free, so HardwareGrid can reuse them without a runtime import cycle back into App.tsx.

export const fmtGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
export const fmtGHz = (mhz: number) => (mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : "—");
