import type { Database } from '@/types/database';
import { buildVietQRUrl } from '@/lib/vietqr';

type MenuItemInsert = Database['public']['Tables']['menu_items']['Insert'];
type OrderInsert = Database['public']['Tables']['orders']['Insert'];
type OrderItemInsert = Database['public']['Tables']['order_items']['Insert'];
type PaymentReceiptInsert = Database['public']['Tables']['payment_receipts']['Insert'];
type CustomerDebtInsert = Database['public']['Tables']['customer_debts']['Insert'];

export interface SlangChatPreset {
  id: string;
  label: string;
  channel: 'Zalo' | 'Facebook' | 'Tại quầy';
  rawMessage: string;
  expectedSummaryVi: string;
}

export interface VoiceTranscriptPreset {
  id: string;
  label: string;
  transcript: string;
  expectedSummaryVi: string;
}

export interface ReceiptFraudScenario {
  id: 'valid_receipt' | 'tampered_amount_receipt' | 'reused_transaction_ref';
  titleVi: string;
  badgeLabel: string;
  imagePath: string;
  targetOrderCode: string;
  expectedAmountVnd: number;
  simulatedExtraction: {
    transactionRef: string;
    bankName: string;
    extractedAmountVnd: number;
    receiptTimestampIso: string;
    transferNote: string;
    visualTamperingFlags: string[];
    tamperingConfidence: number;
  };
  expectedRiskLevel: 'low' | 'medium' | 'high';
  expectedVerdict: 'approved' | 'rejected' | 'pending_review';
  explanationVi: string;
}

/**
 * Ready-to-use Vietnamese slang chat presets for Judge Quick-Demo Mode (<60s testing).
 */
export const SLANG_CHAT_PRESETS: readonly SlangChatPreset[] = [
  {
    id: 'slang-split-discount',
    label: 'Đơn lóng tách tiền mặt/CK + giảm giá khách quen',
    channel: 'Tại quầy',
    rawMessage:
      'Bàn 3 thêm 2 bx ít ngọt, 1 cf sữa nhiều đá, khách quen giảm 10k, tách riêng 1 trà đào tính tiền mặt nha quán ơi!',
    expectedSummaryVi:
      '2 Bạc xỉu đá (64k) + 1 Cà phê sữa đá (29k) + 1 Trà đào cam sả (35k, thu tiền mặt) - giảm 10k = VietQR 83.000 ₫ & Tiền mặt 35.000 ₫',
  },
  {
    id: 'slang-zalo-office',
    label: 'Đơn Zalo văn phòng đặt gộp nhiều món viết tắt',
    channel: 'Zalo',
    rawMessage:
      'Shop ơi ship tầng 4 giúp em: 3 cf đen ko đường, 2 tdcs ít đá, 2 bmq nóng giòn. Cho em xin mã QR tổng luôn ạ.',
    expectedSummaryVi:
      '3 Cà phê đen đá (75k) + 2 Trà đào cam sả (70k) + 2 Bánh mì que pate (36k) = VietQR 181.000 ₫',
  },
  {
    id: 'slang-regular-debt',
    label: 'Đơn khách quen ghi sổ cuối ngày',
    channel: 'Facebook',
    rawMessage:
      'Chị Lan tiệm hoa đầu hẻm lấy thêm 2 matcha kem muối ít đá với 1 sc việt quất nha em, ghi sổ chiều chị chuyển gộp luôn.',
    expectedSummaryVi:
      '2 Matcha Latte kem muối (84k) + 1 Sữa chua việt quất đá xay (39k) = Ghi sổ 123.000 ₫',
  },
] as const;

/**
 * Voice order transcript presets simulating noisy counter dictation.
 */
export const VOICE_TRANSCRIPT_PRESETS: readonly VoiceTranscriptPreset[] = [
  {
    id: 'voice-rush-hour',
    label: 'Giọng đọc giờ cao điểm tại quầy',
    transcript:
      'Cho bàn số năm hai nâu đá ít sữa một trà vải hoa hồng không thạch với hai bánh mì que pate nướng kỹ tính chuyển khoản hết nhé',
    expectedSummaryVi:
      '2 Cà phê sữa đá (58k) + 1 Trà vải hoa hồng (35k) + 2 Bánh mì que pate (36k) = VietQR 129.000 ₫',
  },
  {
    id: 'voice-takeaway-split',
    label: 'Giọng đọc đơn mang đi chia tiền lẻ',
    transcript:
      'Mang về một bạc xỉu đá với một trà đào cam sả khách đưa trước hai mươi nghìn tiền mặt phần còn lại quét mã QR',
    expectedSummaryVi:
      '1 Bạc xỉu đá (32k) + 1 Trà đào cam sả (35k) = Tổng 67.000 ₫ (Tiền mặt 20.000 ₫, VietQR 47.000 ₫)',
  },
] as const;

