'use client';

import { useEffect } from 'react';
import {
  ArrowUpRight,
  FileImage,
  MessageSquareText,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  TrendingUp,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export type JudgePresetId =
  | 'slang_chat'
  | 'handwritten_order'
  | 'valid_receipt'
  | 'tampered_receipt'
  | 'reused_receipt'
  | 'copilot_revenue_debt';

interface JudgeDemoBarProps {
  open: boolean;
  onClose: () => void;
  onSelectPreset: (presetId: JudgePresetId) => void;
  onResetDemo: () => Promise<void>;
  isResetting: boolean;
  activePreset: JudgePresetId | null;
}

const SIMULATOR_SCENARIOS: ReadonlyArray<{
  id: JudgePresetId;
  title: string;
  subtitle: string;
  screenHint: string;
  dotClass: string;
  icon: typeof MessageSquareText;
}> = [
  {
    id: 'slang_chat',
    title: 'Tin nhắn đặt bàn 3',
    subtitle: '2 bx ít ngọt, 1 cf sữa, giảm 10k, tách 1 trà đào tiền mặt',
    screenHint: 'Quầy thu ngân',
    dotClass: 'bg-[#A50064]',
    icon: MessageSquareText,
  },
  {
    id: 'handwritten_order',
    title: 'Giấy ghi tay Bàn 2',
    subtitle: 'Đọc ảnh giấy order viết tay sang phiếu tính tiền & VietQR',
    screenHint: 'Quầy thu ngân',
    dotClass: 'bg-[#A50064]',
    icon: FileImage,
  },
  {
    id: 'valid_receipt',
    title: 'Bill chuyển khoản hợp lệ',
    subtitle: 'Khớp 64.000 ₫, mã giao dịch mới, sẵn sàng duyệt 1 chạm',
    screenHint: 'Kiểm duyệt CK',
    dotClass: 'bg-[#0F766E]',
    icon: ShieldCheck,
  },
  {
    id: 'tampered_receipt',
    title: 'Bill nghi sửa số tiền',
    subtitle: 'Chữ số bị can thiệp 6.400 ₫ thành 64.000 ₫ trên biên lai',
    screenHint: 'Kiểm duyệt CK',
    dotClass: 'bg-[#BE123C]',
    icon: ShieldAlert,
  },
  {
    id: 'reused_receipt',
    title: 'Bill trùng mã FT26330998811',
    subtitle: 'Phát hiện biên lai cũ của đơn DH1001 được gửi lại',
    screenHint: 'Kiểm duyệt CK',
    dotClass: 'bg-[#BE123C]',
    icon: ShieldX,
  },
  {
    id: 'copilot_revenue_debt',
    title: 'Tổng kết ca & nhắc nợ',
    subtitle: 'Phân tích doanh thu, món bán chậm & soạn tin Zalo kèm QR',
    screenHint: 'Doanh thu & Sổ nợ',
    dotClass: 'bg-[#B45309]',
    icon: TrendingUp,
  },
];

export function JudgeDemoBar({
  open,
  onClose,
  onSelectPreset,
  onResetDemo,
  isResetting,
  activePreset,
}: JudgeDemoBarProps) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Bộ mô phỏng nhanh"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#231520]/20 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over drawer */}
      <aside className="relative z-10 flex h-full w-full max-w-[390px] flex-col bg-white border-l border-[#EAE0E7] shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-[#EAE0E7] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-foreground">
                Bộ mô phỏng nhanh
              </h2>
              <kbd className="rounded border border-[#EAE0E7] bg-[#FBF8FA] px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
                Alt+D
              </kbd>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Chọn 1 chạm để chạy trực tiếp các tình huống bán hàng và kiểm soát giao dịch.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bộ mô phỏng"
            className="size-9 shrink-0 rounded-lg border border-[#EAE0E7] bg-white text-muted-foreground hover:text-foreground hover:bg-[#FBF8FA] inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {SIMULATOR_SCENARIOS.map((item) => {
            const Icon = item.icon;
            const isSelected = activePreset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectPreset(item.id);
                  onClose();
                }}
                className={`w-full rounded-lg border p-3.5 text-left transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSelected
                    ? 'border-[#EAB8D2] bg-[#FDF2F8]/80 shadow-2xs ring-1 ring-[#A50064]/15'
                    : 'border-[#EAE0E7] bg-white hover:bg-[#FBF8FA] hover:border-[#DFC7D7]'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#FDF2F8] text-[#A50064]">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`size-1.5 rounded-full shrink-0 ${item.dotClass}`} aria-hidden="true" />
                        <span className="text-sm font-semibold text-foreground">{item.title}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {item.subtitle}
                      </p>
                      <span className="mt-2 inline-block rounded bg-[#F5EEF3] px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {item.screenHint}
                      </span>
                    </div>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
                </div>
              </button>
            );
          })}
        </div>

        <div className="border-t border-[#EAE0E7] p-4 bg-[#FBF8FA]">
          <Button
            type="button"
            variant="outline"
            disabled={isResetting}
            onClick={() => void onResetDemo()}
            className="min-h-[44px] w-full rounded-lg border-[#EAE0E7] bg-white text-foreground hover:bg-[#FDF2F8] hover:border-[#EAB8D2] font-medium cursor-pointer"
          >
            <RotateCcw
              className={`size-4 text-muted-foreground ${isResetting ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isResetting ? 'Đang khôi phục...' : 'Khôi phục dữ liệu gốc'}</span>
          </Button>
        </div>
      </aside>
    </div>
  );
}
