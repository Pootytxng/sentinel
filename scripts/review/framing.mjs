// The framing predicate — the H7 guard, extracted so it can be TESTED rather than trusted.
//
// WHY THIS EXISTS (bug→guard, consumer panel round 3, 2026-07-29/30). The LabDeck capture harness
// had a real defect that two independent panel seats caught: the `c3-row-compare` capture asserted
// that the comparison-evidence body existed **in the DOM**, passed on that basis, and then shot the
// frame at a hand-picked scroll position that actually framed the Optimize list. The comparison
// layer therefore went to the consumer panel unreviewed while the evidence record claimed it had
// been captured.
//
// The lesson is one sentence: **a DOM assertion is not a framing assertion.** `querySelector()`
// returning a node proves the element exists; it proves nothing about whether its pixels are inside
// the rectangle the screenshot recorded. Any capture that is ABOUT an element must prove the
// element's pixels were in the viewport at the moment the shutter fired.
//
// The predicate lives here, pure and DOM-free, so `framing.test.mjs` can pin its behaviour —
// including the exact H7 geometry — without a browser. The harness imports it and evaluates the
// same rule in-page.
//
// @typedef {{top:number,height:number,viewportHeight:number,minVisible?:number}} FramingInput

/**
 * Decide whether an element's box is genuinely framed by the viewport.
 *
 * `top` is viewport-relative (i.e. `getBoundingClientRect().top`), so a negative `top` means the
 * element has been scrolled off the top edge — the precise H7 condition.
 *
 * A tall element does not have to be fully visible: `minVisible` CSS pixels of it is enough to call
 * it framed. A short element must be fully visible, because "160px of a 40px row" is unsatisfiable
 * — hence `required = min(height, minVisible)`.
 *
 * @param {FramingInput} input
 * @returns {{framed:boolean, visible:number, required:number, reason:string}}
 */
export function framingVerdict({ top, height, viewportHeight, minVisible = 160 }) {
  // A zero-height (or negative-height) box is never framed. Without this branch the arithmetic
  // below computes required = min(0, minVisible) = 0 and visible = 0, and `0 >= 0` would report a
  // collapsed / display:none-collapsed / not-yet-laid-out element as perfectly framed — the same
  // class of false PASS as H7 itself, just arriving through the geometry instead of the DOM.
  if (!(height > 0)) {
    return { framed: false, visible: 0, required: 0, reason: "zero-height box" };
  }
  if (!(viewportHeight > 0)) {
    return { framed: false, visible: 0, required: 0, reason: "zero-height viewport" };
  }
  const visible = Math.max(0, Math.min(top + height, viewportHeight) - Math.max(top, 0));
  const required = Math.min(height, minVisible);
  if (visible <= 0) {
    return {
      framed: false,
      visible: 0,
      required,
      reason: top < 0 ? "scrolled off the top edge" : "below the bottom edge",
    };
  }
  if (visible < required) {
    return { framed: false, visible, required, reason: "only partially in frame" };
  }
  return { framed: true, visible, required, reason: "framed" };
}
