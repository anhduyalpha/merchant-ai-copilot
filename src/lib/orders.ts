import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedOrder, ParsedOrderItem } from '@/lib/ai/schemas';
import { buildVietQRUrl } from '@/lib/vietqr';
import type {
  Database,
  MenuItemRow,
  OrderItemRow,
  OrderRow,
  OrderSourceType,
  PaymentMethod,
} from '@/types/database';

export interface NormalizedOrderItem extends ParsedOrderItem {
  menuItemId: string | null;
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

    const quantity = Math.max(1, Math.round(item.quantity));
    const unitPriceVnd = matched ? matched.price_vnd : Math.max(0, Math.round(item.unitPriceVnd));
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
    confidence: Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.9))),
  };
}

export async function generateNextOrderCode(supabase: SupabaseClient<Database>): Promise<string> {
  const { data } = await supabase
    .from('orders')
    .select('order_code')
    .order('created_at', { ascending: false })
    .limit(50);

  let maxNum = 1003;
  for (const row of (data ?? []) as Array<{ order_code: string }>) {
    const match = /^DH(\d+)$/i.exec(row.order_code.trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  return `DH${maxNum + 1}`;
}

export async function persistOrderToSupabase(
  supabase: SupabaseClient<Database>,
  params: {
    draft: NormalizedOrderDraft;
    sourceType: OrderSourceType;
    rawInput: string | null;
    notes?: string | null;
  }
): Promise<{
  order: OrderRow;
  items: OrderItemRow[];
  vietqrUrl: string | null;
}> {
  const { draft, sourceType, rawInput, notes } = params;

  let order: OrderRow | null = null;
  let vietqrUrl: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const baseCode = await generateNextOrderCode(supabase);
    const num = Number(baseCode.replace(/^DH/i, '')) + attempt;
    const orderCode = `DH${num}`;
    const qrAmount =
      draft.paymentMethod === 'split'
        ? draft.transferAmountVnd
        : draft.paymentMethod === 'vietqr' || draft.paymentMethod === 'debt'
          ? draft.totalVnd
          : 0;

    vietqrUrl =
      qrAmount > 0 ? buildVietQRUrl({ amount: qrAmount, addInfo: orderCode }) : null;

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

  const { data: insertedItems, error: itemsErr } = await supabase
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

  if (itemsErr) {
    throw new Error(itemsErr.message);
  }

  if (draft.paymentMethod === 'debt') {
    const debtQrUrl =
      vietqrUrl ?? buildVietQRUrl({ amount: draft.totalVnd, addInfo: order.order_code });
    const { error: debtErr } = await supabase.from('customer_debts').insert({
      order_id: order.id,
      order_code: order.order_code,
      customer_name: draft.customerName || `${draft.tableOrChannel} (Khách quen)`,
      customer_alias: draft.customerName,
      channel_handle: `${draft.tableOrChannel} (Synthetic)`,
      amount_due_vnd: draft.totalVnd,
      due_date: new Date().toISOString().slice(0, 10),
      status: 'unpaid',
      vietqr_url: debtQrUrl,
      notes: draft.items.map((i) => `${i.quantity} ${i.matchedItemName}`).join(' + '),
    });
    if (debtErr) {
      throw new Error(debtErr.message);
    }
  }

  return {
    order,
    items: (insertedItems ?? []) as OrderItemRow[],
    vietqrUrl,
  };
}
