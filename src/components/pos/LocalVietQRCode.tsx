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

  const [dataUrl, setDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(payload, {
      width: compact ? 220 : 260,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#18151F',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [payload, compact]);

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
          {dataUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={dataUrl}
              alt="Mã VietQR thanh toán"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="h-full w-full rounded bg-[#FBF8FA] animate-pulse" />
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

      {showDownload && dataUrl && (
        <a
          href={dataUrl}
          download={`vietqr-${(orderCode || addInfo || 'thanhtoan').replace(/[^a-zA-Z0-9_-]/g, '')}.png`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#EAE0E7] bg-white px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-[#A50064] hover:border-[#EAB8D2] transition-colors"
        >
          <Download className="size-3" aria-hidden="true" />
          <span>Tải ảnh QR</span>
        </a>
      )}
    </div>
  );
}
