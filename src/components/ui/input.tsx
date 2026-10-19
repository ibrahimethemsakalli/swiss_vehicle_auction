'use client';
import * as React from 'react';
import { cn } from '../../lib/utils';
import { useLocale, type MessageKey } from '../providers';
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, onInvalid, onInput, ...props }, ref) => {
  const { t } = useLocale();
  const errorId = React.useId();
  const [error, setError] = React.useState<{
    key: MessageKey;
    values?: Record<string, string | number>;
  } | null>(null);
  React.useEffect(() => {
    setError(null);
  }, [props.value]);
  return (
    <>
      <input
        ref={ref}
        className={cn('field', className)}
        {...props}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], error ? errorId : null].filter(Boolean).join(' ') || undefined
        }
        onInvalid={(event) => {
          event.preventDefault();
          const field = event.currentTarget;
          const v = field.validity;
          setError(
            v.valueMissing
              ? { key: 'validationRequired' }
              : v.typeMismatch && field.type === 'email'
                ? { key: 'validationEmail' }
                : v.tooShort
                  ? { key: 'validationMinLength', values: { count: field.minLength } }
                  : v.rangeUnderflow
                    ? { key: 'validationMin', values: { value: field.min } }
                    : v.rangeOverflow
                      ? { key: 'validationMax', values: { value: field.max } }
                      : v.patternMismatch && field.type === 'tel'
                        ? { key: 'validationPhone' }
                        : { key: 'validationInvalid' },
          );
          if (field.form?.querySelector(':invalid') === field) field.focus();
          onInvalid?.(event);
        }}
        onInput={(event) => {
          setError(null);
          onInput?.(event);
        }}
      />
      {error && (
        <span id={errorId} className="field-error" role="alert">
          {t(error.key, error.values)}
        </span>
      )}
    </>
  );
});
Input.displayName = 'Input';
