import type { RecDisplayLabel } from "../data/friendly-labels";
import "./RecName.css";

// The name of a tweak, rendered the ONE way Compy renders it: the plain-language headline the user
// reads, with the real technical name kept quiet-but-visible beside it (owner-picked voice, see
// data/friendly-labels). A fragment on purpose — the caller owns the wrapper element and its
// typography, so a row headline, a card title and a banner line can look different while SAYING the
// same thing.
//
// Callers must resolve the label through data/friendly-labels (recDisplayLabel / rowDisplayLabel),
// never build one by hand: that shared resolver is what keeps one rec from having two names across
// the Check → Lab journey (self-review rounds 1 and 3, 2026-07-28).
// The plain path renders a BARE string on purpose: with friendly labels off (the default, and what
// jsdom sees) the DOM is byte-identical to what these surfaces rendered before — no wrapper element
// for existing queries to match twice.
export function RecNameText({ label }: { label: RecDisplayLabel }) {
  if (!label.friendly || !label.tech) return <>{label.headline}</>;
  return (
    <>
      <span className="rec-name-head">{label.headline}</span>
      <span className="rec-name-tech">{label.tech}</span>
    </>
  );
}
