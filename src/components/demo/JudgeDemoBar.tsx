'use client';

import { RotateCcw, X } from 'lucide-react';

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

const DEMO_SCENARIOS: ReadonlyArray<{
  id: JudgePresetId;
  label: string;
  dotClass: string;
}> = [
  { id: 'slang_chat', label: 'Tin nhắn đặt bàn 3', dotClass: 'bg-[#181512]/45' },
  { id: 'handwritten_order', label: 'Giấy ghi tay', dotClass: 'bg-[#181512]/45' },
  { id: 'valid_receipt', label: 'Bill hợp lệ', dotClass: 'bg-[#0F766E]' },
  { id: 'tampered_receipt', label: 'Bill nghi sửa tiền', dotClass: 'bg-[#BE123C]' },
  { id: 'reused_receipt', label: 'Bill trùng mã GD', dotClass: 'bg-[#BE123C]' },
  { id: 'copilot_revenue_debt', label: 'Tổng kết & nhắc nợ', dotClass: 'bg-[#B45309]' },
];

export function JudgeDemoBar({
  open,
  onClose,
  onSelectPreset,
  onResetDemo,
  isResetting,
  activePreset,
}: JudgeDemoBarProps) {
  if (!open) return null;

  return (
    <section
      aria-label="Kịch bản dùng thử"
      className="border-b border-border bg-[#F5F4F0]/90"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 min-h-[44px] py-1.5 flex items-center gap-2.5 sm:gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-semibold text-foreground whitespace-nowrap">
            Kịch bản dùng thử
          </span>
          <span className="hidden xl:inline-flex items-center rounded-md border border-border bg-white px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground whitespace-nowrap">
            Dữ liệu mẫu
          </span>
        </div>

        <div className="h-4 w-px bg-border shrink-0" aria-hidden="true" />

        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto py-0.5">
          {DEMO_SCENARIOS.map((item) => {
            const isSelected = activePreset === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectPreset(item.id)}
                className={`min-h-[32px] px-2.5 py-1 rounded-md border text-xs font-medium whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  isSelected
                    ? 'border-primary bg-white text-primary shadow-2xs'
                    : 'border-border bg-white/85 text-foreground hover:bg-white hover:border-foreground/20'
                }`}
              >
                <span
                  className={`size-1.5 rounded-full shrink-0 ${item.dotClass}`}
                  aria-hidden="true"
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 pl-1 border-l border-border/70">
          <button
            type="button"
            onClick={() => void onResetDemo()}
            disabled={isResetting}
            className="min-h-[32px] px-2.5 py-1 rounded-md border border-border bg-white text-xs font-medium text-foreground hover:bg-[#FAF9F6] disabled:opacity-50 whitespace-nowrap inline-flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCcw
              className={`size-3.5 text-muted-foreground ${isResetting ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isResetting ? 'Đang khôi phục...' : 'Khôi phục'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Ẩn thanh kịch bản dùng thử"
            className="size-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/80 inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
