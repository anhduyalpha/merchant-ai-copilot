import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AIProviderError, generateStructuredJSON } from '@/lib/ai/provider';
import { CopilotActionSchema } from '@/lib/ai/schemas';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import { buildVietQRPayload, formatTransferReminderText, formatVND } from '@/lib/vietqr';
import type {
  CustomerDebtRow,
  MenuItemRow,
  OrderRow,
  PaymentReceiptRow,
} from '@/types/database';

const CopilotRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(1500),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_JSON', message: 'Payload JSON không hợp lệ.' },
      { status: 400 }
    );
  }

  const parsed = CopilotRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: 'EMPTY_PROMPT',
        message: 'Vui lòng nhập câu hỏi hoặc yêu cầu cho Trợ lý điều hành.',
      },
      { status: 400 }
    );
  }

  const { prompt } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    const [menuRes, ordersRes, receiptsRes, debtsRes] = await Promise.all([
      supabase.from('menu_items').select('*').order('daily_sold_count', { ascending: false }),
      supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('payment_receipts').select('*').order('created_at', { ascending: false }).limit(30),
      supabase.from('customer_debts').select('*').order('created_at', { ascending: false }).limit(30),
    ]);

    if (menuRes.error || ordersRes.error || receiptsRes.error || debtsRes.error) {
      return NextResponse.json(
        { ok: false, error: 'DB_ERROR', message: 'Không đọc được số liệu vận hành từ Supabase.' },
        { status: 500 }
      );
    }

    const menuItems = (menuRes.data ?? []) as MenuItemRow[];
    const orders = (ordersRes.data ?? []) as OrderRow[];
    const receipts = (receiptsRes.data ?? []) as PaymentReceiptRow[];
    const debts = (debtsRes.data ?? []) as CustomerDebtRow[];

    const paidOrders = orders.filter((o) => o.status === 'paid');
    const pendingOrders = orders.filter((o) => o.status === 'pending_payment');
    const openDebts = debts.filter((d) => d.status !== 'settled');
    const flaggedReceipts = receipts.filter((r) => r.risk_level === 'high' || r.verdict === 'rejected');

    const paidRevenueVnd = paidOrders.reduce((s, o) => s + o.total_vnd, 0);
    const cashCollectedVnd = paidOrders.reduce((s, o) => s + o.cash_amount_vnd, 0);
    const transferCollectedVnd = paidOrders.reduce((s, o) => s + o.transfer_amount_vnd, 0);
    const pendingAmountVnd = pendingOrders.reduce((s, o) => s + o.total_vnd, 0);
    const unpaidDebtVnd = openDebts.reduce((s, d) => s + d.amount_due_vnd, 0);

    const slowMoving = menuItems
      .filter((m) => m.is_available && m.daily_sold_count <= 5)
      .sort((a, b) => a.daily_sold_count - b.daily_sold_count);
    const topSelling = menuItems.slice(0, 3);

    const verifiedDebtUrlMap = new Map<
      string,
      { vietqrUrl: string; customerName: string; channelHandle: string; amountDueVnd: number }
    >();

    const debtsSnapshot = openDebts.map((d) => {
      const localPayload = buildVietQRPayload({ amount: d.amount_due_vnd, addInfo: d.order_code });
      const transferText = formatTransferReminderText({
        customerName: d.customer_name,
        orderCode: d.order_code,
        amountVnd: d.amount_due_vnd,
        notes: d.notes,
      });
      verifiedDebtUrlMap.set(d.order_code.toUpperCase(), {
        vietqrUrl: localPayload,
        customerName: d.customer_name,
        channelHandle: d.channel_handle,
        amountDueVnd: d.amount_due_vnd,
      });
      return {
        orderCode: d.order_code,
        customerName: d.customer_name,
        channelHandle: d.channel_handle,
        amountDueVnd: d.amount_due_vnd,
        notes: d.notes,
        transferGuide: transferText,
        vietqrUrl: '',
      };
    });

    const operationalSnapshot = {
      paidOrderCount: paidOrders.length,
      paidRevenueVnd,
      cashCollectedVnd,
      transferCollectedVnd,
      pendingOrderCount: pendingOrders.length,
      pendingAmountVnd,
      unpaidDebtCount: openDebts.length,
      unpaidDebtVnd,
      flaggedReceiptCount: flaggedReceipts.length,
      topSellingItems: topSelling.map((m) => ({
        sku: m.sku,
        name: m.name,
        dailySoldCount: m.daily_sold_count,
        priceVnd: m.price_vnd,
      })),
      slowMovingItems: slowMoving.map((m) => ({
        sku: m.sku,
        name: m.name,
        dailySoldCount: m.daily_sold_count,
        priceVnd: m.price_vnd,
      })),
      unpaidDebts: debtsSnapshot,
    };

    const systemPrompt = [
      'Bạn là Trợ lý Điều hành thông minh (Merchant AI Copilot) cho chủ quán "Tiệm Cà Phê Mộc".',
      'Trả lời hoàn toàn bằng tiếng Việt tự nhiên, súc tích, thân thiện và bám sát tuyệt đối số liệu thật dưới đây (không bịa số).',
      'Quy tắc bắt buộc:',
      '- Liệt kê các công cụ logic bạn đã tham chiếu vào `invokedTools` (`get_daily_revenue`, `get_slow_moving_items`, `get_unpaid_debts`).',
      '- Nếu có món bán chậm (dailySoldCount <= 5), điền `slowMovingItems` kèm gợi ý đẩy combo giờ chiều thực tế.',
      '- Với mỗi khách đang nợ trong `unpaidDebts`, khi người dùng hỏi về công nợ/nhắc nợ hoặc tổng kết vận hành, hãy soạn tin nhắn Zalo/Messenger lịch sự, dễ thương để chủ quán copy gửi ngay vào `debtReminders` kèm đúng `orderCode` (KHÔNG chèn bất kỳ đường link URL https://img.vietqr.io/... nào vào `messageVi`; có thể nêu rõ ngân hàng/STK/nội dung CK nếu cần).',
      '- Mọi số tiền hiển thị trong văn bản dùng định dạng Việt Nam (vd: 96.000 ₫).',
      `Dữ liệu vận hành trực tiếp từ PostgreSQL: ${JSON.stringify(operationalSnapshot)}`,
    ].join('\n');

    const aiResponse = await generateStructuredJSON({
      systemPrompt,
      userPrompt: `Yêu cầu của chủ quán: "${prompt}"`,
      schema: CopilotActionSchema,
    });

    // Enforce authentic VietQR links & server VND numbers so AI cannot alter bank account details
    const normalizedReminders = aiResponse.debtReminders.map((rem) => {
      const dbMatch = verifiedDebtUrlMap.get(rem.orderCode.trim().toUpperCase());
      return dbMatch
        ? {
            ...rem,
            orderCode: rem.orderCode.trim().toUpperCase(),
            customerName: dbMatch.customerName,
            channelHandle: dbMatch.channelHandle,
            amountDueVnd: dbMatch.amountDueVnd,
            vietqrUrl: dbMatch.vietqrUrl,
          }
        : rem;
    });

    const copilot = {
      ...aiResponse,
      debtReminders: normalizedReminders,
    };

    return NextResponse.json(
      {
        ok: true,
        copilot,
        metrics: {
          paidRevenueVnd,
          paidRevenueFormatted: formatVND(paidRevenueVnd),
          cashCollectedVnd,
          transferCollectedVnd,
          pendingOrderCount: pendingOrders.length,
          pendingAmountVnd,
          unpaidDebtCount: openDebts.length,
          unpaidDebtVnd,
          flaggedReceiptCount: flaggedReceipts.length,
          slowMovingCount: slowMoving.length,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof SupabaseConfigError) {
      return NextResponse.json({ ok: false, error: 'SUPABASE_NOT_CONFIGURED', message: err.message }, { status: 503 });
    }
    if (err instanceof AIProviderError) {
      const status = err.code === 'PROVIDER_NOT_CONFIGURED' ? 503 : 502;
      return NextResponse.json(
        { ok: false, error: err.code, message: `Lỗi AI Copilot (${err.provider}): ${err.message}` },
        { status }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'COPILOT_FAILED',
        message: err instanceof Error ? err.message : 'Trợ lý điều hành gặp lỗi xử lý.',
      },
      { status: 500 }
    );
  }
}
