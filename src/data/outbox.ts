import { getDb } from '@/data/db';
import type { OutboxEntry } from '@/types/domain';
import { bus, emitDataChanged, emitToast } from '@/lib/bus';
import { errorKind, friendlyErrorMessage, NetworkError, type ActorContext, type Gateway } from '@/data/gateway';
import { clearDirty, markPhotoSynced, upsertSnapshot } from '@/data/cache';

/**
 * Kolejka outbox + menedżer synchronizacji.
 * Zasady (z briefu): offline → operacje czekają w IndexedDB; online → auto-sync;
 * brak utraty danych — operacja znika z kolejki dopiero po potwierdzeniu serwera;
 * konflikty i błędy wymagające decyzji użytkownika zostają widoczne z akcjami.
 */

export interface SyncState {
  syncing: boolean;
  online: boolean;
  pending: number;
  errors: number;
  conflicts: number;
  lastSyncAt: string | null;
}

const RETRY_BASE_MS = 3_000;
const RETRY_MAX_MS = 60_000;
const MAX_ATTEMPTS_BEFORE_HOLD = 8;

export class SyncManager {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private state: SyncState = {
    syncing: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending: 0,
    errors: 0,
    conflicts: 0,
    lastSyncAt: null,
  };
  private stateListeners = new Set<() => void>();

  private gateway: Gateway;
  private getActor: () => ActorContext | null;
  constructor(gateway: Gateway, getActor: () => ActorContext | null) {
    this.gateway = gateway;
    this.getActor = getActor;
  }

  subscribe(cb: () => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }
  get stateSnapshot(): SyncState {
    return this.state;
  }

  start(): void {
    if (this.stopped) return;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    this.refreshCounters();
    void this.pump();
  }

  stop(): void {
    this.stopped = true;
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (this.timer) clearTimeout(this.timer);
  }

  /** Ustawienia sieci wymuszone przez tryb demo (przełącznik „Pracuj offline”). */
  setSimulatedNetworkDown(down: boolean): void {
    this.state.online = !down;
    this.notify();
    if (!down) void this.pump();
  }

  get online(): boolean {
    return this.state.online;
  }

  private handleOnline = (): void => {
    this.state.online = true;
    this.notify();
    void this.pump();
  };
  private handleOffline = (): void => {
    this.state.online = false;
    this.notify();
  };

  async enqueue(entry: Omit<OutboxEntry, 'seq'>): Promise<number> {
    const db = getDb();
    const seq = await db.outbox.add(entry);
    this.refreshCounters();
    bus.emit({ type: 'outbox-changed' });
    void this.pump();
    return seq;
  }

  retryNow(): void {
    void this.pump();
  }

  /** Akcja użytkownika przy konflikcie: ponów próbę (serwer może być już zgodny po refreshu). */
  async retryOp(seq: number): Promise<void> {
    const db = getDb();
    await db.outbox.update(seq, { status: 'PENDING', attempts: 0, conflictInfo: null, lastError: null });
    this.refreshCounters();
    void this.pump();
  }

  /** Odrzuć lokalną intencję (stan serwera wygrywa); lokalne dane wpisu zostają w historii cache jako usunięte. */
  async discardOp(seq: number, workOrderId: string | null): Promise<void> {
    const db = getDb();
    await db.outbox.delete(seq);
    this.refreshCounters();
    bus.emit({ type: 'outbox-changed' });
    if (workOrderId) {
      // pobierz faktyczny stan z serwera/demo i nadpisz cache
      emitDataChanged('conflict-discarded');
      await upsertSnapshot(await this.gateway.fetchSnapshot(this.actor()));
    }
  }

  private actor(): ActorContext {
    const a = this.getActor();
    if (!a) throw new Error('Brak sesji użytkownika.');
    return a;
  }

  private refreshCounters(): void {
    const db = getDb();
    void (async () => {
      const [pending, errors, conflicts] = await Promise.all([
        db.outbox.filter((e) => e.status === 'PENDING').count(),
        db.outbox.filter((e) => e.status === 'ERROR').count(),
        db.outbox.filter((e) => e.status === 'CONFLICT').count(),
      ]);
      this.state = { ...this.state, pending, errors, conflicts };
      this.notify();
    })();
  }

  private notify(): void {
    for (const cb of this.stateListeners) cb();
  }

