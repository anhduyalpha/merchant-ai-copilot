import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedOrder, ParsedOrderItem } from '@/lib/ai/schemas';
import {
  adjustCachedMenuSoldCounts,
  allocateNextOrderCodeFast,
  getCachedMenuItems,
  syncOrderCodeWatermark,
} from '@/lib/store-cache';
import { buildVietQRPayload } from '@/lib/vietqr';
import type {
  CustomerDebtRow,
  Database,
  MenuItemRow,
  OrderItemRow,
  OrderRow,
  OrderSourceType,
  PaymentMethod,
} from '@/types/database';

export interface NormalizedOrderItem extends ParsedOrderItem {
  menuItemId: string | null;
  isUnmatched: boolean;
}

export interface NormalizedOrderDraft {
  tableOrChannel: string;
  customerName: string | null;
  items: NormalizedOrderItem[];
  subtotalVnd: number;
  discountVnd: number;
  discountReason: string | null;
  totalVnd: number;
  cashAmountVnd: number;
  transferAmountVnd: number;
  paymentMethod: PaymentMethod;
  unmatchedNotes: string[];
  warnings: string[];
  confidence: number;
}

const VALID_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

export function sanitizeImageMimeType(
  mime?: string
): 'image/png' | 'image/jpeg' | 'image/jpg' | 'image/webp' | 'image/gif' {
  const clean = (mime ?? 'image/png').trim().toLowerCase();
  return VALID_IMAGE_MIMES.has(clean)
    ? (clean as 'image/png' | 'image/jpeg' | 'image/jpg' | 'image/webp' | 'image/gif')
    : 'image/png';
}

export function normalizePaymentMethod(raw?: string | null): PaymentMethod {
  const val = (raw ?? 'vietqr').trim().toLowerCase();
  if (val === 'transfer' || val === 'vietqr') return 'vietqr';
  if (val === 'cash' || val === 'split' || val === 'debt') return val;
  return 'vietqr';
}

/**
 * Deterministically locks matched menu prices from Supabase and enforces non-negative integer VND math.
 */
export function normalizeAndCalculateOrder(
  parsed: ParsedOrder & { paymentMethod?: string },
  menuItems: MenuItemRow[]
): NormalizedOrderDraft {
  const bySku = new Map<string, MenuItemRow>();
  const byName = new Map<string, MenuItemRow>();
  for (const m of menuItems) {
    bySku.set(m.sku.trim().toUpperCase(), m);
    byName.set(m.name.trim().toLowerCase(), m);
  }

  const normalizedItems: NormalizedOrderItem[] = parsed.items.map((item) => {
    const skuKey = item.sku?.trim().toUpperCase();
    const matched =
      (skuKey ? bySku.get(skuKey) : undefined) ??
      byName.get(item.matchedItemName.trim().toLowerCase());

    const quantity = Math.min(9999, Math.max(1, Math.round(item.quantity)));
    const unitPriceVnd = matched ? matched.price_vnd : Math.max(0, Math.round(item.unitPriceVnd ?? 0));
    const lineTotalVnd = quantity * unitPriceVnd;

    return {
      sku: matched ? matched.sku : item.sku,
      menuItemId: matched ? matched.id : null,
      matchedItemName: matched ? matched.name : item.matchedItemName.trim(),
      rawText: item.rawText.trim() || item.matchedItemName.trim(),
      quantity,
      unitPriceVnd,
      modifiers: Array.isArray(item.modifiers)
        ? item.modifiers.map((m) => m.trim()).filter(Boolean)
        : [],
      paymentSplitTag: item.paymentSplitTag ?? 'shared',
      lineTotalVnd,
      isUnmatched: !matched || Boolean(item.isUnmatched),
    };
  });

  const subtotalVnd = normalizedItems.reduce((sum, i) => sum + i.lineTotalVnd, 0);
  const rawDiscount = Math.max(0, Math.round(parsed.discountVnd ?? 0));
  const discountVnd = Math.min(rawDiscount, subtotalVnd);
  const totalVnd = Math.max(0, subtotalVnd - discountVnd);

  let paymentMethod = normalizePaymentMethod(parsed.paymentMethod);
  let cashAmountVnd = 0;
  let transferAmountVnd = 0;

  if (paymentMethod === 'cash') {
    cashAmountVnd = totalVnd;
  } else if (paymentMethod === 'debt') {
    cashAmountVnd = 0;
    transferAmountVnd = 0;
  } else if (paymentMethod === 'split') {
    const explicitCash = normalizedItems
      .filter((i) => i.paymentSplitTag === 'cash')
      .reduce((s, i) => s + i.lineTotalVnd, 0);
    const parsedCash = Math.max(0, Math.round(parsed.cashAmountVnd ?? 0));
    cashAmountVnd = Math.min(totalVnd, parsedCash > 0 ? parsedCash : explicitCash);
    transferAmountVnd = Math.max(0, totalVnd - cashAmountVnd);
    if (cashAmountVnd === 0) paymentMethod = 'vietqr';
    else if (transferAmountVnd === 0) paymentMethod = 'cash';
  } else {
    transferAmountVnd = totalVnd;
  }

  return {
    tableOrChannel: parsed.tableOrChannel?.trim() || 'Tại quầy',
    customerName: parsed.customerName?.trim() || null,
    items: normalizedItems,
    subtotalVnd,
    discountVnd,
    discountReason: parsed.discountReason?.trim() || null,
    totalVnd,
    cashAmountVnd,
    transferAmountVnd,
    paymentMethod,
    unmatchedNotes: Array.isArray(parsed.unmatchedNotes)
      ? parsed.unmatchedNotes.map((n) => n.trim()).filter(Boolean)
      : [],
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w) => w.trim()).filter(Boolean)
      : [],
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.9))),
  };
}

