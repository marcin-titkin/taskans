import * as React from 'react';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> & { label: string }
>(({ className, label, ...props }, ref) => (
  <label className="flex min-h-12 cursor-pointer items-center gap-3">
    <SwitchPrimitives.Root
      ref={ref}
      className={cn(
        'peer inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'data-[state=checked]:bg-brand-700 data-[state=unchecked]:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-60',
        className
      )}
      aria-label={label}
      {...props}
    >
      <SwitchPrimitives.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitives.Root>
    <span className="text-sm font-semibold text-slate-800">{label}</span>
  </label>
));
Switch.displayName = 'Switch';
