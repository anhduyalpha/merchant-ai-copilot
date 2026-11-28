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

const CUSTOMER_NAME_STOPWORDS = new Set([
  'quen',
  'le',
  'lẻ',
  'oi',
  'ơi',
  'nha',
  'nhe',
  'nhé',
  'a',
  'ạ',
  'dat',
  'đặt',
  'them',
  'thêm',
  'goi',
  'gọi',
  'minh',
  'mình',
  'ho',
  'hộ',
  'gium',
  'giùm',
  'cho',
  'uong',
  'uống',
  'an',
  'ăn',
  'ly',
  'coc',
  'cốc',
  'phan',
  'phần',
  'ghi',
  'so',
  'sổ',
  'no',
  'nợ',
  'chuyen',
  'chuyển',
  'tien',
  'tiền',
  'mat',
  'mặt',
]);

function extractCustomerName(clean: string): { customerName: string | null; matchedPhrase: string | null } {
  const regex =
    /\b(?:khách\s+quen|khách|anh|chị|bạn|cô|chú|em)\s+([A-ZÀ-Ỹa-zà-ỹ0-9]+(?:\s+[A-ZÀ-Ỹa-zà-ỹ0-9]+){0,2})/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(clean)) !== null) {
    const words = match[1]
      .split(/\s+/)
      .filter((w) => w.length > 0 && !CUSTOMER_NAME_STOPWORDS.has(w.toLowerCase()));
    if (words.length > 0) {
      const candidate = words.slice(0, 2).join(' ');
      if (!/^\d+$/.test(candidate)) {
        return { customerName: candidate, matchedPhrase: match[0] };
      }
    }
  }
  return { customerName: null, matchedPhrase: null };
}

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

  const { customerName } = extractCustomerName(clean);

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
    customerName,
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

const INSTANT_NOISE_REGEX =
  /\b(bàn\s*\d+|mang về|zalo|facebook|fb|giảm\s+\d+\s*k|khách quen|khách|anh|chị|bạn|cô|chú|em|tiền mặt|trả mặt|tính tiền mặt|tính tiền|tách riêng|tách|chia tiền|ghi sổ|cuối ngày chuyển|ghi nợ|nợ|quán ơi|nha quán ơi|quán|ơi|nha|nhé|ạ|thêm|đặt|gọi|cho|lấy|với|và|riêng|ly|cốc|phần|ổ|cái|tô|bên|lên đơn)\b/gi;

/**
 * Fast <1ms deterministic parse path for unambiguous Vietnamese POS text orders.
 * Returns null whenever any unknown food terms, contradictions, or ambiguity remain
 * so complex orders still route through external LLM.
 */
export function tryInstantMenuOrderParse(
  rawInput: string,
  menuItems: MenuItemRow[]
): ParsedOrder | null {
  const clean = normalizeSlangText(rawInput);
  if (!clean || clean.length > 240) return null;

  const parsed = parseVietnameseOrderFallback(clean, menuItems);
  if (
    parsed.items.length === 0 ||
    parsed.items.some((i) => i.isUnmatched) ||
    parsed.warnings.length > 0
  ) {
    return null;
  }
  if (parsed.paymentMethod === 'debt' && !parsed.customerName) {
    return null;
  }

  let leftover = clean.toLowerCase();
  const { matchedPhrase } = extractCustomerName(clean);
  if (matchedPhrase) {
    leftover = leftover.replace(matchedPhrase.toLowerCase(), ' ');
  }

  const aliasList: string[] = [];
  for (const m of menuItems) {
    if (!m.is_available) continue;
    aliasList.push(m.name.toLowerCase());
    for (const a of m.aliases) {
      const aClean = a.trim().toLowerCase();
      if (aClean) aliasList.push(aClean);
    }
  }
  aliasList.sort((a, b) => b.length - a.length);

  for (const alias of aliasList) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    leftover = leftover.replace(new RegExp(`(?:^|\\s|\\d)${escaped}(?=$|\\s|[.,!?])`, 'gi'), ' ');
  }
  for (const mp of MODIFIER_PATTERNS) {
    leftover = leftover.replace(mp, ' ');
  }
  leftover = leftover
    .replace(INSTANT_NOISE_REGEX, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/[.,!?;:/\-()\[\]"'₫]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (leftover.length > 0) {
    return null;
  }

  return {
    ...parsed,
    confidence: 0.96,
  };
}
