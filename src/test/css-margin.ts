// Shared by the layout reachability guards (issue #236): "does this declaration block give its
// subject an automatic LEFT margin?" — the property that pushes an element away from the content
// grid's left edge, which is the defect those guards exist to catch.
//
// THIS IS THE SHIPPED BEHAVIOUR, extracted verbatim from the two guards so it can be tested at all.
// Both of them asked the question the same way and both got it wrong the same way; `css-margin.test.ts`
// lands on this file RED. The correct box-model expansion replaces the bodies below.
//
// LTR only, which is what Compy ships. `margin-inline-start` is therefore read as the left margin.

/** Split a value on TOP-LEVEL whitespace: `calc(1px + 2px)` and `var(--a, 1px)` are ONE token. */
export function valueTokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth === 0 && /\s/.test(ch)) {
      if (buf) out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/** Shipped model: any `auto` token in the shorthand was treated as the left margin. */
export function marginShorthandLeft(value: string): string | null {
  const v = valueTokens(value);
  return v.find((t) => t.toLowerCase() === "auto") ?? v[v.length - 1] ?? null;
}

/** Shipped model: any `auto` token was treated as the inline start. */
export function marginInlineStart(value: string): string | null {
  const v = valueTokens(value);
  return v.find((t) => t.toLowerCase() === "auto") ?? v[0] ?? null;
}

/** Shipped model: the two regexes the guards carried inline, unchanged. */
export function leftMarginIsAuto(body: string): { auto: boolean; source: string | null } {
  const longhand = /margin(?:-left|-inline-start)\s*:\s*auto/.test(body);
  const shorthand = /margin\s*:\s*[^;]*\bauto\b/.test(
    body.replace(/margin-(top|right|bottom|left|inline-start|inline-end)\s*:[^;]*;?/g, ""),
  );
  const auto = longhand || shorthand;
  return { auto, source: auto ? body.trim() : null };
}
