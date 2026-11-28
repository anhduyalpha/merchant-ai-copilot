import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, MenuItemRow } from '@/types/database';

const MENU_TTL_MS = 30_000;

let cachedMenu: { items: MenuItemRow[]; expiresAt: number } | null = null;
let inFlightMenuPromise: Promise<MenuItemRow[]> | null = null;
let lastAllocatedOrderNum: number | null = null;

/**
 * Returns active menu items from in-process cache (30s TTL) or fetches once from Supabase,
 * eliminating redundant round-trips across parse/create/status routes.
 */
export async function getCachedMenuItems(
  supabase: SupabaseClient<Database>
): Promise<MenuItemRow[]> {
  const now = Date.now();
  if (cachedMenu && cachedMenu.expiresAt > now) {
    return cachedMenu.items.map((item) => ({ ...item }));
  }

  if (!inFlightMenuPromise) {
    inFlightMenuPromise = (async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .order('daily_sold_count', { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      const items = (data ?? []) as MenuItemRow[];
      cachedMenu = { items, expiresAt: Date.now() + MENU_TTL_MS };
      return items;
    })().finally(() => {
      inFlightMenuPromise = null;
    });
  }

  const rows = await inFlightMenuPromise;
  return rows.map((item) => ({ ...item }));
}

export function setCachedMenuItems(items: MenuItemRow[]): void {
  cachedMenu = {
    items: items.map((item) => ({ ...item })),
    expiresAt: Date.now() + MENU_TTL_MS,
  };
}

export function adjustCachedMenuSoldCounts(deltas: ReadonlyMap<string, number>): void {
  if (!cachedMenu || deltas.size === 0) return;
  cachedMenu = {
    expiresAt: cachedMenu.expiresAt,
    items: cachedMenu.items.map((item) => {
      const delta = deltas.get(item.id);
      if (!delta) return item;
      return {
        ...item,
        daily_sold_count: Math.max(0, item.daily_sold_count + delta),
      };
    }),
  };
}

export function syncOrderCodeWatermark(orderCodes: Iterable<string>): void {
  let maxSeen = lastAllocatedOrderNum ?? 1000;
  let updated = lastAllocatedOrderNum !== null;
  for (const code of orderCodes) {
    const match = /^DH(\d+)$/i.exec(code.trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n >= maxSeen) {
        maxSeen = n;
        updated = true;
      }
    }
  }
  if (updated) {
    lastAllocatedOrderNum = maxSeen;
  }
}

export async function allocateNextOrderCodeFast(
  supabase: SupabaseClient<Database>,
  forceDbRefresh = false
): Promise<string> {
  if (!forceDbRefresh && lastAllocatedOrderNum !== null) {
    lastAllocatedOrderNum += 1;
    return `DH${lastAllocatedOrderNum}`;
  }

  const { data } = await supabase
    .from('orders')
    .select('order_code')
    .order('created_at', { ascending: false })
    .limit(50);

  let maxNum = 1000;
  for (const row of (data ?? []) as Array<{ order_code: string }>) {
    const match = /^DH(\d+)$/i.exec(row.order_code.trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }

  lastAllocatedOrderNum = maxNum + 1;
  return `DH${lastAllocatedOrderNum}`;
}

export function invalidateStoreCache(resetOrderNumTo: number | null = null): void {
  cachedMenu = null;
  inFlightMenuPromise = null;
  lastAllocatedOrderNum = resetOrderNumTo;
}
