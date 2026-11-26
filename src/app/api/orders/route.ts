import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ParsedOrderSchema } from '@/lib/ai/schemas';
import { normalizeAndCalculateOrder, persistOrderToSupabase } from '@/lib/orders';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import type { MenuItemRow } from '@/types/database';

const CreateOrderSchema = ParsedOrderSchema.extend({
  sourceType: z.enum(['chat', 'handwritten', 'voice', 'manual']).optional().default('manual'),
  rawInput: z.string().max(4000).nullable().optional().default(null),
  notes: z.string().max(1000).nullable().optional().default(null),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_JSON', message: 'Payload đơn hàng không hợp lệ.' },
      { status: 400 }
    );
  }

  const validated = CreateOrderSchema.safeParse(body);
  if (!validated.success) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION_ERROR', message: 'Thiếu thông tin món ăn hoặc số tiền không hợp lệ.' },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: menuData, error: menuErr } = await supabase.from('menu_items').select('*');
    if (menuErr) {
      return NextResponse.json(
        { ok: false, error: 'DB_ERROR', message: 'Không đọc được thực đơn từ Supabase.' },
        { status: 500 }
      );
    }

    const menuItems = (menuData ?? []) as MenuItemRow[];
    const draft = normalizeAndCalculateOrder(validated.data, menuItems);

    // Keep user-edited discount & split cash override within safe VND bounds
    const userDiscount = Math.min(Math.max(0, Math.round(validated.data.discountVnd)), draft.subtotalVnd);
    draft.discountVnd = userDiscount;
    draft.totalVnd = Math.max(0, draft.subtotalVnd - userDiscount);
    if (draft.paymentMethod === 'split') {
      draft.cashAmountVnd = Math.min(draft.totalVnd, Math.max(0, Math.round(validated.data.cashAmountVnd)));
      draft.transferAmountVnd = Math.max(0, draft.totalVnd - draft.cashAmountVnd);
    } else if (draft.paymentMethod === 'vietqr') {
      draft.cashAmountVnd = 0;
      draft.transferAmountVnd = draft.totalVnd;
    } else if (draft.paymentMethod === 'cash') {
      draft.cashAmountVnd = draft.totalVnd;
      draft.transferAmountVnd = 0;
    }

    const persisted = await persistOrderToSupabase(supabase, {
      draft,
      sourceType: validated.data.sourceType,
      rawInput: validated.data.rawInput,
      notes: validated.data.notes,
    });

    return NextResponse.json(
      {
        ok: true,
        order: persisted.order,
        items: persisted.items,
        vietqrUrl: persisted.vietqrUrl,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof SupabaseConfigError) {
      return NextResponse.json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED', message: err.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'CREATE_ORDER_FAILED',
        message: err instanceof Error ? err.message : 'Không thể lưu đơn hàng mới.',
      },
      { status: 500 }
    );
  }
}
