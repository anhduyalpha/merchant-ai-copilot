import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ParsedOrderSchema } from '@/lib/ai/schemas';
import { normalizeAndCalculateOrder, persistOrderToSupabase } from '@/lib/orders';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import type { MenuItemRow } from '@/types/database';

const CreateOrderSchema = ParsedOrderSchema.extend({
  sourceType: z.enum(['chat', 'handwritten', 'voice', 'manual']).optional().default('manual'),
  rawInput: z.string().max(4000).nullable().optional().default(null),
  notes: z.string().max(500).nullable().optional().default(null),
});

function sanitizePlainText(input: string | null | undefined, maxLen: number): string | null {
  if (!input) return null;
  const cleaned = input
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

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

  if (validated.data.items.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'EMPTY_ORDER', message: 'Đơn hàng phải có ít nhất 1 món.' },
      { status: 400 }
    );
  }

  if (validated.data.discountVnd < 0) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_DISCOUNT', message: 'Số tiền giảm giá không được âm.' },
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

    draft.tableOrChannel = sanitizePlainText(draft.tableOrChannel, 60) ?? 'Tại quầy';
    draft.customerName = sanitizePlainText(draft.customerName, 80);

    if (draft.paymentMethod === 'debt' && !draft.customerName) {
      return NextResponse.json(
        {
          ok: false,
          error: 'DEBT_CUSTOMER_REQUIRED',
          message: 'Vui lòng nhập tên khách hàng trước khi ghi sổ nợ.',
        },
        { status: 400 }
      );
    }

    // Keep user-edited discount & split cash override within safe VND bounds
    const userDiscount = Math.min(Math.max(0, Math.round(validated.data.discountVnd)), draft.subtotalVnd);
    draft.discountVnd = userDiscount;
    draft.totalVnd = Math.max(0, draft.subtotalVnd - userDiscount);

    if (validated.data.paymentMethod === 'split') {
      const requestedCash = Math.round(validated.data.cashAmountVnd);
      if (requestedCash < 0 || requestedCash > draft.totalVnd) {
        return NextResponse.json(
          {
            ok: false,
            error: 'INVALID_SPLIT_AMOUNT',
            message: 'Số tiền mặt tách đơn phải nằm trong khoảng từ 0 đến tổng đơn.',
          },
          { status: 400 }
        );
      }
      draft.paymentMethod = 'split';
      draft.cashAmountVnd = requestedCash;
      draft.transferAmountVnd = Math.max(0, draft.totalVnd - requestedCash);
      if (draft.transferAmountVnd === 0) {
        draft.paymentMethod = 'cash';
      } else if (draft.cashAmountVnd === 0) {
        draft.paymentMethod = 'vietqr';
      }
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
      rawInput: sanitizePlainText(validated.data.rawInput, 2000),
      notes: sanitizePlainText(validated.data.notes, 500),
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