export const HANDWRITTEN_ORDER_DEMO = {
  id: 'handwritten-table-2',
  label: 'Ảnh giấy ghi tay order Bàn 2',
  imagePath: '/demo-assets/handwritten-order-demo.png',
  expectedSummaryVi:
    '2 Cà phê sữa đá (58k) + 1 Bạc xỉu đá (32k) + 1 Bánh mì que pate (18k) = VietQR 108.000 ₫',
} as const;

/**
 * 3 Anti-Fraud Receipt Verification test scenarios for competition judges.
 */
export const RECEIPT_FRAUD_SCENARIOS: readonly ReceiptFraudScenario[] = [
  {
    id: 'valid_receipt',
    titleVi: 'Biên lai hợp lệ (Khớp số tiền & Mã GD mới)',
    badgeLabel: 'An toàn • Duyệt 1 chạm',
    imagePath: '/demo-assets/receipt-valid-new.png',
    targetOrderCode: 'DH1004',
    expectedAmountVnd: 64000,
    simulatedExtraction: {
      transactionRef: 'FT26330998899',
      bankName: 'MB Bank (Synthetic Demo)',
      extractedAmountVnd: 64000,
      receiptTimestampIso: new Date().toISOString(),
      transferNote: 'DH1004 QUAN CA PHE DEMO',
      visualTamperingFlags: [],
      tamperingConfidence: 0.03,
    },
    expectedRiskLevel: 'low',
    expectedVerdict: 'approved',
    explanationVi:
      'Khớp chính xác 64.000 ₫, mã giao dịch FT26330998899 chưa từng xuất hiện trong hệ thống, thời gian hợp lệ và không có dấu hiệu chỉnh sửa ảnh.',
  },
  {
    id: 'tampered_amount_receipt',
    titleVi: 'Biên lai sửa số tiền (Chuyển 6.400 ₫ thành 64.000 ₫)',
    badgeLabel: 'Rủi ro cao • Giả mạo số tiền',
    imagePath: '/demo-assets/receipt-tampered-6400.png',
    targetOrderCode: 'DH1004',
    expectedAmountVnd: 64000,
    simulatedExtraction: {
      transactionRef: 'FT26330998901',
      bankName: 'MB Bank (Synthetic Demo)',
      extractedAmountVnd: 6400,
      receiptTimestampIso: new Date().toISOString(),
      transferNote: 'DH1004',
      visualTamperingFlags: [
        'Lệch baseline và độ nét chữ số "0" cuối trong vùng số tiền hiển thị',
        'Nhiễu nền JPEG không đồng nhất quanh dòng số tiền (nghi ghép ảnh)',
      ],
      tamperingConfidence: 0.91,
    },
    expectedRiskLevel: 'high',
    expectedVerdict: 'rejected',
    explanationVi:
      'Cảnh báo đỏ: Số tiền thực trích xuất chỉ 6.400 ₫ (thiếu 57.600 ₫ so với đơn 64.000 ₫) kèm dấu hiệu can thiệp phông chữ trên ảnh chụp màn hình.',
  },
  {
    id: 'reused_transaction_ref',
    titleVi: 'Biên lai tái sử dụng mã giao dịch cũ (FT26330998811)',
    badgeLabel: 'Rủi ro cao • Trùng mã GD cũ',
    imagePath: '/demo-assets/receipt-dh1001-valid.png',
    targetOrderCode: 'DH1005',
    expectedAmountVnd: 64000,
    simulatedExtraction: {
      transactionRef: 'FT26330998811',
      bankName: 'MB Bank (Synthetic Demo)',
      extractedAmountVnd: 64000,
      receiptTimestampIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      transferNote: 'DH1001',
      visualTamperingFlags: [],
      tamperingConfidence: 0.08,
    },
    expectedRiskLevel: 'high',
    expectedVerdict: 'rejected',
    explanationVi:
      'Chặn gian lận dùng lại bill cũ: Mã giao dịch FT26330998811 đã được duyệt cho đơn DH1001 trước đó 2 giờ.',
  },
] as const;

/**
 * Canonical synthetic seed dataset mirrored with supabase/schema.sql for POST /api/demo/reset.
 */
