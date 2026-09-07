/**
 * Form primitives: labelled Input, Select, Textarea and Checkbox.
 *
 * Each renders its own inline validation message and wires up `aria-invalid` +
 * `aria-describedby`, so error state is announced to screen readers as well as
 * shown visually. The `testId` prop lands on the control itself, and the error
 * carries `field-error-{name}` so tests can assert the message directly.
 */
import { forwardRef, useId } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { fieldError as fieldErrorId } from '@shared/testIds.js';
import { cn } from '../../lib/utils.js';

function FieldShell({ label, htmlFor, error, hint, required, children, className }) {
  return (
    <div className={cn('w-full', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="label">
          {label}
          {required ? <span className="ml-0.5 text-danger-500">*</span> : null}
        </label>
      ) : null}

      {children}

      {error ? (
        <p className="field-error" data-testid={fieldErrorId(htmlFor)} role="alert">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p className="hint">{hint}</p>
      ) : null}
    </div>
  );
}

const controlClasses = (error, extra) =>
  cn(
    'w-full rounded-lg border bg-white/[0.06] px-3 text-sm text-slate-900 backdrop-blur-glass transition',
    'placeholder:text-slate-400',
    'disabled:cursor-not-allowed disabled:bg-white/[0.03] disabled:text-slate-400',
    error
      ? 'border-danger-400/60 focus:border-danger-400'
      : 'border-white/10 hover:border-white/20 focus:border-brand-500',
    extra
  );

/**
 * Geometry for a leading adornment (`+91`, `₹`).
 *
 * The adornment is its own non-editable element, and the input's padding-left
 * is derived from the adornment's own width — `1ch` per character, which is
 * the width of a digit in the current font — so the typed value can never run
 * into it, at any value length. A multi-character prefix such as `+91` also
 * gets a hairline divider, which single symbols like `₹` do not need.
 */
function prefixGeometry(prefix) {
  if (!prefix) return { padding: undefined, divided: false };

  const divided = String(prefix).length > 1;
  // pl-3 (0.75rem) + the prefix itself + trailing gap (divider: pr-2.5 + 1px + clearance).
  const trailing = divided ? '1.125rem' : '0.375rem';

  return {
    divided,
    padding: `calc(0.75rem + ${String(prefix).length}ch + ${trailing})`,
  };
}

/**
 * Number and date fields are rendered as plain text, deliberately.
 *
 * Both native types become OS widgets inside a WebView, and neither is an
 * editable text node any more:
 *
 * - `type="number"` is exposed to Android's accessibility tree as a
 *   **spinbutton** — the node advertises `ACTION_SET_PROGRESS`, not
 *   `ACTION_SET_TEXT`, so a native runner gets `invalid element state` and the
 *   field cannot be filled at all on a device.
 * - `type="date"` opens the **OS date picker**, a calendar dialog with nothing
 *   for automation to address.
 *
 * `type="text"` with `inputMode` keeps the phone's numeric keypad and stays a
 * plain EditText. Keystrokes are filtered and formatted here, so callers still
 * see exactly what the native inputs gave them — digits, or an ISO date — and
 * nothing downstream changes. It is also better for people: no spinner, no
 * value changing under a scroll wheel, and a birth date can simply be typed
 * rather than paged back through a calendar.
 */
function plainTextProps({ type, inputMode, step, placeholder, maxLength, onChange }) {
  const passthrough = { type, inputMode, placeholder, maxLength, onChange };

  if (type === 'number') {
    const decimals = step !== undefined && String(step) !== '1';

    return {
      ...passthrough,
      type: 'text',
      inputMode: inputMode || (decimals ? 'decimal' : 'numeric'),
      onChange: (event) => {
        const cleaned = decimals
          ? // One decimal point, digits either side.
            event.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1')
          : event.target.value.replace(/\D/g, '');

        if (cleaned !== event.target.value) event.target.value = cleaned;
        onChange?.(event);
      },
    };
  }

  /*
   * `<input type="date">` opens the OS date picker — a calendar dialog in a
   * WebView, so the field is not an editable node at all and automation has to
   * drive a spinner it cannot address. A plain field that accepts a typed date
   * is both scriptable and quicker for anyone entering a birth date, which is
   * never "near today" and so is the worst case for a picker.
   *
   * The value stays ISO `YYYY-MM-DD`, unchanged, so callers and the API see
   * exactly what the native input gave them. Separators are inserted while
   * typing, and a pasted or scripted `1995-06-15` — or `19950615` — both land
   * correctly.
   */
  if (type === 'date') {
    return {
      ...passthrough,
      type: 'text',
      inputMode: inputMode || 'numeric',
      placeholder: placeholder || 'YYYY-MM-DD',
      maxLength: maxLength ?? 10,
      onChange: (event) => {
        const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
        const cleaned = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)]
          .filter(Boolean)
          .join('-');

        if (cleaned !== event.target.value) event.target.value = cleaned;
        onChange?.(event);
      },
    };
  }

  return passthrough;
}

