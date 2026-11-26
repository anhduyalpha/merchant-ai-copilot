import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AIProviderError, generateStructuredJSON } from '@/lib/ai/provider';
import { ParsedOrderSchema } from '@/lib/ai/schemas';
import {
  normalizeAndCalculateOrder,
  persistOrderToSupabase,
  sanitizeImageMimeType,
} from '@/lib/orders';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import { buildVietQRUrl, formatVND } from '@/lib/vietqr';
import type { MenuItemRow } from '@/types/database';

const ParseOrderRequestSchema = z.object({
  inputType: z.enum(['chat', 'handwritten', 'voice']),
  text: z.string().max(4000).optional(),
  imageBase64: z.string().max(14_000_000).optional(),
  imageMimeType: z.string().max(40).optional(),
  autoSave: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  let rawText = '';
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY', message: 'Không đọc được nội dung yêu cầu.' },
      { status: 400 }
    );
  }

  if (Buffer.byteLength(rawText, 'utf8') > 15_000_000) {
    return NextResponse.json(
      { ok: false, error: 'PAYLOAD_TOO_LARGE', message: 'Ảnh hoặc dữ liệu vượt quá 15MB.' },
      { status: 413 }
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_JSON', message: 'Dữ liệu gửi lên không phải JSON hợp lệ.' },
      { status: 400 }
    );
  }

  const parsedInput = ParseOrderRequestSchema.safeParse(bodyJson);
  if (!parsedInput.success) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION_ERROR', message: 'Tham số đầu vào không hợp lệ.' },
      { status: 400 }
    );
  }

  const { inputType, text, imageBase64, imageMimeType, autoSave } = parsedInput.data;
  const cleanText = text?.trim() ?? '';
  const hasImage = Boolean(imageBase64 && imageBase64.trim().length > 0);

  if (!cleanText && !hasImage) {
    return NextResponse.json(
      {
        ok: false,
        error: 'EMPTY_INPUT',
        message: 'Vui lòng nhập nội dung đơn hàng hoặc chọn ảnh giấy ghi tay.',
      },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: menuData, error: menuErr } = await supabase
      .from('menu_items')
      .select('*')
      .eq('is_available', true);

    if (menuErr) {
      return NextResponse.json(
        { ok: false, error: 'DB_ERROR', message: 'Không tải được thực đơn từ Supabase.' },
        { status: 500 }
      );
    }

    const menuItems = (menuData ?? []) as MenuItemRow[];
    const menuCatalogJson = JSON.stringify(
      menuItems.map((m) => ({
        sku: m.sku,
        name: m.name,
        price_vnd: m.price_vnd,
        aliases: m.aliases,
      }))
    );

    const systemPrompt = [
      'Bạn là trợ lý nhận đơn POS tiếng Việt cho quán cà phê.',
      'Hãy đối chiếu tin nhắn tiếng lóng, giọng nói hoặc ảnh giấy ghi tay với danh sách thực đơn (kèm aliases) dưới đây.',
      'Quy tắc bắt buộc:',
      '- Luôn ưu tiên khớp đúng `sku`, `matchedItemName`, `unitPriceVnd` từ thực đơn.',
      '- Bóc tách rõ `modifiers` (vd: ít ngọt, nhiều đá, nóng giòn, không thạch).',
      '- Nếu khách yêu cầu tách món trả tiền mặt (vd: "tách 1 trà đào tính tiền mặt") -> đặt `paymentSplitTag: "cash"`, `paymentMethod: "split"`, cộng `cashAmountVnd` và `transferAmountVnd` khớp `totalVnd`.',
      '- Nếu khách hẹn ghi sổ ("ghi sổ", "cuối ngày chuyển", "nợ") -> đặt `paymentMethod: "debt"`, `cashAmountVnd: 0`, `transferAmountVnd: 0`.',
      '- Nếu có giảm giá khách quen (vd: "giảm 5k", "giảm 10k") -> điền `discountVnd` nguyên đồng (vd: 5000, 10000) và `discountReason`.',
      '- Mọi số tiền là số nguyên VND không dấu phẩy.',
      `Thực đơn hiện có: ${menuCatalogJson}`,
    ].join('\n');

    const userPrompt = hasImage
      ? `Loại đầu vào: ${inputType}. Đọc toàn bộ món, số lượng, ghi chú, giảm giá và phương thức thanh toán từ ảnh đơn viết tay.${cleanText ? ` Ghi chú thêm: ${cleanText}` : ''}`
      : `Loại đầu vào: ${inputType}. Phân tích đơn hàng sau thành JSON chuẩn:\n"${cleanText}"`;

    const aiParsed = await generateStructuredJSON({
      systemPrompt,
      userPrompt,
      imageBase64: hasImage ? imageBase64 : undefined,
      imageMimeType: hasImage ? sanitizeImageMimeType(imageMimeType) : undefined,
      schema: ParsedOrderSchema,
    });

    const normalized = normalizeAndCalculateOrder(aiParsed, menuItems);

    const splitNote =
      normalized.paymentMethod === 'split'
        ? `Tách thanh toán: Tiền mặt ${formatVND(normalized.cashAmountVnd)} + VietQR ${formatVND(normalized.transferAmountVnd)}.`
        : normalized.paymentMethod === 'debt'
          ? `Ghi sổ khách quen ${formatVND(normalized.totalVnd)}.`
          : normalized.paymentMethod === 'cash'
            ? `Thu tiền mặt ${formatVND(normalized.totalVnd)}.`
            : `Tạo mã VietQR ${formatVND(normalized.transferAmountVnd)}.`;

    const reasoningVi = [
      `Đã khớp ${normalized.items.length} dòng món (${normalized.items.reduce((s, i) => s + i.quantity, 0)} phần) từ ${inputType === 'handwritten' ? 'ảnh viết tay' : inputType === 'voice' ? 'giọng nói' : 'tin nhắn'}.`,
      normalized.discountVnd > 0
        ? `Áp dụng giảm ${formatVND(normalized.discountVnd)}${normalized.discountReason ? ` (${normalized.discountReason})` : ''}.`
        : null,
      splitNote,
    ]
      .filter(Boolean)
      .join(' ');

    if (autoSave) {
      const persisted = await persistOrderToSupabase(supabase, {
        draft: normalized,
        sourceType: inputType,
        rawInput: cleanText || '[Ảnh giấy ghi tay]',
      });
      return NextResponse.json(
        {
          ok: true,
          saved: true,
          parsed: normalized,
          customerLabel: normalized.customerName || normalized.tableOrChannel,
          reasoning: reasoningVi,
          reasoningVi,
          order: persisted.order,
          items: persisted.items,
          vietqrUrl: persisted.vietqrUrl,
        },
        { status: 200 }
      );
    }

    const qrAmount =
      normalized.paymentMethod === 'split'
        ? normalized.transferAmountVnd
        : normalized.paymentMethod === 'vietqr' || normalized.paymentMethod === 'debt'
          ? normalized.totalVnd
          : 0;
    const previewVietqrUrl =
      qrAmount > 0 ? buildVietQRUrl({ amount: qrAmount, addInfo: 'TAM TINH DON MOI' }) : null;

    return NextResponse.json(
      {
        ok: true,
        saved: false,
        parsed: normalized,
        customerLabel: normalized.customerName || normalized.tableOrChannel,
        reasoning: reasoningVi,
        reasoningVi,
        previewVietqrUrl,
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
        { ok: false, error: err.code, message: `Lỗi AI (${err.provider}): ${err.message}` },
        { status }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'ORDER_PARSE_FAILED',
        message: err instanceof Error ? err.message : 'Không thể phân tích đơn hàng.',
      },
      { status: 500 }
    );
  }
}