  /** Pętla synchronizacji: sekwencyjnie, po jednym wpisie, z backoffem. */
  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.stopped) {
        if (!this.state.online) break;
        const db = getDb();
        // porządek: zsynchronizowane wpisy starsze niż 24 h nie są już potrzebne (historia i tak na serwerze)
        await db.outbox
          .filter((e) => e.status === 'SYNCED')
          .filter((e) => (e.syncedAt ? Date.now() - new Date(e.syncedAt).getTime() > 86_400_000 : true))
          .primaryKeys()
          .then(async (keys) => {
            if (keys.length) await db.outbox.bulkDelete(keys);
          });
        const entry = await db.outbox.filter((e) => e.status === 'PENDING').sortBy('seq').then((l) => l[0]);
        if (!entry) break;
        if (entry.attempts >= MAX_ATTEMPTS_BEFORE_HOLD) {
          // za dużo prób → wstrzymaj auto, pokaż błąd do decyzji użytkownika
          await db.outbox.update(entry.seq!, { status: 'ERROR', lastError: entry.lastError ?? 'Wielokrotne próby nieudane.' });
          this.refreshCounters();
          break;
        }
        await this.process(entry);
        await new Promise((r) => setTimeout(r, 30));
      }
    } finally {
      this.running = false;
    }
  }

  private async process(entry: OutboxEntry): Promise<void> {
    const db = getDb();
    const seq = entry.seq!;
    this.state = { ...this.state, syncing: true };
    this.notify();
    try {
      const actor = this.getActor();
      if (!actor) {
        this.state = { ...this.state, syncing: false };
        this.notify();
        return;
      }
      await this.gateway.applyOp(actor, entry);
      await db.outbox.update(seq, { status: 'SYNCED', syncedAt: new Date().toISOString(), lastError: null });
      await this.markOpSideEffects(entry);
      // Po potwierdzeniu odśwież cache stanem faktycznym i zdejmij flagi dirty z zaangażowanych zadań.
      // Najpierw zdejmij dirty (operacja potwierdzona), potem scal snapshot —
      // inaczej świeżo potwierdzony wiersz zostałby potraktowany jako „lokalna, niezatwierdzona zmiana”.
      if (entry.workOrderId) await clearDirty([entry.workOrderId]);
      if (this.gateway.mode === 'demo') {
        await upsertSnapshot(await this.gateway.fetchSnapshot(this.actor()));
      } else {
        emitDataChanged('synced');
      }
      if (this.timer) clearTimeout(this.timer);
      this.state = { ...this.state, syncing: false, lastSyncAt: new Date().toISOString() };
      this.notify();
      this.refreshCounters();
      bus.emit({ type: 'outbox-changed' });
      if (entry.kind === 'CREATE_WORK_ORDER' || entry.kind === 'CREATE_UNREQUESTED_WORK') {
        emitToast('ok', entry.kind === 'CREATE_WORK_ORDER' ? 'Zlecenie zapisane na serwerze.' : 'Praca zapisana na serwerze.');
      }
    } catch (e) {
      const kind = errorKind(e);
      const message = friendlyErrorMessage(e);
      if (kind === 'network' || kind === 'server') {
        const attempts = entry.attempts + 1;
        await db.outbox.update(seq, { attempts, lastError: message });
        this.state = { ...this.state, syncing: false };
        this.notify();
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(attempts, 5));
        if (this.timer) clearTimeout(this.timer);
        if (attempts < MAX_ATTEMPTS_BEFORE_HOLD) {
          this.timer = setTimeout(() => void this.pump(), delay);
        } else {
          await db.outbox.update(seq, { status: 'ERROR' });
          this.refreshCounters();
        }
        return;
      }
      if (kind === 'conflict') {
        await db.outbox.update(seq, { status: 'CONFLICT', conflictInfo: message, lastError: message, attempts: entry.attempts + 1 });
        bus.emit({ type: 'conflict', opSeq: seq, message });
      } else {
        // permission/validation — błąd widoczny, wymaga decyzji (np. czyjaś zmiana albo brak uprawnień)
        await db.outbox.update(seq, { status: 'ERROR', lastError: message });
      }
      this.state = { ...this.state, syncing: false };
      this.notify();
      this.refreshCounters();
      emitToast(kind === 'conflict' ? 'warn' : 'error', message);
    }
  }

  /** Efekty uboczne po zapisie: zdjęcie uznane za przesłane. */
  private async markOpSideEffects(entry: OutboxEntry): Promise<void> {
    if (entry.payload.kind === 'SAVE_PHOTO') {
      await markPhotoSynced(entry.payload.payload.photoId);
    }
  }
}

export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError;
}
