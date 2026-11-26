import { NextResponse } from 'next/server';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import type { CustomerDebtRow } from '@/types/database';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_ID', message: 'Mã công nợ không hợp lệ.' },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: debt, error: fetchErr } = await supabase
      .from('customer_debts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !debt) {
      return NextResponse.json(
        { ok: false, error: 'DEBT_NOT_FOUND', message: 'Không tìm thấy khoản công nợ.' },
        { status: 404 }
      );
    }

    const existing = debt as CustomerDebtRow;

    const { data: updatedDebt, error: updateErr } = await supabase
      .from('customer_debts')
      .update({ status: 'settled' })
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr || !updatedDebt) {
      return NextResponse.json(
        { ok: false, error: 'SETTLE_FAILED', message: 'Không thể tất toán khoản công nợ.' },
        { status: 500 }
      );
    }

    if (existing.order_id) {
      await supabase
        .from('orders')
        .update({ status: 'paid' })
        .eq('id', existing.order_id);
    }

    return NextResponse.json(
      { ok: true, debt: updatedDebt as CustomerDebtRow },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof SupabaseConfigError) {
      return NextResponse.json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED', message: err.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'DEBT_SETTLE_ERROR',
        message: err instanceof Error ? err.message : 'Lỗi cập nhật thu nợ.',
      },
      { status: 500 }
    );
  }
}
