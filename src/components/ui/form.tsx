import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-base text-slate-900 shadow-xs placeholder:text-slate-500',
        'aria-[invalid=true]:border-red-600 aria-[invalid=true]:bg-red-50/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-base leading-6 text-slate-900 shadow-xs placeholder:text-slate-500',
        'aria-[invalid=true]:border-red-600 aria-[invalid=true]:bg-red-50/40',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = 'Textarea';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('block text-sm font-semibold text-slate-800', className)} {...props} />
  )
);
Label.displayName = 'Label';

/**
 * Pole formularza: etykieta + opis + błąd, poprawnie powiązane atrybutami aria.
 * Dzieci receiving id/describedby/aria-invalid — używać przez render-prop:
 * <Field name label><{(ids)=><Input {...ids}/>}</Field>
 */
export interface FieldIds {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
}

export function Field({
  name,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  name: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: (ids: FieldIds) => React.ReactNode;
  className?: string;
}) {
  const id = `f-${name}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="ml-1 text-red-700" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ml-1.5 text-xs font-normal text-slate-500">(opcjonalne)</span>
        )}
      </Label>
      {hint ? (
        <p id={hintId} className="text-sm text-slate-600">
          {hint}
        </p>
      ) : null}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined, required })}
      {error ? (
        <p id={errId} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
