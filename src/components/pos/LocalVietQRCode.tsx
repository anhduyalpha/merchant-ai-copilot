'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import QRCode from 'qrcode';
import {
  buildVietQRPayload,
  formatVND,
  getMerchantBankInfo,
} from '@/lib/vietqr';

interface LocalVietQRCodeProps {
  amount: number;
  addInfo: string;
  orderCode?: string;
  bankId?: string;
  accountNo?: string;
  accountName?: string;
  compact?: boolean;
  showDownload?: boolean;
}

const MAX_SVG_CACHE = 128;
const MAX_PNG_CACHE = 64;
const svgDataUrlCache = new Map<string, string>();
const pngDataUrlCache = new Map<string, string>();

function setBoundedCache(cache: Map<string, string>, key: string, value: string, maxSize: number) {
  if (cache.size >= maxSize) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

/**
 * Generates a crisp VietQR SVG data URL synchronously in <1ms using QRCode.create,
 * eliminating the async canvas wait & skeleton flash on initial render.
 */
function buildSyncQrSvgDataUrl(payload: string): string {
  const cached = svgDataUrlCache.get(payload);
  if (cached) return cached;

  try {
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const data = qr.modules.data;
    const paths: string[] = [];

    for (let row = 0; row < size; row++) {
      let col = 0;
      const rowOffset = row * size;
      while (col < size) {
        if (data[rowOffset + col]) {
          const colStart = col;
          while (col < size && data[rowOffset + col]) {
            col++;
          }
          const runLen = col - colStart;
          paths.push(`M${colStart + 1} ${row + 1}h${runLen}v1h-${runLen}z`);
        } else {
          col++;
        }
      }
    }

    const viewSize = size + 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#FFFFFF"/><path fill="#18151F" d="${paths.join('')}"/></svg>`;
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    setBoundedCache(svgDataUrlCache, payload, dataUrl, MAX_SVG_CACHE);
    return dataUrl;
  } catch {
    return '';
  }
}

export function LocalVietQRCode({
  amount,
  addInfo,
  orderCode,
  bankId,
  accountNo,
  accountName,
  compact = false,
  showDownload = false,
}: LocalVietQRCodeProps) {
  const bank = useMemo(
    () => getMerchantBankInfo({ bankId, accountNo, accountName }),
    [bankId, accountNo, accountName]
  );

  const safeAmount = Number.isFinite(amount) && amount >= 0 ? Math.min(999_999_999, Math.round(amount)) : 0;
  const payload = useMemo(
    () =>
      buildVietQRPayload({
        amount: safeAmount,
        addInfo,
        bankId: bank.bankId,
        accountNo: bank.accountNo,
        accountName: bank.accountName,
      }),
    [safeAmount, addInfo, bank.bankId, bank.accountNo, bank.accountName]
  );

  const svgDataUrl = useMemo(() => buildSyncQrSvgDataUrl(payload), [payload]);
  const width = compact ? 240 : 280;
  const pngCacheKey = `${width}::${payload}`;
  const cachedPng = showDownload ? pngDataUrlCache.get(pngCacheKey) ?? '' : '';
  const [pngState, setPngState] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!showDownload || cachedPng) return;
    let cancelled = false;
    void QRCode.toDataURL(payload, {
      width,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#18151F',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        setBoundedCache(pngDataUrlCache, pngCacheKey, url, MAX_PNG_CACHE);
        if (!cancelled) {
          setPngState({ key: pngCacheKey, url });
        }
      })
      .catch(() => {
        // Keep SVG download fallback when PNG generation fails
      });
    return () => {
      cancelled = true;
    };
  }, [showDownload, cachedPng, pngCacheKey, payload, width]);

  const pngDataUrl = cachedPng || (pngState?.key === pngCacheKey ? pngState.url : '');
  const downloadHref = pngDataUrl || svgDataUrl;
  const fileBase = `vietqr-${(orderCode || addInfo || 'thanhtoan').replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`rounded-xl border border-[#EAE0E7] bg-white shadow-xs flex flex-col items-center ${
          compact ? 'p-2.5 w-48' : 'p-3 w-56'
        }`}
      >
        <div className="w-full flex items-center justify-between text-[10px] font-semibold tracking-wide text-[#A50064] pb-1.5 border-b border-[#F3EBF0]">
          <span>VIETQR • NAPAS 247</span>
          <span className="font-mono text-[#665562]">{bank.bankId}</span>
        </div>

        <div className={`flex items-center justify-center ${compact ? 'h-40 w-40 my-1.5' : 'h-44 w-44 my-2'}`}>
          {svgDataUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={svgDataUrl}
              alt="Mã VietQR thanh toán"
              decoding="sync"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="h-full w-full rounded bg-[#FBF8FA]" />
          )}
        </div>

        <div className="w-full pt-1.5 border-t border-[#F3EBF0] text-center space-y-0.5">
          <p className="text-[10px] font-semibold text-foreground truncate">{bank.accountName}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {bank.bankId} • {bank.accountNo}
          </p>
          {safeAmount > 0 && (
            <p className="font-sans tabular-nums text-xs font-bold text-[#A50064]">
              {formatVND(safeAmount)}
            </p>
          )}
        </div>
      </div>

      {showDownload && downloadHref && (
        <a
          href={downloadHref}
          download={`${fileBase}.${pngDataUrl ? 'png' : 'svg'}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#EAE0E7] bg-white px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-[#A50064] hover:border-[#EAB8D2] transition-colors"
        >
          <Download className="size-3" aria-hidden="true" />
          <span>Tải ảnh QR</span>
        </a>
      )}
    </div>
  );
}
