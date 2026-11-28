import type { Database } from '@/types/database';

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
    label: 'Bàn 3 • Tách tiền mặt & CK',
    channel: 'Tại quầy',
    rawMessage:
      'Bàn 3 thêm 2 bx ít ngọt, 1 cf sữa nhiều đá, khách quen giảm 10k, tách riêng 1 trà đào tính tiền mặt nha quán ơi!',
    expectedSummaryVi:
      '2 Bạc xỉu đá (64k) + 1 Cà phê sữa đá (29k) + 1 Trà đào cam sả (35k, thu tiền mặt) - giảm 10k = VietQR 83.000 ₫ & Tiền mặt 35.000 ₫',
  },
  {
    id: 'slang-zalo-office',
    label: 'Nhóm văn phòng • Đặt nhiều món',
    channel: 'Zalo',
    rawMessage:
      'Shop ơi ship tầng 4 giúp em: 3 cf đen ko đường, 2 tdcs ít đá, 2 bmq nóng giòn. Cho em xin mã QR tổng luôn ạ.',
    expectedSummaryVi:
      '3 Cà phê đen đá (75k) + 2 Trà đào cam sả (70k) + 2 Bánh mì que pate (36k) = VietQR 181.000 ₫',
  },
  {
    id: 'slang-regular-debt',
    label: 'Khách quen • Ghi sổ',
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
    label: 'Đọc nhanh tại quầy',
    transcript:
      'Cho bàn số năm hai nâu đá ít sữa một trà vải hoa hồng không thạch với hai bánh mì que pate nướng kỹ tính chuyển khoản hết nhé',
    expectedSummaryVi:
      '2 Cà phê sữa đá (58k) + 1 Trà vải hoa hồng (35k) + 2 Bánh mì que pate (36k) = VietQR 129.000 ₫',
  },
  {
    id: 'voice-takeaway-split',
    label: 'Đơn mang đi tách tiền',
    transcript:
      'Mang về một bạc xỉu đá với một trà đào cam sả khách đưa trước hai mươi nghìn tiền mặt phần còn lại quét mã QR',
    expectedSummaryVi:
      '1 Bạc xỉu đá (32k) + 1 Trà đào cam sả (35k) = Tổng 67.000 ₫ (Tiền mặt 20.000 ₫, VietQR 47.000 ₫)',
  },
] as const;

