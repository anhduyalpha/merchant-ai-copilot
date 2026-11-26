export { cn } from "cn"

/**
 * Strips internal demo/synthetic markers from stored records for clean counter display.
 */
export function cleanCustomerDisplay(name: string | null | undefined): string {
  if (!name) return '';
  const stripped = name
    .replace(/\s*\((?:Demo|Synthetic(?:\s+Demo)?)\)\s*/gi, '')
    .trim();
  if (/^Khách lẻ Bàn 1$/i.test(stripped)) return 'Bàn 1';
  if (/^Anh Minh Thiết Kế$/i.test(stripped)) return 'Anh Minh (Thiết kế)';
  if (/^Chị Lan Tiệm Hoa$/i.test(stripped)) return 'Chị Lan (Tiệm hoa)';
  return stripped;
}

export function cleanBankDisplay(bankName: string | null | undefined): string {
  if (!bankName) return 'Ngân hàng';
  return bankName.replace(/\s*\((?:Demo|Synthetic(?:\s+Demo)?)\)\s*/gi, '').trim();
}

export function cleanChannelDisplay(handle: string | null | undefined): string {
  if (!handle) return '';
  return handle
    .replace(/\s*\((?:Demo|Synthetic(?:\s+Demo)?)\)\s*/gi, '')
    .replace(/\.demo\b/gi, '')
    .trim();
}
