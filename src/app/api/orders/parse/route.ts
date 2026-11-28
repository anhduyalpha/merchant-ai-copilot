import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  detectOrderContradictions,
  parseVietnameseOrderFallback,
} from '@/lib/ai/local-order-parser';
import { AIProviderError, generateStructuredJSON } from '@/lib/ai/provider';
import { ParsedOrderSchema, type ParsedOrder } from '@/lib/ai/schemas';
import {
  normalizeAndCalculateOrder,
  persistOrderToSupabase,
  sanitizeImageMimeType,
} from '@/lib/orders';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import { buildVietQRPayload, formatVND } from '@/lib/vietqr';
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
      'Bạn là trợ lý nhận đơn POS tiếng Việt cho quán cà phê "Tiệm Cà Phê Mộc".',
      'Hãy đối chiếu tin nhắn tiếng lóng/sai chính tả, giọng nói hoặc ảnh giấy ghi tay với thực đơn dưới đây.',
      'Quy tắc bắt buộc:',
      '- Tự sửa lỗi chính tả tiếng Việt phổ biến (vd: "ít đã" -> "ít đá", "ko"/"k" -> "không", "cf"/"cfs" -> Cà phê sữa đá, "bx" -> Bạc xỉu đá, "bmq" -> Bánh mì que).',
      '- Nếu có món khớp thực đơn: điền đúng `sku`, `matchedItemName`, `unitPriceVnd`, `isUnmatched: false`.',
      '- Nếu khách gọi món KHÔNG có trong thực đơn (vd: "2 trà chanh"): vẫn giữ món đó trong `items` với `sku: null`, `unitPriceVnd: 0`, `isUnmatched: true` để thu ngân tự nhập giá hoặc đổi món.',
      '- Nếu có MÂU THUẪN hợp lý (vd: "cf sữa không có sữa", "trà đào không đào"): KHÔNG được lỗi, hãy chọn món gần nhất và thêm lời nhắc rõ ràng vào `warnings` (vd: "Khách gọi Cà phê sữa nhưng ghi không có sữa — cân nhắc đổi sang Cà phê đen đá hoặc hỏi lại khách").',
      '- Nếu tin nhắn KHÔNG chứa món ăn nào (vd: "alo quán ơi", "???", "cảm ơn"): trả về `items: []` và ghi giải thích ngắn vào `warnings`.',
      '- Tách món trả tiền mặt ("tách 1 trà đào tính tiền mặt") -> `paymentSplitTag: "cash"`, `paymentMethod: "split"`. Ghi sổ ("ghi sổ", "cuối ngày chuyển") -> `paymentMethod: "debt"`. Giảm giá ("giảm 5k", "giảm 10k") -> `discountVnd` nguyên đồng.',
      '- Mọi số tiền là số nguyên VND không dấu phẩy. Số lượng nằm trong [1, 9999].',
      `Thực đơn hiện có: ${menuCatalogJson}`,
    ].join('\n');

    const userPrompt = hasImage
      ? `Loại đầu vào: ${inputType}. Đọc toàn bộ món, số lượng, ghi chú, giảm giá và phương thức thanh toán từ ảnh đơn viết tay.${cleanText ? ` Ghi chú thêm: ${cleanText}` : ''}`
      : `Loại đầu vào: ${inputType}. Phân tích đơn hàng sau thành JSON chuẩn:\n"${cleanText}"`;

    let aiParsed: ParsedOrder;
    let fallbackUsed = false;

    try {
      aiParsed = await generateStructuredJSON({
        systemPrompt,
        userPrompt,
        imageBase64: hasImage ? imageBase64 : undefined,
        imageMimeType: hasImage ? sanitizeImageMimeType(imageMimeType) : undefined,
        schema: ParsedOrderSchema,
      });
    } catch (aiErr) {
      if (aiErr instanceof AIProviderError && !hasImage && cleanText) {
        aiParsed = parseVietnameseOrderFallback(cleanText, menuItems);
        fallbackUsed = true;
      } else {
        throw aiErr;
      }
    }

    const normalized = normalizeAndCalculateOrder(aiParsed, menuItems);

    const extraWarnings = [
      ...normalized.warnings,
      ...(cleanText ? detectOrderContradictions(cleanText, normalized.items) : []),
      ...(normalized.items.some((i) => i.isUnmatched)
        ? ['Có món chưa nằm trong thực đơn — vui lòng nhập đơn giá hoặc đổi món phù hợp.']
        : []),
    ];
    normalized.warnings = Array.from(new Set(extraWarnings));

    if (normalized.items.length === 0) {
      if (normalized.warnings.length === 0) {
        normalized.warnings = [
          'Không tìm thấy món nào trong tin nhắn — vui lòng nhập rõ tên món hoặc chọn từ thực đơn.',
        ];
      }
      return NextResponse.json(
        {
          ok: true,
          saved: false,
          fallbackUsed,
          parsed: normalized,
          parsedOrder: normalized,
          warnings: normalized.warnings,
          customerLabel: normalized.customerName || normalized.tableOrChannel,
          reasoning: normalized.warnings[0],
          reasoningVi: normalized.warnings[0],
          previewVietqrUrl: null,
        },
        { status: 200 }
      );
    }

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
          fallbackUsed,
          parsed: normalized,
          parsedOrder: normalized,
          warnings: normalized.warnings,
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
    const previewVietqrPayload =
      qrAmount > 0 ? buildVietQRPayload({ amount: qrAmount, addInfo: 'TAM TINH DON MOI' }) : null;

    return NextResponse.json(
      {
        ok: true,
        saved: false,
        fallbackUsed,
        parsed: normalized,
        parsedOrder: normalized,
        warnings: normalized.warnings,
        customerLabel: normalized.customerName || normalized.tableOrChannel,
        reasoning: reasoningVi,
        reasoningVi,
        previewVietqrUrl: previewVietqrPayload,
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
