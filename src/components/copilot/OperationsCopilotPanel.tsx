'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  QrCode,
  Send,
  TrendingDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CopilotAction } from '@/lib/ai/schemas';
import { cleanChannelDisplay, cleanCustomerDisplay } from '@/lib/utils';
import { formatVND } from '@/lib/vietqr';
import type { CustomerDebtRow } from '@/types/database';

export interface OperationsCopilotHandle {
  runDemoPrompt: (promptText: string) => void;
}

interface OperationsCopilotPanelProps {
  debts: CustomerDebtRow[];
  onDebtSettled: () => Promise<void>;
}

const QUICK_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: 'Tổng kết hôm nay & nhắc nợ khách quen',
    prompt:
      'Tổng kết doanh thu hôm nay, tìm món bán chậm và soạn tin nhắn nhắc nợ kèm mã VietQR cho khách quen',
  },
  {
    label: 'Món bán chậm chiều nay nên đẩy combo nào?',
    prompt: 'Món nào hôm nay đang bán chậm nhất? Gợi ý giúp tôi combo đẩy bán buổi chiều',
  },
  {
    label: 'Soạn tin Zalo nhắc nợ lịch sự',
    prompt: 'Soạn giúp tôi tin nhắn nhắc nợ lịch sự qua Zalo cho các đơn chưa thu tiền',
  },
];

const TOOL_LABELS_VI: Record<string, string> = {
  get_daily_sales_summary: 'Doanh thu hôm nay',
  get_slow_moving_items: 'Thống kê thực đơn',
  list_unpaid_debts: 'Sổ nợ khách quen',
  draft_vietqr_debt_reminders: 'Mẫu nhắc nợ VietQR',
};

export const OperationsCopilotPanel = forwardRef<
  OperationsCopilotHandle,
  OperationsCopilotPanelProps
