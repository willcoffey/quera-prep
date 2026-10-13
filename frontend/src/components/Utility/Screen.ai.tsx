import { useEffect, useRef } from "react";
import { Label, TextArea, TextField } from "react-aria-components";

/*
 * Read-only, single line LCD display: optional label stacked over its value.
 * Focus or click selects the whole value, and keeps it selected when the
 * value changes, so it's quick to copy.
 */
interface ScreenProps {
  value: string;
  /** visible label; pass aria-label instead when there's no room for one */
  label?: string;
  "aria-label"?: string;
  placeholder?: string;
  /** monospace value, for ids and qubit lists */
  mono?: boolean;
  /** for placement by the parent, e.g. grid area or flex */
  className?: string;
}

// React 19 hoists <style> with href + precedence into <head>, once per href
const CSS = `
.Screen {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  padding: 0 4px;
  background: var(--lcd-bg);
  border-radius: var(--key-radius);
  box-shadow:
    inset 1px 1px 2px rgb(0 0 0 / 0.45),
    inset -1px -1px 0 rgb(255 255 255 / 0.3);
}

.Screen-label {
  padding: 0 8px;
  font-size: 0.625em;
  line-height: 1;
  color: var(--lcd-ink-dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.Screen-value {
  min-width: 0;
  resize: none;
  overflow: hidden;
  white-space: nowrap;
  box-sizing: border-box;
  margin: 0;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--lcd-ink);
  font: inherit;
  line-height: 1.25;
}

.Screen-mono .Screen-value {
  font-family: ui-monospace, monospace;
}

.Screen-value::placeholder {
  color: var(--lcd-ink-dim);
}

.Screen-value[data-focus-visible] {
  outline: 2px solid var(--lcd-ink);
  outline-offset: -2px;
}
`;

export function Screen({
  value,
  label,
  "aria-label": ariaLabel,
  placeholder,
  mono,
  className,
}: ScreenProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement === el) el.select();
  }, [value]);

  return (
    <TextField
      className={["Screen", mono && "Screen-mono", className]
        .filter(Boolean).join(" ")}
      aria-label={ariaLabel}
      value={value}
      isReadOnly
    >
      <style href="Screen" precedence="default">{CSS}</style>
      {label && <Label className="Screen-label">{label}</Label>}
      <TextArea
        ref={ref}
        className="Screen-value"
        rows={1}
        spellCheck={false}
        placeholder={placeholder}
        // Always select all. Keyboard focus selects in onFocus. Mouse
        // presses skip the default caret placement, which would otherwise
        // collapse the selection, including clicks while already focused
        onFocus={(e) => e.currentTarget.select()}
        onMouseDown={(e) => {
          e.preventDefault();
          e.currentTarget.focus();
          e.currentTarget.select();
        }}
      />
    </TextField>
  );
}
