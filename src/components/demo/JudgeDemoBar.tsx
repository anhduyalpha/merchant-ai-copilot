'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FileImage,
  MessageSquareText,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export type JudgePresetId =
  | 'slang_chat'
  | 'handwritten_order'
  | 'valid_receipt'
  | 'tampered_receipt'
  | 'reused_receipt'
  | 'copilot_revenue_debt';

interface JudgeDemoBarProps {
  onSelectPreset: (presetId: JudgePresetId) => void;
  onResetDemo: () => Promise<void>;
  isResetting: boolean;
  activePreset: JudgePresetId | null;
}

const JUDGE_PRESET_BUTTONS: ReadonlyArray<{
  id: JudgePresetId;
  label: string;
  tone: 'pos' | 'safe' | 'danger' | 'copilot';
  icon: typeof MessageSquareText;
}> = [
  { id: 'slang_chat', label: '1. Chat Zalo tiếng lóng', tone: 'pos', icon: MessageSquareText },
  { id: 'handwritten_order', label: '2. Ảnh giấy viết tay', tone: 'pos', icon: FileImage },
  { id: 'valid_receipt', label: '3. Bill hợp lệ', tone: 'safe', icon: ShieldCheck },
  { id: 'tampered_receipt', label: '4. Bill nghi sửa tiền', tone: 'danger', icon: ShieldAlert },
  { id: 'reused_receipt', label: '5. Bill trùng mã FT26330998811', tone: 'danger', icon: ShieldX },
  { id: 'copilot_revenue_debt', label: '6. Hỏi Copilot doanh thu & nợ', tone: 'copilot', icon: Sparkles },
];

export function JudgeDemoBar({
  onSelectPreset,
  onResetDemo,
  isResetting,
  activePreset,
}: JudgeDemoBarProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section
      aria-label="Chế độ Chấm thi nhanh cho Giám khảo"
      className="rounded-2xl border border-primary/20 bg-gradient-to-r from-[#FCE7F3] via-[#FDF2F8] to-[#F5E6F4] shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Zap className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">
                Chế độ Giám khảo Chấm nhanh dưới 60 giây
              </h2>
              <Badge className="bg-primary/12 text-primary border-primary/25 hover:bg-primary/15">
                Dữ liệu giả lập 100%
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              Bấm 1 chạm để chạy AI thật qua toàn bộ 6 kịch bản POS, VietQR, chống bill giả & nhắc nợ
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onResetDemo}
            disabled={isResetting}
            className="min-h-[44px] px-3.5 border-primary/30 bg-white text-primary hover:bg-primary/8 cursor-pointer"
          >
            <RotateCcw className={`size-4 ${isResetting ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isResetting ? 'Đang khôi phục...' : 'Reset dữ liệu mẫu'}</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setExpanded((prev) => !prev)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Thu gọn thanh kịch bản mẫu' : 'Mở rộng thanh kịch bản mẫu'}
            className="min-h-[44px] min-w-[44px] text-primary hover:bg-primary/10 cursor-pointer"
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-primary/15 px-4 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
            {JUDGE_PRESET_BUTTONS.map((btn) => {
              const Icon = btn.icon;
              const isSelected = activePreset === btn.id;
              const toneClass =
                btn.tone === 'danger'
                  ? 'border-rose-300 bg-white text-rose-800 hover:bg-rose-50'
                  : btn.tone === 'safe'
                    ? 'border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50'
                    : 'border-primary/25 bg-white text-foreground hover:bg-primary/8 hover:text-primary';

              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => onSelectPreset(btn.id)}
                  className={`min-h-[44px] w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${toneClass} ${
                    isSelected ? 'ring-2 ring-primary border-primary shadow-xs' : ''
                  }`}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="leading-snug">{btn.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
