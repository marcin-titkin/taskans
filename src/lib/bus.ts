/** Prosty magazyn zdarzeń domenowych (zmiany danych, status synchronizacji). */
export type BusEvent =
  | { type: 'data-changed'; reason: string }
  | { type: 'outbox-changed' }
  | { type: 'conflict'; opSeq: number; message: string }
  | { type: 'toast'; tone: 'ok' | 'warn' | 'error'; message: string };

type Handler = (e: BusEvent) => void;

class Bus {
  private handlers = new Set<Handler>();
  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }
  emit(e: BusEvent): void {
    // izolacja błędów: awaria jednego handlera nie może odciąć pozostałych
    // (inaczej np. toast wywala się i cała sieć żywych podpięć głuchnie)
    for (const h of this.handlers) {
      try {
        h(e);
      } catch (err) {
        console.error(`[bus] błąd handlera (typ ${e.type}):`, err);
      }
    }
  }
}

export const bus = new Bus();

export function emitDataChanged(reason: string): void {
  bus.emit({ type: 'data-changed', reason });
}

export function emitToast(tone: 'ok' | 'warn' | 'error', message: string): void {
  bus.emit({ type: 'toast', tone, message });
}