export function buildSyntheticSeedDataset(): {
  menuItems: MenuItemInsert[];
  orders: OrderInsert[];
  orderItems: OrderItemInsert[];
  paymentReceipts: PaymentReceiptInsert[];
  customerDebts: CustomerDebtInsert[];
} {
  const now = Date.now();
  const twoHoursAgoIso = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const reviewedIso = new Date(now - 119 * 60 * 1000).toISOString();
  const todayDate = new Date(now).toISOString().slice(0, 10);

  const menuItems: MenuItemInsert[] = [
    {
      id: '11111111-1111-4111-8111-111111111101',
      sku: 'CF-SUA',
      name: 'Cà phê sữa đá',
      category: 'coffee',
      price_vnd: 29000,
      aliases: ['cf sữa', 'cf sua', 'cà phê sữa', 'nâu đá', 'nau da', 'cafe sua da'],
      is_available: true,
      daily_sold_count: 34,
    },
    {
      id: '11111111-1111-4111-8111-111111111102',
      sku: 'CF-DEN',
      name: 'Cà phê đen đá',
      category: 'coffee',
      price_vnd: 25000,
      aliases: ['cf đen', 'cf den', 'đen đá', 'den da', 'cafe den'],
      is_available: true,
      daily_sold_count: 22,
    },
    {
      id: '11111111-1111-4111-8111-111111111103',
      sku: 'BAC-XIU',
      name: 'Bạc xỉu đá',
      category: 'coffee',
      price_vnd: 32000,
      aliases: ['bx', 'bạc xỉu', 'bac xiu', 'bạc sỉu', 'cf nhiều sữa'],
      is_available: true,
      daily_sold_count: 28,
    },
    {
      id: '11111111-1111-4111-8111-111111111104',
      sku: 'TRA-DAO',
      name: 'Trà đào cam sả',
      category: 'tea',
      price_vnd: 35000,
      aliases: ['trà đào', 'tra dao', 'tdcs', 'đào cam sả', 'tra dao cam sa'],
      is_available: true,
      daily_sold_count: 19,
    },
    {
      id: '11111111-1111-4111-8111-111111111105',
      sku: 'TRA-VAI',
      name: 'Trà vải hoa hồng',
      category: 'tea',
      price_vnd: 35000,
      aliases: ['trà vải', 'tra vai', 'vải hồng', 'tra vai hoa hong'],
      is_available: true,
      daily_sold_count: 3,
    },
    {
      id: '11111111-1111-4111-8111-111111111106',
      sku: 'MATCHA-LATTE',
      name: 'Matcha Latte kem muối',
      category: 'milk_tea',
      price_vnd: 42000,
      aliases: ['matcha', 'trà xanh sữa', 'matcha kem muối', 'matcha latte'],
      is_available: true,
      daily_sold_count: 14,
    },
    {
      id: '11111111-1111-4111-8111-111111111107',
      sku: 'SC-VIET-QUAT',
      name: 'Sữa chua việt quất đá xay',
      category: 'milk_tea',
      price_vnd: 39000,
      aliases: ['sc việt quất', 'sữa chua vq', 'sua chua viet quat'],
      is_available: true,
      daily_sold_count: 1,
    },
    {
      id: '11111111-1111-4111-8111-111111111108',
      sku: 'BANH-MI-QUE',
      name: 'Bánh mì que pate Hải Phòng',
      category: 'pastry',
      price_vnd: 18000,
      aliases: ['bmq', 'bánh mì que', 'banh mi que', 'pate que'],
      is_available: true,
      daily_sold_count: 11,
    },
  ];

  const qrDh1001 = buildVietQRUrl({ amount: 64000, addInfo: 'DH1001' });
  const qrDh1002 = buildVietQRUrl({ amount: 96000, addInfo: 'DH1002' });
  const qrDh1003 = buildVietQRUrl({ amount: 77000, addInfo: 'DH1003' });

  const orders: OrderInsert[] = [
    {
      id: '22222222-2222-4222-8222-222222222201',
      order_code: 'DH1001',
      table_or_channel: 'Bàn 1',
      customer_name: 'Khách lẻ Bàn 1 (Demo)',
      source_type: 'chat',
      raw_input: 'Cho bàn 1 1 cf sữa ít đá với 1 trà đào nha shop',
      subtotal_vnd: 64000,
      discount_vnd: 0,
      total_vnd: 64000,
      cash_amount_vnd: 0,
      transfer_amount_vnd: 64000,
      payment_method: 'vietqr',
      status: 'paid',
      vietqr_url: qrDh1001,
      notes: 'Đã đối soát biên lai hợp lệ FT26330998811',
    },
    {
      id: '22222222-2222-4222-8222-222222222202',
      order_code: 'DH1002',
      table_or_channel: 'Zalo OA',
      customer_name: 'Anh Minh Thiết Kế (Demo)',
      source_type: 'chat',
      raw_input: 'Em ơi ship sang studio cho anh 3 bx ít ngọt nhé, cuối chiều anh ck gộp luôn',
      subtotal_vnd: 96000,
      discount_vnd: 0,
      total_vnd: 96000,
      cash_amount_vnd: 0,
      transfer_amount_vnd: 0,
      payment_method: 'debt',
      status: 'debt',
      vietqr_url: qrDh1002,
      notes: 'Khách quen studio cạnh quán ghi sổ cuối ngày',
    },
    {
      id: '22222222-2222-4222-8222-222222222203',
      order_code: 'DH1003',
      table_or_channel: 'Facebook Messenger',
      customer_name: 'Chị Lan Tiệm Hoa (Demo)',
      source_type: 'chat',
      raw_input: 'Cho chị 1 matcha kem muối với 1 trà đào qua tiệm hoa nhé, ghi sổ giúp chị nha',
      subtotal_vnd: 77000,
      discount_vnd: 0,
      total_vnd: 77000,
      cash_amount_vnd: 0,
      transfer_amount_vnd: 0,
      payment_method: 'debt',
      status: 'debt',
      vietqr_url: qrDh1003,
      notes: 'Khách quen tiệm hoa đầu hẻm',
    },
  ];

  const orderItems: OrderItemInsert[] = [
    {
      order_id: '22222222-2222-4222-8222-222222222201',
      menu_item_id: '11111111-1111-4111-8111-111111111101',
      item_name: 'Cà phê sữa đá',
      quantity: 1,
      unit_price_vnd: 29000,
      modifiers: ['ít đá'],
      payment_split_tag: 'transfer',
      line_total_vnd: 29000,
    },
    {
      order_id: '22222222-2222-4222-8222-222222222201',
      menu_item_id: '11111111-1111-4111-8111-111111111104',
      item_name: 'Trà đào cam sả',
      quantity: 1,
      unit_price_vnd: 35000,
      modifiers: [],
      payment_split_tag: 'transfer',
      line_total_vnd: 35000,
    },
    {
      order_id: '22222222-2222-4222-8222-222222222202',
      menu_item_id: '11111111-1111-4111-8111-111111111103',
      item_name: 'Bạc xỉu đá',
      quantity: 3,
      unit_price_vnd: 32000,
      modifiers: ['ít ngọt'],
      payment_split_tag: 'shared',
      line_total_vnd: 96000,
    },
    {
      order_id: '22222222-2222-4222-8222-222222222203',
      menu_item_id: '11111111-1111-4111-8111-111111111106',
      item_name: 'Matcha Latte kem muối',
      quantity: 1,
      unit_price_vnd: 42000,
      modifiers: [],
      payment_split_tag: 'shared',
      line_total_vnd: 42000,
    },
    {
      order_id: '22222222-2222-4222-8222-222222222203',
      menu_item_id: '11111111-1111-4111-8111-111111111104',
      item_name: 'Trà đào cam sả',
      quantity: 1,
      unit_price_vnd: 35000,
      modifiers: [],
      payment_split_tag: 'shared',
      line_total_vnd: 35000,
    },
  ];

  const paymentReceipts: PaymentReceiptInsert[] = [
    {
      id: '33333333-3333-4333-8333-333333333301',
      order_id: '22222222-2222-4222-8222-222222222201',
      transaction_ref: 'FT26330998811',
      bank_name: 'MB Bank (Synthetic Demo)',
      extracted_amount_vnd: 64000,
      expected_amount_vnd: 64000,
      receipt_timestamp: twoHoursAgoIso,
      transfer_note: 'DH1001',
      image_url: '/demo-assets/receipt-dh1001-valid.png',
      amount_match: true,
      is_duplicate_ref: false,
      timestamp_anomaly: false,
      visual_tampering_flags: [],
      risk_level: 'low',
      verdict: 'approved',
      reviewed_by: 'Chủ quán (Demo)',
      reviewed_at: reviewedIso,
    },
  ];

  const customerDebts: CustomerDebtInsert[] = [
    {
      id: '44444444-4444-4444-8444-444444444401',
      order_id: '22222222-2222-4222-8222-222222222202',
      order_code: 'DH1002',
      customer_name: 'Anh Minh Thiết Kế (Demo)',
      customer_alias: 'Anh Minh Studio',
      channel_handle: 'Zalo: 0900-000-102 (Synthetic)',
      amount_due_vnd: 96000,
      due_date: todayDate,
      status: 'unpaid',
      vietqr_url: qrDh1002,
      notes: '3 Bạc xỉu đá ít ngọt buổi chiều',
    },
    {
      id: '44444444-4444-4444-8444-444444444402',
      order_id: '22222222-2222-4222-8222-222222222203',
      order_code: 'DH1003',
      customer_name: 'Chị Lan Tiệm Hoa (Demo)',
      customer_alias: 'Chị Lan Hoa Tươi',
      channel_handle: 'Messenger: @lan.tiemhoa.demo',
      amount_due_vnd: 77000,
      due_date: todayDate,
      status: 'unpaid',
      vietqr_url: qrDh1003,
      notes: '1 Matcha Latte kem muối + 1 Trà đào cam sả',
    },
  ];

  return { menuItems, orders, orderItems, paymentReceipts, customerDebts };
}
