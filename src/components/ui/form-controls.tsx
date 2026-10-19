'use client';
import * as React from 'react';
import { useLocale, type MessageKey } from '../providers';

type Control = HTMLSelectElement | HTMLTextAreaElement;
function useFieldError(value: unknown) {
  const { t } = useLocale();
  const id = React.useId();
  const [error, setError] = React.useState<{ key: MessageKey; count?: number } | null>(null);
  React.useEffect(() => {
    setError(null);
  }, [value]);
  return {
    id,
    error,
    clear: () => setError(null),
    invalid: (event: React.FormEvent<Control>) => {
      event.preventDefault();
      const field = event.currentTarget;
      setError(
        field.validity.valueMissing
          ? { key: 'validationRequired' }
          : 'minLength' in field && field.validity.tooShort
            ? { key: 'validationMinLength', count: field.minLength }
            : 'maxLength' in field && field.validity.tooLong
              ? { key: 'validationMaxLength', count: field.maxLength }
              : { key: 'validationInvalid' },
      );
      if (field.form?.querySelector(':invalid') === field) field.focus();
    },
    message: error ? (
      <span id={id} className="field-error" role="alert">
        {t(error.key, error.count === undefined ? undefined : { count: error.count })}
      </span>
    ) : null,
  };
}

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ onInvalid, onInput, onChange, ...props }, ref) => {
  const validation = useFieldError(props.value);
  return (
    <>
      <select
        {...props}
        ref={ref}
        aria-invalid={validation.error ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], validation.error ? validation.id : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onInvalid={(e) => {
          validation.invalid(e);
          onInvalid?.(e);
        }}
        onInput={(e) => {
          validation.clear();
          onInput?.(e);
        }}
        onChange={(e) => {
          validation.clear();
          onChange?.(e);
        }}
      />
      {validation.message}
    </>
  );
});
Select.displayName = 'Select';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ onInvalid, onInput, onChange, ...props }, ref) => {
  const validation = useFieldError(props.value);
  return (
    <>
      <textarea
        {...props}
        ref={ref}
        aria-invalid={validation.error ? true : props['aria-invalid']}
        aria-describedby={
          [props['aria-describedby'], validation.error ? validation.id : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onInvalid={(e) => {
          validation.invalid(e);
          onInvalid?.(e);
        }}
        onInput={(e) => {
          validation.clear();
          onInput?.(e);
        }}
        onChange={(e) => {
          validation.clear();
          onChange?.(e);
        }}
      />
      {validation.message}
    </>
  );
});
Textarea.displayName = 'Textarea';
