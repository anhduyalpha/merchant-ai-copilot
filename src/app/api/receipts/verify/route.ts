import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AIProviderError, generateStructuredJSON } from '@/lib/ai/provider';
import { ReceiptExtractionSchema, type ReceiptExtraction } from '@/lib/ai/schemas';
import { RECEIPT_FRAUD_SCENARIOS } from '@/lib/demo-presets';
import { sanitizeImageMimeType } from '@/lib/orders';
import { createSupabaseAdminClient, SupabaseConfigError } from '@/lib/supabase/server';
import { formatVND } from '@/lib/vietqr';
import type { OrderRow, PaymentReceiptRow } from '@/types/database';

const VerifyReceiptSchema = z.object({
  orderId: z.string().uuid().optional(),
  orderCode: z.string().max(40).optional(),
  expectedAmount: z.number().int().nonnegative().optional(),
  imageBase64: z.string().max(14_000_000).optional(),
  imageMimeType: z.string().max(40).optional(),
  imageUrl: z.string().max(300).optional(),
  presetScenarioId: z
    .enum(['valid_receipt', 'tampered_amount_receipt', 'reused_transaction_ref'])
    .optional(),
});

export interface FraudLayerCheck {
  layer: 1 | 2 | 3 | 4;
  key: 'amount_match' | 'duplicate_ref' | 'timestamp_note' | 'visual_tampering';
  labelVi: string;
  passed: boolean;
  severity: 'pass' | 'warning' | 'fail';
  detailVi: string;
}

