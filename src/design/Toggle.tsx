// The preference toggle — a plain on/off switch for a stored setting.
//
// NOT the TrustSwitch. TrustSwitch is the apply/undo control for a Windows CHANGE: it carries the
// snapshot-reveal line, a busy state, and the promise that flipping it back restores a named prior.
// This one changes a Compy preference and nothing on the machine, so it carries none of that weight.
// Confusing the two would either over-promise (a preference does not restore a Windows prior) or
// under-promise (a mutation without its snapshot line).
//
// Lived inside Settings.tsx until 2026-08-25, when ReceiptsConsent needed the same control for its
// sharing switch. Duplicating a design primitive is how two switches drift apart, so it moved here
// rather than being copied. `set-toggle` styling is unchanged and still owned by the settings CSS.
export function Toggle({
  on,
  onChange,
  ariaLabel,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      className={`set-toggle ${on ? "set-toggle-on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="set-toggle-thumb" />
    </button>
  );
}
