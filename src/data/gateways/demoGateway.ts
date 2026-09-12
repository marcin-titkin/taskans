import type { ActorContext, Gateway, Snapshot } from '@/data/gateway';
import { demoApplyOp, demoSnapshot } from '@/data/demoServer';
import { getDb } from '@/data/db';
import { bus } from '@/lib/bus';
import type { Attachment, OutboxEntry } from '@/types/domain';

/**
 * Bramka trybu demo: całość lokalnie (IndexedDB), z symulacją opóźnień sieci i błędów.
 * Służy do testów (również Playwright), pilotażu bez konta i pracy „na wspólnym komputerze” offline.
 */
export class DemoGateway implements Gateway {
  readonly mode = 'demo' as const;
  private urlCache = new Map<string, string>();

  async fetchSnapshot(_actor: ActorContext): Promise<Snapshot> {
    return demoSnapshot();
  }

  async applyOp(actor: ActorContext, entry: OutboxEntry): Promise<void> {
    await demoApplyOp(entry, actor);
  }

  async attachmentUrl(att: Attachment): Promise<string | null> {
    const cached = this.urlCache.get(att.id);
    if (cached) return cached;
    const db = getDb();
    const photo = (await db.server_photos.get(att.id)) ?? (await db.photos.get(att.id));
    if (!photo) return null;
    const url = URL.createObjectURL(photo.blob);
    this.urlCache.set(att.id, url);
    return url;
  }

  subscribeRealtime(onChanged: () => void): () => void {
    const off = bus.on((e) => {
      if (e.type === 'data-changed' || e.type === 'outbox-changed') onChanged();
    });
    return () => {
      off();
    };
  }
}