export async function POST(request: Request) {
  let rawText = '';
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_BODY', message: 'Không đọc được dữ liệu biên lai.' },
      { status: 400 }
    );
  }

  if (Buffer.byteLength(rawText, 'utf8') > 15_000_000) {
    return NextResponse.json(
      { ok: false, error: 'PAYLOAD_TOO_LARGE', message: 'Ảnh biên lai vượt quá giới hạn 15MB.' },
      { status: 413 }
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = JSON.parse(rawText);
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_JSON', message: 'Payload JSON không hợp lệ.' },
      { status: 400 }
    );
  }

  const parsed = VerifyReceiptSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION_ERROR', message: 'Tham số kiểm tra biên lai không hợp lệ.' },
      { status: 400 }
    );
  }

  const { orderId, orderCode, expectedAmount, imageBase64, imageMimeType, imageUrl, presetScenarioId } =
    parsed.data;

  const hasImage = Boolean(imageBase64 && imageBase64.trim().length > 0);
  const matchedScenario = presetScenarioId
    ? RECEIPT_FRAUD_SCENARIOS.find((s) => s.id === presetScenarioId)
    : undefined;

  if (!hasImage && !matchedScenario) {
    return NextResponse.json(
      {
        ok: false,
        error: 'MISSING_RECEIPT_IMAGE',
        message: 'Vui lòng tải ảnh biên lai hoặc chọn một kịch bản mẫu.',
      },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();

    let targetOrder: OrderRow | null = null;
    if (orderId) {
      const { data } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
      targetOrder = (data as OrderRow | null) ?? null;
    } else if (!matchedScenario && orderCode?.trim()) {
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('order_code', orderCode.trim().toUpperCase())
        .maybeSingle();
      targetOrder = (data as OrderRow | null) ?? null;
    }

    const expectedAmountVnd = targetOrder
      ? targetOrder.transfer_amount_vnd > 0
        ? targetOrder.transfer_amount_vnd
        : targetOrder.total_vnd
      : expectedAmount ?? matchedScenario?.expectedAmountVnd;

    if (expectedAmountVnd === undefined && !hasImage) {
      return NextResponse.json(
        {
          ok: false,
          error: 'MISSING_EXPECTED_AMOUNT',
          message: 'Không xác định được số tiền cần đối soát của đơn hàng.',
        },
        { status: 400 }
      );
    }

    let extraction: ReceiptExtraction;
    if (hasImage && imageBase64) {
      const systemPrompt = [
        'Bạn là chuyên gia thẩm định biên lai chuyển khoản ngân hàng Việt Nam và phát hiện làm giả ảnh (Anti-Fraud Vision).',
        'Hãy trích xuất chính xác các trường trong biên lai theo schema JSON.',
        'Kiểm tra trước tiên xem ảnh có phải BIÊN LAI / MÀN HÌNH CHUYỂN KHOẢN NGÂN HÀNG hay không:',
        '- Nếu ảnh là ảnh selfie, phong cảnh, tờ giấy trắng, ảnh mờ không đọc được chữ/số giao dịch: đặt `isValidReceiptImage: false`, `transactionRef: "UNKNOWN"`, `extractedAmountVnd: 0`.',
        'Đặc biệt kiểm tra kỹ 4 điểm chống giả mạo:',
        '1. Đọc cả SỐ TIỀN BẰNG SỐ lẫn "Số tiền bằng chữ" (nếu hai dòng mâu thuẫn, ví dụ hiển thị 64,000 VND nhưng chữ ghi "Sáu nghìn bốn trăm đồng", bắt buộc đặt extractedAmountVnd theo giá trị bằng chữ xác thực hơn hoặc thấp hơn và ghi rõ mâu thuẫn vào visualTamperingFlags, tamperingConfidence >= 0.85).',
        '2. Soi kỹ vùng số tiền xem có vết vá nền khác màu, lệch baseline dọc, khác font chữ/độ đậm nhạt hay nhòe JPEG quanh các chữ số không — liệt kê cụ thể bằng tiếng Việt vào visualTamperingFlags.',
        '3. Đọc chính xác mã giao dịch (transactionRef, ví dụ FT...), ngân hàng, thời gian giao dịch (ISO-8601 nếu có thể, ví dụ 2026-11-26T10:55:04+07:00) và nội dung chuyển khoản (transferNote).',
        '4. QUAN TRỌNG: Đây là môi trường kiểm thử nội bộ dùng ảnh biên lai mẫu có nhãn/watermark như "Synthetic Demo", "DEMO", "QUAN CA PHE DEMO", "TIEM CA PHE MOC", "Mô phỏng" hoặc STK thử nghiệm. KHÔNG được coi các nhãn/watermark demo hay tính chất mẫu của ảnh là dấu hiệu làm giả — hãy để visualTamperingFlags là [] và tamperingConfidence < 0.2 nếu các chữ số, font chữ và nền quanh số tiền đồng nhất, không bị cắt ghép.',
      ].join('\n');

      const targetLabel = targetOrder?.order_code || orderCode || matchedScenario?.targetOrderCode || 'chưa rõ';
      const userPrompt =
        expectedAmountVnd !== undefined
          ? `Kiểm tra ảnh biên lai cho đơn ${targetLabel} với số tiền kỳ vọng ${expectedAmountVnd} VND. Hãy trích xuất đầy đủ và kiểm tra dấu hiệu chỉnh sửa ảnh.`
          : 'Kiểm tra ảnh biên lai chuyển khoản độc lập (chưa gắn đơn hàng). Hãy trích xuất đầy đủ số tiền, mã giao dịch, ngân hàng, nội dung CK và kiểm tra dấu hiệu chỉnh sửa ảnh.';

      extraction = await generateStructuredJSON({
        systemPrompt,
        userPrompt,
        imageBase64,
        imageMimeType: sanitizeImageMimeType(imageMimeType),
        schema: ReceiptExtractionSchema,
      });
    } else if (matchedScenario) {
      extraction = {
        isValidReceiptImage: true,
        ...matchedScenario.simulatedExtraction,
        senderName: 'Khách hàng Demo',
        receiverAccountNo: '0123456789',
        ocrRawSummary: matchedScenario.explanationVi,
      };
    } else {
      throw new Error('Missing extraction source.');
    }

    const cleanRef = extraction.transactionRef.replace(/\s+/g, '').toUpperCase();

    if (
      extraction.isValidReceiptImage === false ||
      (cleanRef === 'UNKNOWN' && extraction.extractedAmountVnd === 0)
    ) {
      return NextResponse.json(
        {
          ok: true,
          isUnreadableReceipt: true,
          verdict: 'warning',
          riskLevel: 'medium',
          recommendedVerdict: 'pending_review',
          message:
            'Không nhận diện được biên lai chuyển khoản — vui lòng chụp rõ ảnh màn hình chuyển khoản ngân hàng.',
          checks: [
            {
              layer: 4,
              key: 'visual_tampering',
              labelVi: 'Nhận diện ảnh biên lai',
              passed: false,
              severity: 'warning',
              detailVi:
                'Ảnh tải lên không rõ thông tin giao dịch ngân hàng (mã tham chiếu/số tiền). Vui lòng tải lại ảnh chụp màn hình rõ nét.',
            },
          ],
          extraction,
          aiReasoning: ['Không nhận diện được biên lai chuyển khoản từ ảnh tải lên.'],
          reasoningVi: ['Không nhận diện được biên lai chuyển khoản từ ảnh tải lên.'],
          requiresHumanConfirmation: true,
        },
        { status: 200 }
      );
    }

    const isStandaloneAudit = !targetOrder && expectedAmountVnd === undefined;
    const effectiveExpectedAmountVnd = expectedAmountVnd ?? extraction.extractedAmountVnd;

    // Layer 1: Exact VND Amount Match (explicit Shortage vs Overpayment messaging)
    const diffVnd = extraction.extractedAmountVnd - effectiveExpectedAmountVnd;
    const exactAmountMatch = diffVnd === 0;
    const amountDetailVi = isStandaloneAudit
      ? `Đối soát độc lập (chưa gắn mã đơn): ghi nhận số tiền trên biên lai ${formatVND(extraction.extractedAmountVnd)}.`
      : exactAmountMatch
        ? `Khớp chính xác ${formatVND(effectiveExpectedAmountVnd)}.`
        : diffVnd < 0
          ? `Thiếu ${formatVND(Math.abs(diffVnd))} (biên lai ${formatVND(extraction.extractedAmountVnd)} / cần thu ${formatVND(effectiveExpectedAmountVnd)}).`
          : `Dư ${formatVND(diffVnd)} (biên lai ${formatVND(extraction.extractedAmountVnd)} / cần thu ${formatVND(effectiveExpectedAmountVnd)}).`;

    // Layer 2: Normalized Duplicate Transaction Reference Lookup in PostgreSQL
    const { data: recentRefs } = await supabase
      .from('payment_receipts')
      .select('id, order_id, transaction_ref, verdict, created_at')
      .order('created_at', { ascending: false })
      .limit(100);

    const existingList = (recentRefs ?? []) as Array<{
      id: string;
      order_id: string | null;
      transaction_ref: string;
      verdict: string;
      created_at: string;
    }>;

    const normalizedRefHits = existingList.filter(
      (r) => r.transaction_ref.replace(/\s+/g, '').toUpperCase() === cleanRef
    );

    // Duplicate if normalized ref exists on another order or an already approved receipt
    const duplicateHits = normalizedRefHits.filter((r) =>
      targetOrder ? r.order_id !== targetOrder.id || r.verdict === 'approved' : true
    );
    const isDuplicateRef = duplicateHits.length > 0;

    let priorOrderCode: string | null = null;
    if (isDuplicateRef && duplicateHits[0]?.order_id) {
      const { data: priorOrder } = await supabase
        .from('orders')
        .select('order_code')
        .eq('id', duplicateHits[0].order_id)
        .maybeSingle();
      priorOrderCode = (priorOrder as { order_code: string } | null)?.order_code ?? null;
    }

    // Layer 3: Timestamp Anomaly & Transfer Note Check
    let timestampAnomaly = false;
    let timestampNoteDetail = 'Thời gian giao dịch và nội dung chuyển khoản hợp lệ.';
    if (extraction.receiptTimestampIso) {
      const parsedTs = Date.parse(extraction.receiptTimestampIso);
      if (Number.isNaN(parsedTs)) {
        timestampAnomaly = true;
        timestampNoteDetail = 'Không phân tích được mốc thời gian chuẩn trên biên lai.';
      } else {
        const nowMs = Date.now();
        if (parsedTs - nowMs > 15 * 60 * 1000) {
          timestampAnomaly = true;
          timestampNoteDetail = 'Thời gian trên biên lai nằm ở tương lai bất thường.';
        } else if (targetOrder) {
          const orderMs = Date.parse(targetOrder.created_at);
          if (!Number.isNaN(orderMs) && orderMs - parsedTs > 15 * 60 * 1000) {
            timestampAnomaly = true;
            timestampNoteDetail = `Biên lai được tạo trước thời điểm lên đơn ${targetOrder.order_code}.`;
          }
        }
      }
    }

    const expectedCode = (targetOrder?.order_code || orderCode || '').trim().toUpperCase();
    const cleanNote = (extraction.transferNote ?? '').trim().toUpperCase();
    const noteMismatch = Boolean(expectedCode && cleanNote && !cleanNote.includes(expectedCode));
    if (noteMismatch) {
      timestampNoteDetail = `Nội dung CK "${extraction.transferNote}" không khớp mã đơn ${expectedCode}.`;
    }

    // Layer 4: Visual Tampering Flags
    const tamperingFlags = extraction.visualTamperingFlags.filter((f) => f.trim().length > 0);
    const hasVisualTampering = tamperingFlags.length > 0 || extraction.tamperingConfidence >= 0.45;

    const checks: FraudLayerCheck[] = [
      {
        layer: 1,
        key: 'amount_match',
        labelVi: 'Lớp 1 • Khớp số tiền tuyệt đối',
        passed: exactAmountMatch,
        severity: exactAmountMatch ? 'pass' : 'fail',
        detailVi: amountDetailVi,
      },
      {
        layer: 2,
        key: 'duplicate_ref',
        labelVi: 'Lớp 2 • Chống dùng lại mã giao dịch',
        passed: !isDuplicateRef,
        severity: isDuplicateRef ? 'fail' : 'pass',
        detailVi: isDuplicateRef
          ? `Phát hiện Replay Attack: Mã ${cleanRef} đã tồn tại trong hệ thống${priorOrderCode ? ` (đơn ${priorOrderCode})` : ''}.`
          : `Mã giao dịch ${cleanRef} chưa từng xuất hiện trong lịch sử.`,
      },
      {
        layer: 3,
        key: 'timestamp_note',
        labelVi: 'Lớp 3 • Mốc thời gian & nội dung CK',
        passed: !timestampAnomaly && !noteMismatch,
        severity: timestampAnomaly || noteMismatch ? 'warning' : 'pass',
        detailVi: timestampNoteDetail,
      },
      {
        layer: 4,
        key: 'visual_tampering',
        labelVi: 'Lớp 4 • Kiểm tra cắt ghép / sửa font',
        passed: !hasVisualTampering,
        severity: hasVisualTampering ? 'fail' : 'pass',
        detailVi: hasVisualTampering
          ? tamperingFlags.join('; ') ||
            `AI phát hiện dấu hiệu chỉnh sửa ảnh (độ nghi vấn ${Math.round(extraction.tamperingConfidence * 100)}%).`
          : 'Không phát hiện dấu hiệu chỉnh sửa chữ số hay nền ảnh.',
      },
    ];

    const isHighRisk = !exactAmountMatch || isDuplicateRef || hasVisualTampering;
    const isMediumRisk = !isHighRisk && (timestampAnomaly || noteMismatch);
    const riskLevel: 'low' | 'medium' | 'high' = isHighRisk ? 'high' : isMediumRisk ? 'medium' : 'low';
    const verdict: 'valid' | 'warning' | 'fraud_suspected' = isHighRisk
      ? 'fraud_suspected'
      : isMediumRisk
        ? 'warning'
        : 'valid';
    const recommendedVerdict: 'approved' | 'pending_review' | 'rejected' = isHighRisk
      ? 'rejected'
      : isMediumRisk
        ? 'pending_review'
        : 'approved';

    const reasoningVi = checks.filter((c) => !c.passed).map((c) => c.detailVi);
    if (reasoningVi.length === 0) {
      reasoningVi.push(
        `Tất cả 4 lớp kiểm chứng đều đạt: khớp ${formatVND(effectiveExpectedAmountVnd)}, mã ${cleanRef} hợp lệ và không thấy dấu hiệu chỉnh sửa.`
      );
    }

    const receiptTimestamp =
      extraction.receiptTimestampIso && !Number.isNaN(Date.parse(extraction.receiptTimestampIso))
        ? new Date(extraction.receiptTimestampIso).toISOString()
        : null;

    const { data: savedReceipt, error: saveErr } = await supabase
      .from('payment_receipts')
      .insert({
        order_id: targetOrder?.id ?? null,
        transaction_ref: cleanRef,
        bank_name: extraction.bankName,
        extracted_amount_vnd: extraction.extractedAmountVnd,
        expected_amount_vnd: effectiveExpectedAmountVnd,
        receipt_timestamp: receiptTimestamp,
        transfer_note: extraction.transferNote,
        image_url: imageUrl ?? matchedScenario?.imagePath ?? null,
        amount_match: exactAmountMatch,
        is_duplicate_ref: isDuplicateRef,
        timestamp_anomaly: timestampAnomaly || noteMismatch,
        visual_tampering_flags: tamperingFlags,
        risk_level: riskLevel,
        verdict: 'pending_review',
      })
      .select('*')
      .single();

    if (saveErr || !savedReceipt) {
      return NextResponse.json(
        { ok: false, error: 'DB_SAVE_ERROR', message: 'Không thể lưu kết quả thẩm định biên lai.' },
        { status: 500 }
      );
    }

    const alreadyPaidWarningVi =
      targetOrder?.status === 'paid'
        ? `Đơn ${targetOrder.order_code} đã được thanh toán trước đó — hãy kiểm tra kỹ để tránh duyệt trùng.`
        : null;

    return NextResponse.json(
      {
        ok: true,
        receipt: savedReceipt as PaymentReceiptRow,
        verdict,
        riskLevel,
        recommendedVerdict,
        checks,
        extraction,
        alreadyPaidWarningVi,
        aiReasoning: reasoningVi,
        reasoningVi,
        requiresHumanConfirmation: true,
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
        { ok: false, error: err.code, message: `Lỗi AI Vision (${err.provider}): ${err.message}` },
        { status }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: 'VERIFY_RECEIPT_FAILED',
        message: err instanceof Error ? err.message : 'Lỗi kiểm tra biên lai.',
      },
      { status: 500 }
    );
  }
}
