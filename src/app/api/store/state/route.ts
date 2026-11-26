import { connection, NextResponse } from 'next/server';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import type {
  CustomerDebtRow,
  MenuItemRow,
  OrderItemRow,
  OrderRow,
  PaymentReceiptRow,
} from '@/types/database';

export interface StoreOrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

export interface StoreSummary {
  totalOrders: number;
  paidOrderCount: number;
  pendingOrderCount: number;
  debtOrderCount: number;
  paidRevenueVnd: number;
  cashCollectedVnd: number;
  transferCollectedVnd: number;
  unpaidDebtVnd: number;
  unpaidDebtCount: number;
  flaggedReceiptCount: number;
  slowMovingItems: MenuItemRow[];
}

export async function GET() {
  await connection();

  try {
    const supabase = createSupabaseAdminClient();

    const [menuRes, ordersRes, itemsRes, receiptsRes, debtsRes] = await Promise.all([
      supabase.from('menu_items').select('*').order('daily_sold_count', { ascending: false }),
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(25),
      supabase.from('order_items').select('*').order('created_at', { ascending: true }).limit(200),
      supabase.from('payment_receipts').select('*').order('created_at', { ascending: false }).limit(25),
      supabase.from('customer_debts').select('*').order('created_at', { ascending: false }).limit(25),
    ]);

    const firstError =
      menuRes.error || ordersRes.error || itemsRes.error || receiptsRes.error || debtsRes.error;
    if (firstError) {
      return NextResponse.json(
        {
          ok: false,
          error: 'DATABASE_QUERY_FAILED',
          message: 'Không thể tải dữ liệu cửa hàng từ Supabase.',
        },
        { status: 500 }
      );
    }

    const menuItems = (menuRes.data ?? []) as MenuItemRow[];
    const rawOrders = (ordersRes.data ?? []) as OrderRow[];
    const rawItems = (itemsRes.data ?? []) as OrderItemRow[];
    const paymentReceipts = (receiptsRes.data ?? []) as PaymentReceiptRow[];
    const customerDebts = (debtsRes.data ?? []) as CustomerDebtRow[];

    const itemsByOrderId = new Map<string, OrderItemRow[]>();
    for (const item of rawItems) {
      const bucket = itemsByOrderId.get(item.order_id) ?? [];
      bucket.push(item);
      itemsByOrderId.set(item.order_id, bucket);
    }

    const orders: StoreOrderWithItems[] = rawOrders.map((order) => ({
      ...order,
      items: itemsByOrderId.get(order.id) ?? [],
    }));

    const paidOrders = orders.filter((o) => o.status === 'paid');
    const pendingOrderCount = orders.filter((o) => o.status === 'pending_payment').length;
    const debtOrderCount = orders.filter((o) => o.status === 'debt').length;

    const paidRevenueVnd = paidOrders.reduce((sum, o) => sum + o.total_vnd, 0);
    const cashCollectedVnd = paidOrders.reduce((sum, o) => sum + o.cash_amount_vnd, 0);
    const transferCollectedVnd = paidOrders.reduce((sum, o) => sum + o.transfer_amount_vnd, 0);

    const openDebts = customerDebts.filter((d) => d.status !== 'settled');
    const unpaidDebtVnd = openDebts.reduce((sum, d) => sum + d.amount_due_vnd, 0);

    const flaggedReceiptCount = paymentReceipts.filter(
      (r) => r.risk_level === 'high' || r.verdict === 'rejected'
    ).length;

    const slowMovingItems = menuItems
      .filter((m) => m.is_available && m.daily_sold_count <= 5)
      .sort((a, b) => a.daily_sold_count - b.daily_sold_count);

    const summary: StoreSummary = {
      totalOrders: orders.length,
      paidOrderCount: paidOrders.length,
      pendingOrderCount,
      debtOrderCount,
      paidRevenueVnd,
      cashCollectedVnd,
      transferCollectedVnd,
      unpaidDebtVnd,
      unpaidDebtCount: openDebts.length,
      flaggedReceiptCount,
      slowMovingItems,
    };

    return NextResponse.json(
      {
        ok: true,
        source: 'supabase',
        fetchedAt: new Date().toISOString(),
        summary,
        menuItems,
        orders,
        paymentReceipts,
        customerDebts,
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof SupabaseConfigError) {
      return NextResponse.json(
        {
          ok: false,
          error: 'SUPABASE_NOT_CONFIGURED',
          message: err.message,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'STORE_STATE_ERROR',
        message: 'Lỗi hệ thống khi đọc trạng thái cửa hàng.',
      },
      { status: 500 }
    );
  }
}