>(function OperationsCopilotPanel({ debts, onDebtSettled }, ref) {
  const [prompt, setPrompt] = useState<string>(QUICK_PROMPTS[0].prompt);
  const [isLoading, setIsLoading] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openQrCode, setOpenQrCode] = useState<string | null>(null);
  const [copilotData, setCopilotData] = useState<CopilotAction | null>(null);

  async function runCopilot(promptText: string) {
    if (isLoading) return;
    const clean = promptText.trim();
    if (!clean) {
      toast.error('Hãy nhập câu hỏi về doanh thu hoặc sổ nợ.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: clean }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể tổng hợp dữ liệu lúc này.');
      }
      setCopilotData(data.copilot as CopilotAction);
      toast.success('Đã tổng hợp xong số liệu cửa hàng.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Có lỗi khi hỏi trợ lý.');
    } finally {
      setIsLoading(false);
    }
  }

  useImperativeHandle(ref, () => ({
    runDemoPrompt(promptText) {
      setPrompt(promptText);
      void runCopilot(promptText);
    },
  }));

  async function handleCopyReminder(key: string, textToCopy: string) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedKey(key);
      toast.success('Đã sao chép tin nhắn nhắc nợ kèm link VietQR.');
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error('Không sao chép được tự động, vui lòng chép thủ công.');
    }
  }

  async function handleSettleDebt(debtId: string, orderCode: string) {
    if (settlingId) return;
    setSettlingId(debtId);
    try {
      const res = await fetch(`/api/debts/${debtId}/settle`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể đánh dấu đã thu.');
      }
      toast.success(`Đã ghi nhận thu đủ đơn ${orderCode}.`);
      await onDebtSettled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật sổ nợ.');
    } finally {
      setSettlingId(null);
    }
  }

  const reminderDraftByOrder = new Map(
    (copilotData?.debtReminders ?? []).map((r) => [r.orderCode.toUpperCase(), r])
  );

  const unpaidTotalVnd = debts
    .filter((d) => d.status !== 'settled')
    .reduce((sum, d) => sum + d.amount_due_vnd, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left: Natural-Language Shop Assistant */}
      <div className="lg:col-span-7 space-y-5">
        <section aria-labelledby="assistant-heading" className="surface-card rounded-xl p-5 space-y-4">
          <div>
            <h2
              id="assistant-heading"
              className="text-[15px] font-semibold tracking-tight text-foreground"
            >
              Hỏi nhanh doanh thu & sổ nợ
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Xem nhanh tình hình bán hàng hôm nay, món bán chậm hoặc soạn tin nhắc khách quen.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {QUICK_PROMPTS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setPrompt(item.prompt);
                  void runCopilot(item.prompt);
                }}
                className="min-h-[36px] rounded-lg border border-border bg-[#FAF9F6] px-3 py-1.5 text-left text-xs font-medium text-foreground hover:bg-[#F3F1EC] cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {item.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runCopilot(prompt);
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <label htmlFor="copilot-prompt-input" className="sr-only">
              Câu hỏi về doanh thu hoặc sổ nợ
            </label>
            <Input
              id="copilot-prompt-input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ví dụ: Hôm nay bán được bao nhiêu? Soạn tin nhắc nợ chị Lan..."
              className="min-h-[44px] flex-1 bg-white rounded-lg text-sm"
            />
            <Button
              type="submit"
              disabled={isLoading}
              className="min-h-[44px] px-5 rounded-lg bg-primary text-primary-foreground hover:bg-[#8B0054] font-medium cursor-pointer shrink-0"
            >
              {isLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              <span>Hỏi ngay</span>
            </Button>
          </form>
        </section>

        {isLoading && (
          <section
            aria-label="Đang tổng hợp số liệu"
            className="surface-card rounded-xl p-5 space-y-3 animate-pulse"
          >
            <div className="h-4 w-40 rounded bg-[#F0EDE6]" />
            <div className="h-20 rounded-lg bg-[#F5F4F0]" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="h-20 rounded-lg bg-[#F5F4F0]" />
              <div className="h-20 rounded-lg bg-[#F5F4F0]" />
            </div>
          </section>
        )}

        {!isLoading && copilotData && (
          <section aria-labelledby="assistant-result-heading" className="surface-card rounded-xl p-5 space-y-4">
            <h3
              id="assistant-result-heading"
              className="text-[15px] font-semibold tracking-tight text-foreground"
            >
              Tổng hợp tình hình quán
            </h3>

            <p className="text-sm text-foreground leading-relaxed rounded-lg bg-[#FAF9F6] border border-border p-4 max-w-[68ch]">
              {copilotData.summaryVi}
            </p>

            {copilotData.highlightsVi.length > 0 && (
              <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-5 max-w-[68ch]">
                {copilotData.highlightsVi.map((h, idx) => (
                  <li key={idx} className="leading-relaxed">
                    {h}
                  </li>
                ))}
              </ul>
            )}

            {copilotData.slowMovingItems.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <TrendingDown className="size-4 text-[#B45309]" aria-hidden="true" />
                  <span>Món bán chậm nên đẩy combo</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {copilotData.slowMovingItems.map((item) => (
                    <div
                      key={item.sku}
                      className="rounded-lg border border-border bg-[#FAF9F6] p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{item.name}</span>
                        <span className="font-mono tabular-nums text-[11px] font-medium text-[#B45309] shrink-0">
                          {item.dailySoldCount} ly
                        </span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{item.suggestionVi}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {copilotData.invokedTools.length > 0 && (
              <div className="pt-3 border-t border-border text-[11px] text-muted-foreground">
                Đối chiếu từ:{' '}
                {copilotData.invokedTools
                  .map((tool) => TOOL_LABELS_VI[tool] ?? tool)
                  .join(' • ')}
              </div>
            )}
          </section>
        )}

        {!isLoading && !copilotData && (
          <section className="surface-card rounded-xl px-6 py-10 flex flex-col items-center text-center gap-3">
            <LedgerIllustration />
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
              Chọn một câu hỏi gợi ý bên trên để xem báo cáo doanh thu hôm nay, tìm món chậm và soạn sẵn tin nhắn nhắc nợ cho từng khách.
            </p>
          </section>
        )}
      </div>

      {/* Right: Customer Debt Ledger */}
      <div className="lg:col-span-5">
        <section aria-labelledby="debt-ledger-heading" className="surface-card rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
            <div>
              <h2
                id="debt-ledger-heading"
                className="text-[15px] font-semibold tracking-tight text-foreground"
              >
                Sổ nợ khách quen
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Chép nhanh tin nhắn nhắc nợ kèm sẵn mã QR đúng số tiền.
              </p>
            </div>
            {unpaidTotalVnd > 0 && (
              <div className="text-right shrink-0">
                <p className="text-[11px] text-muted-foreground">Còn phải thu</p>
                <p className="font-mono tabular-nums text-sm font-bold text-[#B45309]">
                  {formatVND(unpaidTotalVnd)}
                </p>
              </div>
            )}
          </div>

          {debts.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-muted-foreground">
              Không có khoản ghi sổ nào.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {debts.map((debt) => {
                const customerName = cleanCustomerDisplay(debt.customer_name);
                const channelHandle = cleanChannelDisplay(debt.channel_handle);
                const aiDraft = reminderDraftByOrder.get(debt.order_code.toUpperCase());
                const defaultMsg = `Dạ em chào ${customerName}, em gửi mình hóa đơn ${debt.order_code} (${debt.notes ?? 'đơn tại quán'}) số tiền ${formatVND(debt.amount_due_vnd)} ạ. Mình quét mã VietQR giúp quán nhé: ${debt.vietqr_url ?? ''}`;
                const copyText = aiDraft
                  ? `${aiDraft.messageVi}\nLink VietQR thanh toán: ${aiDraft.vietqrUrl}`
                  : defaultMsg;
                const isSettled = debt.status === 'settled';
                const qrToShow = aiDraft?.vietqrUrl ?? debt.vietqr_url;

                return (
                  <div key={debt.id} className="p-4 sm:px-5 space-y-3 bg-white">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {customerName}
                          </span>
                          <span className="font-mono text-[11px] text-muted-foreground bg-[#F4F2EC] px-1.5 py-0.5 rounded">
                            {debt.order_code}
                          </span>
                        </div>
                        {channelHandle && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {channelHandle}
                          </p>
                        )}
                        {debt.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">{debt.notes}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono tabular-nums text-sm font-bold text-foreground">
                          {formatVND(debt.amount_due_vnd)}
                        </p>
                        <span
                          className={`mt-1 inline-flex items-center gap-1.5 text-[11px] font-medium ${
                            isSettled ? 'text-[#0F766E]' : 'text-[#B45309]'
                          }`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              isSettled ? 'bg-[#0F766E]' : 'bg-[#B45309]'
                            }`}
                            aria-hidden="true"
                          />
                          {isSettled ? 'Đã thu đủ' : 'Chưa trả'}
                        </span>
                      </div>
                    </div>

                    {aiDraft && (
                      <div className="rounded-lg bg-[#FAF9F6] border border-border p-3 text-xs text-foreground leading-relaxed">
                        {aiDraft.messageVi}
                      </div>
                    )}

                    {openQrCode === debt.order_code && qrToShow && (
                      <div className="flex justify-center rounded-lg border border-border bg-[#FAF9F6] p-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={qrToShow}
                          alt={`Mã VietQR nhắc nợ ${debt.order_code}`}
                          className="w-44 h-auto rounded-md bg-white p-1 border border-border"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleCopyReminder(debt.order_code, copyText)}
                        className="min-h-[40px] flex-1 rounded-lg border-input bg-white text-foreground hover:bg-[#FAF9F6] cursor-pointer text-xs font-medium"
                      >
                        {copiedKey === debt.order_code ? (
                          <>
                            <Check className="size-3.5 text-[#0F766E]" aria-hidden="true" />
                            <span>Đã sao chép</span>
                          </>
                        ) : (
                          <>
                            <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />
                            <span>Chép tin nhắn & QR</span>
                          </>
                        )}
                      </Button>

                      {qrToShow && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setOpenQrCode((prev) =>
                              prev === debt.order_code ? null : debt.order_code
                            )
                          }
                          aria-label={`Hiện mã QR đơn ${debt.order_code}`}
                          className={`min-h-[40px] min-w-[40px] rounded-lg border-input cursor-pointer ${
                            openQrCode === debt.order_code
                              ? 'bg-[#FAF9F6] border-primary/40 text-primary'
                              : 'bg-white text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          <QrCode className="size-4" />
                        </Button>
                      )}

                      {!isSettled && (
                        <Button
                          type="button"
                          disabled={settlingId === debt.id}
                          onClick={() => void handleSettleDebt(debt.id, debt.order_code)}
                          className="min-h-[40px] rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white cursor-pointer text-xs font-medium"
                        >
                          {settlingId === debt.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                          )}
                          <span>Đã nhận tiền</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
});

function LedgerIllustration() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="text-[#A8A29E]"
    >
      <rect x="8" y="8" width="32" height="32" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 17h32" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M15 24h9M15 30h14M29 24h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
