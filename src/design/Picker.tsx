import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "./use-motion";
import "./Picker.css";

// PICKER — the app's ONE dropdown, and the reason `<select>` is now banned from the UI
// (conformance C-10, audit §4).
//
// WHY A NATIVE `<select>` IS A DEFECT HERE, not a style preference. Its popup list is drawn by
// Windows, not by the page: it ignores every token in `instrument.css`, so on a near-black room it
// opens as a light-grey OS menu in a system font at a system size. The user is told, in the most
// literal way available, that they have left the app. That is the exact complaint the design
// foundation exists to answer ("overwhelming and completely unfamiliar"), and no amount of CSS on
// the closed control fixes it — the popup is out of the page's reach entirely.
//
// It is guarded: `src/design/no-raw-select-guard.test.ts` fails the build on a `<select>` anywhere
// under `src/`, so this cannot quietly come back one surface at a time (which is how it arrived).
//
// WHY IT PORTALS. Same reason as `bento/Sheet.tsx`: the list must escape every ancestor's
// `overflow`, and four of the five call sites sit inside a clipping card or a scroll pane. It is
// positioned `fixed` from the trigger's measured rect and flips above when there is no room below.
//
// ACCESSIBILITY — the ARIA APG "select-only combobox" pattern, deliberately, because it keeps DOM
// focus on the trigger for the whole interaction: the active option is carried by
// `aria-activedescendant` instead of by moving focus into the list. There is no focus to restore on
// close, so the class of bug where a dropdown closes and focus lands on `<body>` cannot happen.
// Full keyboard parity with the native control it replaces, typeahead included — a keyboard user
// must not pay for the visual fix.

export type PickerOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type PickerProps = {
  options: PickerOption[];
  /** The selected option's `value`. An empty string (or any value not in `options`) shows
   *  `placeholder` — the same state the native control's blank `<option>` used to carry. */
  value: string;
  onChange: (value: string) => void;
  /** Shown when `value` matches no option. */
  placeholder?: string;
  disabled?: boolean;
  /** Layout hook for the consumer (width, grid placement). Never a re-skin: the look is this file's. */
  className?: string;
  /** Accessible name. Required unless the control is wrapped in a `<label>`, in which case pass
   *  `labelledBy` instead — one of the two must be present or AT reads an unnamed combobox. */
  "aria-label"?: string;
  labelledBy?: string;
  /** Forwarded to the trigger so a `<label htmlFor>` can point at it. */
  id?: string;
};

/** Vertical gap between the trigger and its list, and the margin the list keeps off the viewport. */
const GAP = 6;
const EDGE = 8;
/** How long a run of typed characters counts as ONE typeahead query (native selects use ~1s). */
const TYPEAHEAD_MS = 1000;

