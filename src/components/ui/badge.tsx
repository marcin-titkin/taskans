import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-sm font-semibold', {
  variants: {
    tone: {
      neutral: 'border-slate-300 bg-slate-100 text-slate-800',
      info: 'border-sky-300 bg-sky-50 text-sky-900',
      success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
      warning: 'border-amber-300 bg-amber-50 text-amber-900',
      danger: 'border-red-300 bg-red-50 text-red-800',
      outline: 'border-slate-400 bg-white text-slate-800',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
