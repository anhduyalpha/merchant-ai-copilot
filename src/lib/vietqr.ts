export interface BuildVietQROptions {
  amount: number;
  addInfo: string;
  bankId?: string;
  accountNo?: string;
  accountName?: string;
  template?: 'compact2' | 'compact' | 'qr_only' | 'print';
}

export interface MerchantBankInfo {
  bankId: string;
  bankBin: string;
  accountNo: string;
  accountName: string;
}

const MAX_VND_AMOUNT = 999_999_999;

const BANK_BIN_MAP: Record<string, string> = {
  MB: '970422',
  MBBANK: '970422',
  VCB: '970436',
  VIETCOMBANK: '970436',
  TCB: '970407',
  TECHCOMBANK: '970407',
  ACB: '970416',
  BIDV: '970418',
  ICB: '970415',
  VTB: '970415',
  VIETINBANK: '970415',
  VPB: '970432',
  VPBANK: '970432',
  TPB: '970423',
  TPBANK: '970423',
  VIB: '970441',
  SHB: '970443',
  MSB: '970426',
  OCB: '970448',
  STB: '970403',
  SACOMBANK: '970403',
  VBA: '970405',
  AGRIBANK: '970405',
};

function sanitizeIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9]/g, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function toAsciiUpper(value: string, maxLength = 50): string {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^a-zA-Z0-9 .\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return normalized;
}

export function resolveBankBin(bankId: string): string {
  const clean = sanitizeIdentifier(bankId, 'MB').toUpperCase();
  if (/^\d{6}$/.test(clean)) return clean;
  return BANK_BIN_MAP[clean] ?? '970422';
}

export function getMerchantBankInfo(overrides?: {
  bankId?: string;
  accountNo?: string;
  accountName?: string;
}): MerchantBankInfo {
  const bankId = sanitizeIdentifier(
    overrides?.bankId ?? process.env.NEXT_PUBLIC_VIETQR_BANK_ID ?? 'MB',
    'MB'
  ).toUpperCase();
  const accountNo = sanitizeIdentifier(
    overrides?.accountNo ?? process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO ?? '0123456789',
    '0123456789'
  );
  const rawName = (
    overrides?.accountName ??
    process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME ??
    'TIEM CA PHE MOC'
  ).replace(/QUAN CA PHE DEMO/gi, 'TIEM CA PHE MOC');
  const accountName = toAsciiUpper(rawName, 50).toUpperCase() || 'TIEM CA PHE MOC';
  return {
    bankId,
    bankBin: resolveBankBin(bankId),
    accountNo,
    accountName,
  };
}

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, xorOut 0x0000) required by EMVCo Tag 63.
 */
export function computeCRC16CCITT(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= (input.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Builds a 100% local EMVCo / NAPAS 247 VietQR string with zero external HTTP calls or rate limits.
 */
export function buildVietQRPayload(options: BuildVietQROptions): string {
  if (!Number.isFinite(options.amount) || options.amount < 0 || options.amount > MAX_VND_AMOUNT) {
    throw new RangeError(`Invalid VND amount for VietQR: ${String(options.amount)}`);
  }

  const roundedAmount = Math.round(options.amount);
  const bank = getMerchantBankInfo({
    bankId: options.bankId,
    accountNo: options.accountNo,
    accountName: options.accountName,
  });

  const beneficiary = tlv('00', bank.bankBin) + tlv('01', bank.accountNo);
  const merchantAccountInfo = tlv('00', 'A000000727') + tlv('01', beneficiary) + tlv('02', 'QRIBFTTA');

  const asciiNote = toAsciiUpper(options.addInfo, 50) || 'THANH TOAN DON HANG';
  const additionalData = tlv('08', asciiNote);

  const parts = [
    tlv('00', '01'),
    tlv('01', roundedAmount > 0 ? '12' : '11'),
    tlv('38', merchantAccountInfo),
    tlv('53', '704'),
  ];
  if (roundedAmount > 0) {
    parts.push(tlv('54', String(roundedAmount)));
  }
  parts.push(tlv('58', 'VN'));
  parts.push(tlv('62', additionalData));

  const bodyWithoutCrc = `${parts.join('')}6304`;
  return `${bodyWithoutCrc}${computeCRC16CCITT(bodyWithoutCrc)}`;
}

/**
 * Kept for compatibility with seed/URL fields without encouraging external image fetches in UI.
 */
export function buildVietQRUrl(options: BuildVietQROptions): string {
  if (!Number.isFinite(options.amount) || options.amount < 0 || options.amount > MAX_VND_AMOUNT) {
    throw new RangeError(`Invalid VND amount for VietQR: ${String(options.amount)}`);
  }

  const roundedAmount = Math.round(options.amount);
  const bank = getMerchantBankInfo({
    bankId: options.bankId,
    accountNo: options.accountNo,
    accountName: options.accountName,
  });
  const addInfo = sanitizeText(options.addInfo, 50) || 'THANH TOAN DON HANG';
  const template = options.template ?? 'compact2';

  const params = new URLSearchParams({
    amount: String(roundedAmount),
    addInfo,
    accountName: bank.accountName,
  });

  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.accountNo)}-${template}.png?${params.toString()}`;
}

/**
 * Builds clean Zalo/Messenger transfer details using local bank account info (no rate-limited image URL).
 */
export function formatTransferReminderText(params: {
  customerName: string;
  orderCode: string;
  amountVnd: number;
  notes?: string | null;
  bankId?: string;
  accountNo?: string;
  accountName?: string;
}): string {
  const bank = getMerchantBankInfo({
    bankId: params.bankId,
    accountNo: params.accountNo,
    accountName: params.accountName,
  });
  const detail = params.notes?.trim() ? ` (${params.notes.trim()})` : '';
  return [
    `Dạ em chào ${params.customerName}, em gửi lại mình hóa đơn ${params.orderCode}${detail} tổng ${formatVND(params.amountVnd)} ạ.`,
    `Thông tin chuyển khoản: ${bank.bankId} - STK: ${bank.accountNo} - Chủ TK: ${bank.accountName}`,
    `Nội dung CK: ${params.orderCode}`,
  ].join('\n');
}

/**
 * Formats an integer/float VND value into standard Vietnamese currency display (e.g. "64.000 ₫").
 */
export function formatVND(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Invalid VND amount: ${String(amount)}`);
  }
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}