export function Picker({
  options,
  value,
  onChange,
  placeholder = "",
  disabled = false,
  className,
  "aria-label": ariaLabel,
  labelledBy,
  id,
}: PickerProps) {
  const reduced = useReducedMotion();
  const autoId = useId();
  const listId = `pk-list-${autoId}`;
  const optionId = (i: number) => `pk-opt-${autoId}-${i}`;

  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; above: boolean } | null>(
    null,
  );

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // The first option a keyboard can land on, walking `step` from `from` (inclusive). Disabled
  // options are skipped rather than selectable-but-inert, matching the native control.
  const seek = useCallback(
    (from: number, step: number): number => {
      for (let i = from; i >= 0 && i < options.length; i += step) {
        if (!options[i].disabled) return i;
      }
      return -1;
    },
    [options],
  );

  const firstEnabled = useCallback(() => seek(0, 1), [seek]);
  const lastEnabled = useCallback(() => seek(options.length - 1, -1), [seek, options.length]);

  /** Measure the trigger and decide which side the list opens on. Called before paint on open, and
   *  again on scroll/resize while open, so the list never detaches from its trigger. */
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // The list is capped by CSS (max-height); measure the room on each side against that cap so the
    // flip decision matches what will actually be drawn.
    const cap = Math.min(320, window.innerHeight - 2 * EDGE);
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const flip = below < Math.min(cap, 160) && above > below;
    setRect({
      left: Math.max(EDGE, Math.min(r.left, window.innerWidth - r.width - EDGE)),
      top: flip ? r.top - GAP : r.bottom + GAP,
      width: r.width,
      above: flip,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScrollOrResize = () => place();
    // Capture phase: an ancestor scroll container's scroll does not bubble to window.
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [open, place]);

  // Dismiss on a pointer press anywhere that is neither the trigger nor the list. `pointerdown`
  // (not `click`) so the list is gone before the press lands on whatever is underneath.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  // Keep the active option in view — a 40-item list opened at a selection near the bottom must not
  // open scrolled to the top with the selection off-screen.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const openWith = (index: number) => {
    if (disabled) return;
    setActive(index >= 0 ? index : Math.max(firstEnabled(), 0));
    setOpen(true);
  };

  const commit = (index: number) => {
    const o = options[index];
    if (!o || o.disabled) return;
    setOpen(false);
    if (o.value !== value) onChange(o.value);
  };

  // ── typeahead: a run of printable characters jumps to the first option that starts with it ──
  const buf = useRef({ text: "", at: 0 });
  const typeahead = (ch: string) => {
    const now = Date.now();
    buf.current.text = now - buf.current.at > TYPEAHEAD_MS ? ch : buf.current.text + ch;
    buf.current.at = now;
    const q = buf.current.text.toLowerCase();
    const from = open ? active : selectedIndex;
    // Search forward from the current position and wrap, so repeating one letter cycles matches.
    for (let n = 1; n <= options.length; n++) {
      const i = (Math.max(from, 0) + n) % options.length;
      const o = options[i];
      if (!o.disabled && o.label.toLowerCase().startsWith(q)) {
        if (open) setActive(i);
        else commit(i);
        return;
      }
    }
    // A single repeated character also matches the option we are already on (native behaviour).
    if (from >= 0 && options[from] && !options[from].disabled && options[from].label.toLowerCase().startsWith(q)) {
      if (open) setActive(from);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const k = e.key;

    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " " || k === "Spacebar") {
        e.preventDefault();
        openWith(selectedIndex);
        return;
      }
      if (k === "Home") {
        e.preventDefault();
        openWith(firstEnabled());
        return;
      }
      if (k === "End") {
        e.preventDefault();
        openWith(lastEnabled());
        return;
      }
    } else {
      if (k === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (k === "Enter" || k === " " || k === "Spacebar") {
        e.preventDefault();
        commit(active);
        return;
      }
      if (k === "ArrowDown") {
        e.preventDefault();
        const n = seek(active + 1, 1);
        if (n >= 0) setActive(n);
        return;
      }
      if (k === "ArrowUp") {
        e.preventDefault();
        const n = seek(active - 1, -1);
        if (n >= 0) setActive(n);
        return;
      }
      if (k === "Home") {
        e.preventDefault();
        const n = firstEnabled();
        if (n >= 0) setActive(n);
        return;
      }
      if (k === "End") {
        e.preventDefault();
        const n = lastEnabled();
        if (n >= 0) setActive(n);
        return;
      }
      // Tab leaves the control. Close WITHOUT committing the highlight: the APG pattern commits
      // here, but a highlight the user only arrowed past is not a choice they made, and this
      // control sits next to Apply buttons where a silent value change is the expensive kind of
      // surprise.
      if (k === "Tab") {
        setOpen(false);
        return;
      }
    }

    if (k.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      typeahead(k);
    }
  };

  const list =
    open && rect
      ? createPortal(
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={labelledBy}
            className="pk-list"
            data-above={rect.above ? "true" : "false"}
            data-motion={reduced ? "reduced" : "full"}
            style={{
              left: `${rect.left}px`,
              width: `${rect.width}px`,
              ...(rect.above
                ? { bottom: `${window.innerHeight - rect.top}px` }
                : { top: `${rect.top}px` }),
            }}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                data-active={i === active ? "true" : "false"}
                // The option's VALUE, not its label — the only way a test (or a live DOM probe) can
                // address a specific option, since the native `<option value>` it replaced is gone.
                data-value={o.value}
                className="pk-option"
                // `pointerdown` would fire before the dismiss listener and fight it; `click` on a
                // list item is fine because the dismiss listener ignores presses inside the list.
                onClick={() => commit(i)}
                onPointerMove={() => {
                  if (!o.disabled && i !== active) setActive(i);
                }}
              >
                <span className="pk-option-label">{o.label}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )
      : null;

  return (
    <div className={`pk-root${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && options[active] ? optionId(active) : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        disabled={disabled}
        className="pk-trigger"
        data-open={open ? "true" : "false"}
        data-placeholder={selected ? "false" : "true"}
        onClick={() => (open ? setOpen(false) : openWith(selectedIndex))}
        onKeyDown={onKeyDown}
      >
        <span className="pk-value">{selected ? selected.label : placeholder}</span>
        <span className="pk-caret" aria-hidden="true" />
      </button>
      {list}
    </div>
  );
}

export default Picker;
