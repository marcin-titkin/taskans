import type { ReactNode } from 'react';

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <p className="text-lg font-semibold text-slate-800">{title}</p>
      {description ? <p className="max-w-prose text-slate-600">{description}</p> : null}
      {action}
    </div>
  );
}
