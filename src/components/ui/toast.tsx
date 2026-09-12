import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { bus } from '@/lib/bus';

export interface ToastInput {
  id: string;
  tone: 'ok' | 'warn' | 'error' | 'info';
  message: string;
}

const ToastCtx = React.createContext<(t: Omit<ToastInput, 'id'>) => void>(() => undefined);

export function useToast() {
  return React.useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [toast, setToast] = React.useState<ToastInput | null>(null);
  const show = React.useCallback((t: Omit<ToastInput, 'id'>) => {
    setToast({ ...t, id: crypto.randomUUID() });
    setOpen(true);
  }, []);

  React.useEffect(() => {
    return bus.on((e) => {
      if (e.type === 'toast') show({ tone: e.tone, message: e.message });
    });
  }, [show]);

  const icon =
    toast?.tone === 'ok' ? (
      <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
    ) : toast?.tone === 'warn' ? (
      <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
    ) : toast?.tone === 'error' ? (
      <AlertTriangle className="h-5 w-5 text-red-700" aria-hidden="true" />
    ) : (
      <Info className="h-5 w-5 text-sky-700" aria-hidden="true" />
    );

  return (
    <ToastCtx.Provider value={show}>
      <ToastPrimitive.Provider swipeDirection="up">
        {toast ? (
          <ToastPrimitive.Root
            open={open}
            onOpenChange={setOpen}
            duration={toast.tone === 'error' ? 9000 : 4500}
            className="fixed bottom-24 left-1/2 z-[60] flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 items-start gap-3 rounded-2xl border border-slate-300 bg-white p-4 shadow-lg animate-[toast-in_220ms_cubic-bezier(0.16,1,0.3,1)] sm:bottom-6"
          >
            {icon}
            <ToastPrimitive.Title className="text-base font-semibold text-slate-900">{toast.message}</ToastPrimitive.Title>
            <ToastPrimitive.Close aria-label="Zamknij powiadomienie" className="ml-auto text-slate-500">
              <X className="h-5 w-5" aria-hidden="true" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ) : null}
        <ToastPrimitive.Viewport className="fixed inset-x-0 bottom-0 z-[60] outline-none" />
      </ToastPrimitive.Provider>
      {children}
    </ToastCtx.Provider>
  );
}