export async function generateNextOrderCode(supabase: SupabaseClient<Database>): Promise<string> {
  return allocateNextOrderCodeFast(supabase, true);
}

export async function persistOrderToSupabase(
  supabase: SupabaseClient<Database>,
  params: {
    draft: NormalizedOrderDraft;
    sourceType: OrderSourceType;
    rawInput: string | null;
    notes?: string | null;
    menuItems?: MenuItemRow[];
  }
): Promise<{
  order: OrderRow;
  items: OrderItemRow[];
  debt: CustomerDebtRow | null;
  vietqrUrl: string | null;
}> {
  const { draft, sourceType, rawInput, notes } = params;

  let order: OrderRow | null = null;
  let vietqrUrl: string | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const orderCode = await allocateNextOrderCodeFast(supabase, attempt > 0);
    const qrAmount =
      draft.paymentMethod === 'split'
        ? draft.transferAmountVnd
        : draft.paymentMethod === 'vietqr' || draft.paymentMethod === 'debt'
          ? draft.totalVnd
          : 0;

    vietqrUrl =
      qrAmount > 0 ? buildVietQRPayload({ amount: qrAmount, addInfo: orderCode }) : null;

    const status =
      draft.paymentMethod === 'debt'
        ? 'debt'
        : draft.paymentMethod === 'cash'
          ? 'paid'
          : 'pending_payment';
    const { data, error } = await supabase
      .from('orders')
      .insert({
        order_code: orderCode,
        table_or_channel: draft.tableOrChannel,
        customer_name: draft.customerName,
        source_type: sourceType,
        raw_input: rawInput,
        subtotal_vnd: draft.subtotalVnd,
        discount_vnd: draft.discountVnd,
        total_vnd: draft.totalVnd,
        cash_amount_vnd: draft.cashAmountVnd,
        transfer_amount_vnd: draft.transferAmountVnd,
        payment_method: draft.paymentMethod,
        status,
        vietqr_url: vietqrUrl,
        notes:
          notes?.trim() ||
          draft.discountReason ||
          (draft.unmatchedNotes.length > 0 ? draft.unmatchedNotes.join('; ') : null),
      })
      .select('*')
      .single();

    if (!error && data) {
      order = data as OrderRow;
      break;
    }
    if (error?.code !== '23505') {
      throw new Error(error?.message || 'Failed to insert order into Supabase.');
    }
  }

  if (!order) {
    throw new Error('Could not allocate unique order_code after retries.');
  }

  const qtyByMenuId = new Map<string, number>();
  for (const item of draft.items) {
    if (item.menuItemId) {
      qtyByMenuId.set(item.menuItemId, (qtyByMenuId.get(item.menuItemId) ?? 0) + item.quantity);
    }
  }

  const knownMenu =
    qtyByMenuId.size > 0
      ? (params.menuItems ?? (await getCachedMenuItems(supabase)))
      : [];
  const soldCountById = new Map(knownMenu.map((m) => [m.id, m.daily_sold_count]));

  const itemsInsertPromise = supabase
    .from('order_items')
    .insert(
      draft.items.map((item) => ({
        order_id: order.id,
        menu_item_id: item.menuItemId,
        item_name: item.matchedItemName,
        quantity: item.quantity,
        unit_price_vnd: item.unitPriceVnd,
        modifiers: item.modifiers,
        payment_split_tag: item.paymentSplitTag,
        line_total_vnd: item.lineTotalVnd,
      }))
    )
    .select('*');

  const menuUpdatePromises = Array.from(qtyByMenuId.entries())
    .filter(([, addQty]) => addQty > 0)
    .map(([menuId, addQty]) => {
      const currentCount = soldCountById.get(menuId) ?? 0;
      return supabase
        .from('menu_items')
        .update({ daily_sold_count: Math.max(0, currentCount + addQty) })
        .eq('id', menuId);
    });

  const debtInsertPromise =
    draft.paymentMethod === 'debt'
      ? supabase
          .from('customer_debts')
          .insert({
            order_id: order.id,
            order_code: order.order_code,
            customer_name: draft.customerName || `${draft.tableOrChannel} (Khách quen)`,
            customer_alias: draft.customerName,
            channel_handle: draft.tableOrChannel || 'Tại quầy',
            amount_due_vnd: draft.totalVnd,
            due_date: new Date().toISOString().slice(0, 10),
            status: 'unpaid',
            vietqr_url:
              vietqrUrl ?? buildVietQRPayload({ amount: draft.totalVnd, addInfo: order.order_code }),
            notes: draft.items.map((i) => `${i.quantity} ${i.matchedItemName}`).join(' + '),
          })
          .select('*')
          .single()
      : Promise.resolve({ data: null, error: null });

  const [itemsRes, debtRes] = await Promise.all([
    itemsInsertPromise,
    debtInsertPromise,
    ...menuUpdatePromises,
  ]);

  if (itemsRes.error) {
    throw new Error(itemsRes.error.message);
  }
  if (debtRes.error) {
    throw new Error(debtRes.error.message);
  }

  adjustCachedMenuSoldCounts(qtyByMenuId);
  syncOrderCodeWatermark([order.order_code]);

  return {
    order,
    items: (itemsRes.data ?? []) as OrderItemRow[],
    debt: (debtRes.data as CustomerDebtRow | null) ?? null,
    vietqrUrl,
  };
}
