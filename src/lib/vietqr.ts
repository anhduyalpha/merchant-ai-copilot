export interface BuildVietQROptions {
  amount: number;
  addInfo: string;
  bankId?: string;
  accountNo?: string;
  accountName?: string;
  template?: 'compact2' | 'compact' | 'qr_only' | 'print';
}

const MAX_VND_AMOUNT = 999_999_999;

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

/**
 * Generates a dynamic VietQR image URL using img.vietqr.io (default compact2.png).
 * Uses strictly synthetic fallback credentials when env vars are unset.
 */
export function buildVietQRUrl(options: BuildVietQROptions): string {
  if (!Number.isFinite(options.amount) || options.amount < 0 || options.amount > MAX_VND_AMOUNT) {
    throw new RangeError(`Invalid VND amount for VietQR: ${String(options.amount)}`);
  }

  const roundedAmount = Math.round(options.amount);
  const bankId = sanitizeIdentifier(
    options.bankId ?? process.env.NEXT_PUBLIC_VIETQR_BANK_ID ?? 'MB',
    'MB'
  );
  const accountNo = sanitizeIdentifier(
    options.accountNo ?? process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO ?? '0123456789',
    '0123456789'
  );
  const accountName =
    sanitizeText(
      options.accountName ?? process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME ?? 'QUAN CA PHE DEMO',
      50
    ) || 'QUAN CA PHE DEMO';
  const addInfo = sanitizeText(options.addInfo, 50) || 'THANH TOAN DON HANG';
  const template = options.template ?? 'compact2';

  const params = new URLSearchParams({
    amount: String(roundedAmount),
    addInfo,
    accountName,
  });

  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(accountNo)}-${template}.png?${params.toString()}`;
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
