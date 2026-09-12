import type { Category, WorkOrder } from '@/types/domain';
import type { CachedWorkOrder } from '@/data/db';

export type { Category };

export interface ProfileLite {
  id: string;
  display_name: string;
  role: string;
}

export type CachedWorkOrderLite = CachedWorkOrder | WorkOrder;