export const HANDWRITTEN_ORDER_DEMO = {
  id: 'handwritten-table-2',
  label: 'Giấy ghi tay Bàn 2',
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
    titleVi: 'Bill hợp lệ • Khớp số tiền & mã GD mới',
    badgeLabel: 'Hợp lệ',
    imagePath: '/demo-assets/receipt-valid-new.png',
    targetOrderCode: 'DH1004',
    expectedAmountVnd: 64000,
    simulatedExtraction: {
      transactionRef: 'FT26330998899',
      bankName: 'MB Bank',
      extractedAmountVnd: 64000,
      receiptTimestampIso: new Date().toISOString(),
      transferNote: 'DH1004 TIEM CA PHE MOC',
      visualTamperingFlags: [],
      tamperingConfidence: 0.03,
    },
    expectedRiskLevel: 'low',
    expectedVerdict: 'approved',
    explanationVi:
      'Khớp chính xác 64.000 ₫, mã giao dịch FT26330998899 chưa từng xuất hiện, thời gian hợp lệ và ảnh biên lai nguyên vẹn.',
  },
  {
    id: 'tampered_amount_receipt',
    titleVi: 'Bill nghi sửa tiền • 6.400 ₫ thành 64.000 ₫',
    badgeLabel: 'Nghi sửa tiền',
    imagePath: '/demo-assets/receipt-tampered-6400.png',
    targetOrderCode: 'DH1004',
    expectedAmountVnd: 64000,
    simulatedExtraction: {
      transactionRef: 'FT26330998901',
      bankName: 'MB Bank',
      extractedAmountVnd: 6400,
      receiptTimestampIso: new Date().toISOString(),
      transferNote: 'DH1004',
      visualTamperingFlags: [
        'Lệch chân chữ và độ nét ở số "0" cuối vùng số tiền',
        'Nhiễu nền JPEG không đều quanh dòng số tiền (nghi chỉnh sửa)',
      ],
      tamperingConfidence: 0.91,
    },
    expectedRiskLevel: 'high',
    expectedVerdict: 'rejected',
    explanationVi:
      'Số tiền đọc được chỉ là 6.400 ₫ (thiếu 57.600 ₫ so với đơn 64.000 ₫), kèm dấu hiệu chỉnh sửa vùng số tiền trên ảnh.',
  },
  {
    id: 'reused_transaction_ref',
    titleVi: 'Bill trùng mã GD cũ • FT26330998811',
    badgeLabel: 'Trùng mã GD',
    imagePath: '/demo-assets/receipt-dh1001-valid.png',
    targetOrderCode: 'DH1005',
    expectedAmountVnd: 64000,
    simulatedExtraction: {
      transactionRef: 'FT26330998811',
      bankName: 'MB Bank',
      extractedAmountVnd: 64000,
      receiptTimestampIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      transferNote: 'DH1001',
      visualTamperingFlags: [],
      tamperingConfidence: 0.08,
    },
    expectedRiskLevel: 'high',
    expectedVerdict: 'rejected',
    explanationVi:
      'Mã giao dịch FT26330998811 đã được dùng cho đơn DH1001 cách đây 2 giờ.',
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
  const menuItems: MenuItemInsert[] = [
    {
      id: '11111111-1111-4111-8111-111111111101',
      sku: 'CF-SUA',
      name: 'Cà phê sữa đá',
      category: 'coffee',
      price_vnd: 29000,
      aliases: ['cf sữa', 'cf sua', 'cà phê sữa', 'nâu đá', 'nau da', 'cafe sua da'],
      is_available: true,
      daily_sold_count: 0,
    },
    {
      id: '11111111-1111-4111-8111-111111111102',
      sku: 'CF-DEN',
      name: 'Cà phê đen đá',
      category: 'coffee',
      price_vnd: 25000,
      aliases: ['cf đen', 'cf den', 'đen đá', 'den da', 'cafe den'],
      is_available: true,
      daily_sold_count: 0,
    },
    {
      id: '11111111-1111-4111-8111-111111111103',
      sku: 'BAC-XIU',
      name: 'Bạc xỉu đá',
      category: 'coffee',
      price_vnd: 32000,
      aliases: ['bx', 'bạc xỉu', 'bac xiu', 'bạc sỉu', 'cf nhiều sữa'],
      is_available: true,
      daily_sold_count: 0,
    },
    {
      id: '11111111-1111-4111-8111-111111111104',
      sku: 'TRA-DAO',
      name: 'Trà đào cam sả',
      category: 'tea',
      price_vnd: 35000,
      aliases: ['trà đào', 'tra dao', 'tdcs', 'đào cam sả', 'tra dao cam sa'],
      is_available: true,
      daily_sold_count: 0,
    },
    {
      id: '11111111-1111-4111-8111-111111111105',
      sku: 'TRA-VAI',
      name: 'Trà vải hoa hồng',
      category: 'tea',
      price_vnd: 35000,
      aliases: ['trà vải', 'tra vai', 'vải hồng', 'tra vai hoa hong'],
      is_available: true,
      daily_sold_count: 0,
    },
    {
      id: '11111111-1111-4111-8111-111111111106',
      sku: 'MATCHA-LATTE',
      name: 'Matcha Latte kem muối',
      category: 'milk_tea',
      price_vnd: 42000,
      aliases: ['matcha', 'trà xanh sữa', 'matcha kem muối', 'matcha latte'],
      is_available: true,
      daily_sold_count: 0,
    },
    {
      id: '11111111-1111-4111-8111-111111111107',
      sku: 'SC-VIET-QUAT',
      name: 'Sữa chua việt quất đá xay',
      category: 'milk_tea',
      price_vnd: 39000,
      aliases: ['sc việt quất', 'sữa chua vq', 'sua chua viet quat'],
      is_available: true,
      daily_sold_count: 0,
    },
    {
      id: '11111111-1111-4111-8111-111111111108',
      sku: 'BANH-MI-QUE',
      name: 'Bánh mì que pate Hải Phòng',
      category: 'pastry',
      price_vnd: 18000,
      aliases: ['bmq', 'bánh mì que', 'banh mi que', 'pate que'],
      is_available: true,
      daily_sold_count: 0,
    },
  ];

  return {
    menuItems,
    orders: [],
    orderItems: [],
    paymentReceipts: [],
    customerDebts: [],
  };
}
