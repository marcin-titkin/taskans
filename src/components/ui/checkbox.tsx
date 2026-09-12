import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { label?: React.ReactNode; description?: React.ReactNode }
>(({ className, label, description, id, ...props }, ref) => {
  const inner = (
    <CheckboxPrimitive.Root
      ref={ref}
      id={id}
      className={cn(
        'peer h-6 w-6 shrink-0 rounded-md border-2 border-slate-400 bg-white shadow-xs',
        'data-[state=checked]:border-brand-700 data-[state=checked]:bg-brand-700',
        'disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        <Check className="h-4.5 w-4.5" strokeWidth={3} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
  if (!label) return inner;
  return (
    <label htmlFor={id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl px-1 py-2 hover:bg-slate-50">
      <span className="flex h-6 w-6 items-center pt-0.5">{inner}</span>
      <span className="text-base leading-6 text-slate-900">
        {label}
        {description ? <span className="block text-sm text-slate-600">{description}</span> : null}
      </span>
    </label>
  );
});
Checkbox.displayName = 'Checkbox';
