import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adjustCachedMenuSoldCounts, getCachedMenuItems } from '@/lib/store-cache';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import type { OrderRow } from '@/types/database';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UpdateOrderStatusSchema = z.object({
  status: z.enum(['paid', 'cancelled']),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_ID', message: 'Mã đơn hàng không hợp lệ.' },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_JSON', message: 'Payload JSON không hợp lệ.' },
      { status: 400 }
    );
  }

  const parsed = UpdateOrderStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION_ERROR', message: 'Trạng thái cập nhật phải là paid hoặc cancelled.' },
      { status: 400 }
    );
  }

  const nextStatus = parsed.data.status;

  try {
    const supabase = createSupabaseAdminClient();
    const [orderRes, orderItemsRes] = await Promise.all([
      supabase.from('orders').select('*').eq('id', id).maybeSingle(),
      nextStatus === 'cancelled'
        ? supabase.from('order_items').select('menu_item_id, quantity').eq('order_id', id)
        : Promise.resolve({ data: null }),
    ]);

    if (orderRes.error || !orderRes.data) {
      return NextResponse.json(
        { ok: false, error: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' },
        { status: 404 }
      );
    }

    const existing = orderRes.data as OrderRow;

    if (nextStatus === 'cancelled' && existing.status === 'paid') {
      return NextResponse.json(
        { ok: false, error: 'CANNOT_CANCEL_PAID', message: 'Đơn đã thanh toán không thể hủy trực tiếp.' },
        { status: 400 }
      );
    }

    if (existing.status === nextStatus) {
      return NextResponse.json(
        { ok: true, alreadyUpdated: true, order: existing },
        { status: 200 }
      );
    }

    const decByMenuId = new Map<string, number>();
    const negDeltas = new Map<string, number>();
    if (nextStatus === 'cancelled') {
      for (const row of (orderItemsRes.data ?? []) as Array<{ menu_item_id: string | null; quantity: number }>) {
        if (row.menu_item_id && row.quantity > 0) {
          decByMenuId.set(
            row.menu_item_id,
            (decByMenuId.get(row.menu_item_id) ?? 0) + row.quantity
          );
          negDeltas.set(
            row.menu_item_id,
            (negDeltas.get(row.menu_item_id) ?? 0) - row.quantity
          );
        }
      }
    }

    const cachedMenu = decByMenuId.size > 0 ? await getCachedMenuItems(supabase) : [];
    const soldMap = new Map(cachedMenu.map((m) => [m.id, m.daily_sold_count]));

    const menuRollbackPromises = Array.from(decByMenuId.entries()).map(([menuId, dec]) => {
      const currentCount = soldMap.get(menuId) ?? 0;
      return supabase
        .from('menu_items')
        .update({ daily_sold_count: Math.max(0, currentCount - dec) })
        .eq('id', menuId);
    });

    const [updateRes] = await Promise.all([
      supabase.from('orders').update({ status: nextStatus }).eq('id', id).select('*').single(),
      existing.payment_method === 'debt'
        ? supabase.from('customer_debts').update({ status: 'settled' }).eq('order_id', id)
        : Promise.resolve({ error: null }),
      ...menuRollbackPromises,
    ]);

    if (updateRes.error || !updateRes.data) {
      return NextResponse.json(
        { ok: false, error: 'UPDATE_FAILED', message: 'Không thể cập nhật trạng thái đơn hàng.' },
        { status: 500 }
      );
    }

    adjustCachedMenuSoldCounts(negDeltas);

    return NextResponse.json(
      { ok: true, order: updateRes.data as OrderRow },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof SupabaseConfigError) {
      return NextResponse.json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED', message: err.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'ORDER_STATUS_UPDATE_FAILED',
        message: err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái đơn hàng.',
      },
      { status: 500 }
    );
  }
}
