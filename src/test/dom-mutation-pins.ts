// The runtime DOM writes the frontend is allowed to make, pinned by file and name. Read by
// src/dom-mutation-census.test.ts (which proves, with the TypeScript checker, that these are the only
// ones) and by src/surfaces/hc-specs-grid-overflow-guard.test.ts (which proves none of them can size a
// Detected-tile spec card). A new write is a visible review change in this file, with its reason.

/** `.classList.add("name")` / `.remove("name")` literals, per file. */
export const CLASS_WRITES = new Map<string, string[]>([
  ["src/design/console/ReticleCursor.tsx", ["lc-has-reticle"]], // the reticle's scope element
  ["src/main.tsx", ["overlay-mode"]], // document.documentElement
  ["src/surfaces/Learn.tsx", ["lx-flash"]], // a Learn entry it holds by ref
]);

/** `.dataset.name =` and `delete .dataset.name`, per file (camelCase, as written). */
export const DATA_WRITES = new Map<string, string[]>([
  ["src/design/bento/Sheet.tsx", ["sheet"]], // document.documentElement while a sheet is open
  ["src/design/theme.ts", ["dashV2", "hearthSeason", "hud", "itheme", "living", "roomIdentity"]], // document.documentElement
  ["src/design/use-motion.ts", ["jarvis", "motion"]], // document.documentElement
  ["src/main.tsx", ["customChrome", "dashV2", "hearthSeason", "hud", "itheme", "living", "roomIdentity", "v2"]], // document.documentElement
]);

/** Every other write the census records, one line per `file iface.kind name on receiver`. */
export const DOM_WRITES: string[] = [
  // Element property writes. None names className, id (but the pinned stylesheet element), innerHTML
  // or outerHTML; the census bans those spellings outright.
  "src/design/ShellV2.tsx Element.write scrollTop on lane",
  "src/design/jarvis/LenisSpine.tsx Element.write scrollTop on wrapper",
  "src/design/theme.ts Element.write id on el", // the runtime accent stylesheet, ROOM_ACCENTS_STYLE_ID
  "src/design/theme.ts Element.write textContent on el", // its CSS text, pinned whole by the census
  "src/design/vendor/CountUp/CountUp.tsx Element.write textContent on ref.current",
  "src/design/vendor/ElectricBorder/ElectricBorder.tsx Element.write height on canvas", // its own <canvas> bitmap
  "src/design/vendor/ElectricBorder/ElectricBorder.tsx Element.write width on canvas",
  "src/i18n/language.ts Element.write lang on document.documentElement",
  "src/main.tsx Element.write lang on document.documentElement",
  "src/surfaces/LabConsole.tsx Element.write scrollTop on scroller",
  "src/surfaces/monitor/SessionStack.tsx Element.write height on canvas", // its own <canvas> bitmap
  "src/surfaces/monitor/SessionStack.tsx Element.write width on canvas",
  "src/test/setup.ts Element.write scrollIntoView on HTMLElement.prototype", // jsdom lacks it
  // Inline style writes: paint only, except ElectricBorder sizing its own <canvas>.
  "src/design/bento/Sheet.tsx CSSStyleDeclaration.write opacity on panel.style",
  "src/design/bento/Sheet.tsx CSSStyleDeclaration.write transform on panel.style",
  "src/design/bento/Sheet.tsx CSSStyleDeclaration.write transition on panel.style",
  "src/design/console/ReticleCursor.tsx CSSStyleDeclaration.write opacity on el.style",
  "src/design/console/ReticleCursor.tsx CSSStyleDeclaration.write transform on el.style",
  "src/design/vendor/ElectricBorder/ElectricBorder.tsx CSSStyleDeclaration.write height on canvas.style",
  "src/design/vendor/ElectricBorder/ElectricBorder.tsx CSSStyleDeclaration.write width on canvas.style",
  "src/surfaces/rig/RigFan.tsx CSSStyleDeclaration.write cursor on document.body.style",
  "src/surfaces/rig/RigPart.tsx CSSStyleDeclaration.write cursor on document.body.style",
  // setProperty: custom properties only (a `--` literal), which no card layout value reads.
  "src/design/vendor/SpotlightCard/SpotlightCard.tsx CSSStyleDeclaration.setProperty --mouse-x on divRef.current.style",
  "src/design/vendor/SpotlightCard/SpotlightCard.tsx CSSStyleDeclaration.setProperty --mouse-y on divRef.current.style",
  "src/design/vendor/SpotlightCard/SpotlightCard.tsx CSSStyleDeclaration.setProperty --spotlight-color on divRef.current.style",
  "src/surfaces/HomeConsole.tsx CSSStyleDeclaration.setProperty --glow-intensity on stage.style",
  "src/surfaces/HomeConsole.tsx CSSStyleDeclaration.setProperty --glow-x on stage.style",
  "src/surfaces/HomeConsole.tsx CSSStyleDeclaration.setProperty --glow-y on stage.style",
  "src/surfaces/HomeConsole.tsx CSSStyleDeclaration.setProperty --hc-px on el.style",
  "src/surfaces/HomeConsole.tsx CSSStyleDeclaration.setProperty --hc-py on el.style",
  "src/surfaces/HomeHud.tsx CSSStyleDeclaration.setProperty --hud-px on el.style",
  "src/surfaces/HomeHud.tsx CSSStyleDeclaration.setProperty --hud-py on el.style",
  "src/surfaces/LabConsole.tsx CSSStyleDeclaration.setProperty --glow-intensity on stage.style",
  "src/surfaces/LabConsole.tsx CSSStyleDeclaration.setProperty --glow-x on stage.style",
  "src/surfaces/LabConsole.tsx CSSStyleDeclaration.setProperty --glow-y on stage.style",
  "src/surfaces/MonitorConsole.tsx CSSStyleDeclaration.setProperty --glow-intensity on stage.style",
  "src/surfaces/MonitorConsole.tsx CSSStyleDeclaration.setProperty --glow-x on stage.style",
  "src/surfaces/MonitorConsole.tsx CSSStyleDeclaration.setProperty --glow-y on stage.style",
  "src/surfaces/MonitorConsole.tsx CSSStyleDeclaration.setProperty --tilt-x on stage.style",
  "src/surfaces/MonitorConsole.tsx CSSStyleDeclaration.setProperty --tilt-y on stage.style",
  // Elements created at runtime, and the tree rewritten: the one runtime stylesheet, into <head> and out.
  "src/design/theme.ts Document.createElement style on document",
  "src/design/theme.ts Element.call appendChild on document.head",
  "src/design/theme.ts Element.call remove on el",
];
