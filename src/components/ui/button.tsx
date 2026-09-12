import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Przycisk — rozmiar bazowy 48 px (cele dotyku wg briefu i WCAG 2.2 AA, kryterium 2.5.8).
 * Wariant „action” to duże, pełnowysokościowe przyciski dla ekranu wykonawcy.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900 border border-transparent',
        secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-100 active:bg-slate-200',
        ghost: 'bg-transparent text-slate-700 hover:bg-slate-200/70 border border-transparent',
        destructive: 'bg-red-700 text-white hover:bg-red-800 border border-transparent',
        outline: 'border border-slate-400 bg-white text-slate-900 hover:bg-slate-100',
        link: 'text-brand-800 underline underline-offset-4 hover:text-brand-900 bg-transparent',
      },
      size: {
        default: 'min-h-12 px-4 text-base',
        sm: 'min-h-10 px-3 text-sm',
        lg: 'min-h-14 px-6 text-lg',
        action: 'min-h-14 w-full px-5 text-lg justify-start',
        icon: 'h-12 w-12 shrink-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp ref={ref} type={Comp === 'button' ? type : undefined} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  }
);
Button.displayName = 'Button';

export { buttonVariants };
