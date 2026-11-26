import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import type { OrderRow, PaymentReceiptRow } from '@/types/database';

const ApproveReceiptSchema = z.object({
  action: z.enum(['approve', 'reject']),
  reviewedBy: z.string().max(100).optional().default('Chủ quán (Human-in-the-Loop)'),
});

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_ID', message: 'Mã biên lai không hợp lệ.' },
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

  const parsed = ApproveReceiptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION_ERROR', message: 'Hành động phải là approve hoặc reject.' },
      { status: 400 }
    );
  }

  const { action, reviewedBy } = parsed.data;
  const nextVerdict = action === 'approve' ? 'approved' : 'rejected';

  try {
    const supabase = createSupabaseAdminClient();

    const { data: existing, error: fetchErr } = await supabase
      .from('payment_receipts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { ok: false, error: 'RECEIPT_NOT_FOUND', message: 'Không tìm thấy biên lai.' },
        { status: 404 }
      );
    }

    const receiptRow = existing as PaymentReceiptRow;

    const { data: updatedReceipt, error: updateErr } = await supabase
      .from('payment_receipts')
      .update({
        verdict: nextVerdict,
        reviewed_by: reviewedBy.trim() || 'Chủ quán (Human-in-the-Loop)',
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr || !updatedReceipt) {
      return NextResponse.json(
        { ok: false, error: 'UPDATE_FAILED', message: 'Không thể cập nhật trạng thái biên lai.' },
        { status: 500 }
      );
    }

    let orderStatus: OrderRow['status'] | null = null;
    if (receiptRow.order_id) {
      if (action === 'approve') {
        const { data: updatedOrder } = await supabase
          .from('orders')
          .update({ status: 'paid' })
          .eq('id', receiptRow.order_id)
          .select('status')
          .maybeSingle();
        orderStatus = (updatedOrder as { status: OrderRow['status'] } | null)?.status ?? 'paid';
      } else {
        const { data: currentOrder } = await supabase
          .from('orders')
          .select('status, notes')
          .eq('id', receiptRow.order_id)
          .maybeSingle();

        const current = currentOrder as { status: OrderRow['status']; notes: string | null } | null;
        const rejectFlag = `[Từ chối bill ${receiptRow.transaction_ref}]`;
        const nextNotes = current?.notes
          ? current.notes.includes(rejectFlag)
            ? current.notes
            : `${current.notes} | ${rejectFlag}`
          : rejectFlag;
        const keepStatus = current?.status === 'paid' ? 'paid' : 'pending_payment';

        const { data: updatedOrder } = await supabase
          .from('orders')
          .update({ status: keepStatus, notes: nextNotes })
          .eq('id', receiptRow.order_id)
          .select('status')
          .maybeSingle();
        orderStatus = (updatedOrder as { status: OrderRow['status'] } | null)?.status ?? keepStatus;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        receipt: updatedReceipt as PaymentReceiptRow,
        approvalStatus: nextVerdict,
        orderStatus,
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof SupabaseConfigError) {
      return NextResponse.json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED', message: err.message }, { status: 503 });
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'APPROVE_FAILED',
        message: err instanceof Error ? err.message : 'Lỗi cập nhật quyết định đối soát.',
      },
      { status: 500 }
    );
  }
}