export const Input = forwardRef(function Input(
  {
    label,
    name,
    error,
    hint,
    required,
    className,
    testId,
    prefix,
    style,
    type = 'text',
    inputMode,
    placeholder,
    maxLength,
    // Browser-side constraints on a number input; meaningless on a text one,
    // and invalid HTML if forwarded. Validation lives in the form and the API.
    min,
    max,
    step,
    onChange,
    ...props
  },
  ref
) {
  const generatedId = useId();
  const id = name || generatedId;
  const { padding, divided } = prefixGeometry(prefix);
  const plain = plainTextProps({ type, inputMode, step, placeholder, maxLength, onChange });
  void min;
  void max;

  return (
    <FieldShell label={label} htmlFor={id} error={error} hint={hint} required={required} className={className}>
      <div className="relative">
        {prefix ? (
          <span
            className={cn(
              // pointer-events-none so a click in the prefix area still focuses the input.
              'pointer-events-none absolute inset-y-0 left-0 z-10 flex select-none items-center pl-3 text-sm font-medium text-slate-500',
              divided && 'border-r border-white/10 pr-2.5'
            )}
          >
            {prefix}
          </span>
        ) : null}
        <input
          ref={ref}
          id={id}
          name={name}
          data-testid={testId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? fieldErrorId(id) : undefined}
          className={controlClasses(error, 'h-10')}
          style={padding ? { paddingLeft: padding, ...style } : style}
          type={plain.type}
          inputMode={plain.inputMode}
          placeholder={plain.placeholder}
          maxLength={plain.maxLength}
          onChange={plain.onChange}
          {...props}
        />
      </div>
    </FieldShell>
  );
});

export const Select = forwardRef(function Select(
  { label, name, error, hint, required, className, testId, options = [], placeholder, children, ...props },
  ref
) {
  const generatedId = useId();
  const id = name || generatedId;

  return (
    <FieldShell label={label} htmlFor={id} error={error} hint={hint} required={required} className={className}>
      <div className="relative">
        <select
          ref={ref}
          id={id}
          name={name}
          data-testid={testId}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? fieldErrorId(id) : undefined}
          className={controlClasses(error, 'h-10 appearance-none pr-9')}
          {...props}
        >
          {placeholder ? (
            <option value="">{placeholder}</option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
      </div>
    </FieldShell>
  );
});

export const Textarea = forwardRef(function Textarea(
  { label, name, error, hint, required, className, testId, rows = 3, ...props },
  ref
) {
  const generatedId = useId();
  const id = name || generatedId;

  return (
    <FieldShell label={label} htmlFor={id} error={error} hint={hint} required={required} className={className}>
      <textarea
        ref={ref}
        id={id}
        name={name}
        rows={rows}
        data-testid={testId}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? fieldErrorId(id) : undefined}
        className={controlClasses(error, 'py-2 leading-relaxed')}
        {...props}
      />
    </FieldShell>
  );
});

export const Checkbox = forwardRef(function Checkbox(
  { label, name, error, testId, className, ...props },
  ref
) {
  const generatedId = useId();
  const id = name || generatedId;

  return (
    <div className={cn('w-full', className)}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-600">
        <input
          ref={ref}
          id={id}
          name={name}
          type="checkbox"
          data-testid={testId}
          aria-invalid={error ? 'true' : undefined}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.06] text-brand-500 focus:ring-brand-500 focus:ring-offset-0"
          {...props}
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p className="field-error" data-testid={fieldErrorId(id)} role="alert">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
});

export default { Input, Select, Textarea, Checkbox };
