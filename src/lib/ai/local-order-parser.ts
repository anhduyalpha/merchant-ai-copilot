import type { ParsedOrder, ParsedOrderItem } from '@/lib/ai/schemas';
import type { MenuItemRow } from '@/types/database';

function normalizeSlangText(raw: string): string {
  return raw
    .replace(/\r?\n/g, ', ')
    .replace(/\bít\s+đã\b/gi, 'ít đá')
    .replace(/\bnhiều\s+đã\b/gi, 'nhiều đá')
    .replace(/\bko\b/gi, 'không')
    .replace(/\bk\b/gi, 'không')
    .replace(/\bkhong\b/gi, 'không')
    .replace(/\bsữa\s+đã\b/gi, 'sữa đá')
    .replace(/\bđen\s+đã\b/gi, 'đen đá')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detects logical contradictions in Vietnamese F&B order phrases (e.g. "cf sữa không có sữa").
 */
export function detectOrderContradictions(
  rawText: string,
  items: Array<{ matchedItemName: string; rawText?: string; modifiers?: string[] }>
): string[] {
  const norm = normalizeSlangText(rawText).toLowerCase();
  const warnings: string[] = [];

  const hasCoffeeMilk = items.some(
    (i) => /cà phê sữa|bạc xỉu/i.test(i.matchedItemName)
  );
  if (
    hasCoffeeMilk &&
    /(không\s+(có\s+)?sữa|bỏ\s+sữa|ko\s+sữa|no\s+milk)/i.test(norm)
  ) {
    warnings.push(
      'Khách gọi "Cà phê sữa / Bạc xỉu" nhưng ghi "không có sữa" — cân nhắc đổi sang Cà phê đen đá hoặc hỏi lại khách.'
    );
  }

  const hasPeachTea = items.some((i) => /trà đào/i.test(i.matchedItemName));
  if (hasPeachTea && /(không\s+(lấy\s+)?đào|bỏ\s+đào)/i.test(norm)) {
    warnings.push(
      'Khách gọi "Trà đào" nhưng ghi "không đào" — xác nhận lại với khách có giữ miếng đào hoặc đổi món không.'
    );
  }

  const hasLycheeTea = items.some((i) => /trà vải/i.test(i.matchedItemName));
  if (hasLycheeTea && /(không\s+(lấy\s+)?vải|bỏ\s+vải)/i.test(norm)) {
    warnings.push(
      'Khách gọi "Trà vải" nhưng ghi "không vải" — xác nhận lại topping với khách.'
    );
  }

  return warnings;
}

const KNOWN_OUT_OF_MENU_PATTERNS: ReadonlyArray<{ regex: RegExp; label: string }> = [
  { regex: /(\d+)?\s*(trà chanh|trà tắc|sinh tố bơ|sinh tố xoài|nước cam|cacao nóng|matcha đá xay)/gi, label: '' },
];

const MODIFIER_PATTERNS: RegExp[] = [
  /ít đá/gi,
  /nhiều đá/gi,
  /không đá/gi,
  /ít ngọt/gi,
  /ít đường/gi,
  /không đường/gi,
  /không sữa/gi,
  /không có sữa/gi,
  /nóng giòn/gi,
  /nóng/gi,
  /mang về/gi,
];

/**
 * Deterministic Vietnamese POS order parser fallback when external AI hits 429/503/timeout.
 */
export function parseVietnameseOrderFallback(
  rawInput: string,
  menuItems: MenuItemRow[]
): ParsedOrder {
  const clean = normalizeSlangText(rawInput);
  const lower = clean.toLowerCase();

  let tableOrChannel = 'Tại quầy';
  const tableMatch = /\b(bàn\s*\d+|mang về|zalo|facebook|fb)\b/i.exec(clean);
  if (tableMatch) {
    tableOrChannel = tableMatch[1].replace(/\s+/g, ' ').trim();
    tableOrChannel = tableOrChannel.charAt(0).toUpperCase() + tableOrChannel.slice(1);
  }

  let discountVnd = 0;
  let discountReason: string | null = null;
  const discountMatch = /giảm\s+(\d+)\s*k\b/i.exec(lower);
  if (discountMatch) {
    discountVnd = Math.max(0, Number(discountMatch[1]) * 1000);
    discountReason = /khách quen/i.test(lower) ? 'Giảm khách quen' : 'Giảm giá trực tiếp';
  }

  const isDebt = /(ghi sổ|cuối ngày chuyển|nợ|ghi nợ)/i.test(lower);
  const isSplit = /(tách riêng|tách\s+\d|chia\s+tiền)/i.test(lower);
  const isCash = !isSplit && !isDebt && /(tiền mặt|trả mặt)/i.test(lower);

  const aliasCandidates: Array<{ alias: string; item: MenuItemRow }> = [];
  for (const m of menuItems) {
    if (!m.is_available) continue;
    aliasCandidates.push({ alias: m.name.toLowerCase(), item: m });
    for (const a of m.aliases) {
      const cleanAlias = a.trim().toLowerCase();
      if (cleanAlias) aliasCandidates.push({ alias: cleanAlias, item: m });
    }
  }
  aliasCandidates.sort((a, b) => b.alias.length - a.alias.length);

  const items: ParsedOrderItem[] = [];
  const clauses = clean
    .split(/[,;\n]+|\bvà\b/i)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const clauseLower = clause.toLowerCase();
    const matched = aliasCandidates.find((c) => {
      const escaped = c.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|\\s|\\d)${escaped}(?:$|\\s|[.,!?])`, 'i').test(clauseLower);
    });

    if (matched) {
      const escapedAlias = matched.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const qtyRegex = new RegExp(`(\\d+)\\s*(?:ly|cốc|phần|ổ|cái|tô)?\\s*${escapedAlias}`, 'i');
      const qtyMatch = qtyRegex.exec(clauseLower) ?? /\b(\d+)\b/.exec(clauseLower.replace(/bàn\s*\d+|giảm\s*\d+k/gi, ''));
      const quantity = Math.min(9999, Math.max(1, qtyMatch ? Number(qtyMatch[1]) : 1));

      const modifiers: string[] = [];
      for (const mp of MODIFIER_PATTERNS) {
        const hit = clause.match(mp);
        if (hit?.[0]) modifiers.push(hit[0].trim());
      }

      const splitCash = isSplit && /tiền mặt/i.test(clauseLower);
      const unitPrice = matched.item.price_vnd;
      items.push({
        sku: matched.item.sku,
        matchedItemName: matched.item.name,
        rawText: clause,
        quantity,
        unitPriceVnd: unitPrice,
        modifiers,
        paymentSplitTag: splitCash ? 'cash' : 'shared',
        lineTotalVnd: quantity * unitPrice,
        isUnmatched: false,
      });
      continue;
    }

    for (const pattern of KNOWN_OUT_OF_MENU_PATTERNS) {
      const m = new RegExp(pattern.regex.source, 'i').exec(clause);
      if (m) {
        const qty = Math.min(9999, Math.max(1, Number(m[1] || 1)));
        const itemName = m[2].trim();
        items.push({
          sku: null,
          matchedItemName: itemName.charAt(0).toUpperCase() + itemName.slice(1),
          rawText: clause,
          quantity: qty,
          unitPriceVnd: 0,
          modifiers: [],
          paymentSplitTag: 'shared',
          lineTotalVnd: 0,
          isUnmatched: true,
        });
      }
    }
  }

  const subtotalVnd = items.reduce((s, i) => s + i.lineTotalVnd, 0);
  const clampedDiscount = Math.min(discountVnd, subtotalVnd);
  const totalVnd = Math.max(0, subtotalVnd - clampedDiscount);
  const cashAmountVnd = isCash
    ? totalVnd
    : isSplit
      ? items.filter((i) => i.paymentSplitTag === 'cash').reduce((s, i) => s + i.lineTotalVnd, 0)
      : 0;
  const transferAmountVnd = isDebt ? 0 : Math.max(0, totalVnd - cashAmountVnd);
  const paymentMethod: ParsedOrder['paymentMethod'] = isDebt
    ? 'debt'
    : isCash
      ? 'cash'
      : isSplit && cashAmountVnd > 0 && transferAmountVnd > 0
        ? 'split'
        : 'vietqr';

  const warnings = detectOrderContradictions(clean, items);
  if (items.some((i) => i.isUnmatched)) {
    warnings.push('Có món chưa nằm trong thực đơn — vui lòng nhập đơn giá hoặc đổi món.');
  }
  if (items.length === 0) {
    warnings.push('Không tìm thấy món nào trong tin nhắn — vui lòng nhập tên món hoặc chọn từ thực đơn.');
  }

  return {
    tableOrChannel,
    customerName: null,
    items,
    subtotalVnd,
    discountVnd: clampedDiscount,
    discountReason,
    totalVnd,
    cashAmountVnd,
    transferAmountVnd,
    paymentMethod,
    unmatchedNotes: [],
    warnings,
    confidence: items.length > 0 ? 0.85 : 0.2,
  };
}
