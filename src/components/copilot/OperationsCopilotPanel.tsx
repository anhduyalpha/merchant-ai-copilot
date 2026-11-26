'use client';

import { forwardRef, useImperativeHandle, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  QrCode,
  Send,
  Sparkles,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { CopilotAction } from '@/lib/ai/schemas';
import { formatVND } from '@/lib/vietqr';
import type { CustomerDebtRow } from '@/types/database';

export interface OperationsCopilotHandle {
  runDemoPrompt: (promptText: string) => void;
}

interface OperationsCopilotPanelProps {
  debts: CustomerDebtRow[];
  onDebtSettled: () => Promise<void>;
}

const QUICK_PROMPTS = [
  'Tổng kết doanh thu hôm nay, tìm món bán chậm và soạn tin nhắn nhắc nợ kèm link VietQR cho khách quen',
  'Món nào hôm nay đang bán chậm nhất? Gợi ý giúp tôi combo đẩy bán buổi chiều',
  'Soạn giúp tôi tin nhắn nhắc nợ lịch sự qua Zalo cho các đơn chưa thu tiền',
] as const;

export const OperationsCopilotPanel = forwardRef<
  OperationsCopilotHandle,
  OperationsCopilotPanelProps
>(function OperationsCopilotPanel({ debts, onDebtSettled }, ref) {
  const [prompt, setPrompt] = useState<string>(QUICK_PROMPTS[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openQrCode, setOpenQrCode] = useState<string | null>(null);
  const [copilotData, setCopilotData] = useState<CopilotAction | null>(null);

  async function runCopilot(promptText: string) {
    const clean = promptText.trim();
    if (!clean) {
      toast.error('Vui lòng nhập câu hỏi cho Trợ lý điều hành.');
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
        throw new Error(data.message || 'Trợ lý điều hành không phản hồi.');
      }
      setCopilotData(data.copilot as CopilotAction);
      toast.success('Trợ lý đã phân tích xong dữ liệu cửa hàng.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi gọi Trợ lý điều hành.');
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
      toast.error('Không sao chép được tự động, hãy chọn và copy thủ công.');
    }
  }

  async function handleSettleDebt(debtId: string, orderCode: string) {
    setSettlingId(debtId);
    try {
      const res = await fetch(`/api/debts/${debtId}/settle`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể đánh dấu đã thu.');
      }
      toast.success(`Đã tất toán công nợ đơn ${orderCode}.`);
      await onDebtSettled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi tất toán công nợ.');
    } finally {
      setSettlingId(null);
    }
  }

  const reminderDraftByOrder = new Map(
    (copilotData?.debtReminders ?? []).map((r) => [r.orderCode.toUpperCase(), r])
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Natural Language Copilot */}
      <div className="lg:col-span-7 space-y-5">
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              Trợ lý Điều hành Cửa hàng
            </CardTitle>
            <CardDescription>
              Hỏi đáp bằng tiếng Việt tự nhiên trên dữ liệu doanh thu, tồn món và sổ nợ thực tế.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setPrompt(q);
                    void runCopilot(q);
                  }}
                  className="min-h-[36px] rounded-full border border-primary/25 bg-secondary/70 px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground hover:bg-secondary cursor-pointer transition-colors"
                >
                  {q}
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
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Hỏi về doanh thu hôm nay, món bán chậm hoặc soạn tin nhắc nợ..."
                className="min-h-[44px] flex-1 bg-white"
              />
              <Button
                type="submit"
                disabled={isLoading}
                className="min-h-[44px] px-5 bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                <span>Hỏi Copilot</span>
              </Button>
            </form>
          </CardContent>
        </Card>

        {copilotData && (
          <Card className="border-primary/25 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">Phân tích điều hành từ AI</CardTitle>
                <div className="flex flex-wrap gap-1.5">
                  {copilotData.invokedTools.map((tool) => (
                    <Badge key={tool} variant="secondary" className="font-mono text-[11px]">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-foreground leading-relaxed bg-secondary/35 rounded-xl p-3.5 border border-primary/15">
                {copilotData.summaryVi}
              </p>

              {copilotData.highlightsVi.length > 0 && (
                <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-5">
                  {copilotData.highlightsVi.map((h, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {h}
                    </li>
                  ))}
                </ul>
              )}

              {copilotData.slowMovingItems.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <TrendingDown className="size-4 text-amber-600" aria-hidden="true" />
                    Món bán chậm cần đẩy combo
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {copilotData.slowMovingItems.map((item) => (
                      <div
                        key={item.sku}
                        className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-foreground">{item.name}</span>
                          <Badge variant="outline" className="bg-white border-amber-300 text-amber-800">
                            Đã bán {item.dailySoldCount}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground leading-relaxed">{item.suggestionVi}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right: Regular-Customer Debt Cards */}
      <div className="lg:col-span-5 space-y-4">
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Wallet className="size-4 text-primary" aria-hidden="true" />
              Sổ nợ khách quen & Nhắc nợ VietQR
            </CardTitle>
            <CardDescription>
              Sao chép nhanh tin nhắn Zalo lịch sự kèm sẵn mã QR đúng số tiền nợ.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {debts.map((debt) => {
              const aiDraft = reminderDraftByOrder.get(debt.order_code.toUpperCase());
              const defaultMsg = `Dạ em chào ${debt.customer_name}, em gửi lại mình hóa đơn ${debt.order_code} (${debt.notes ?? 'đơn tại quán'}) số tiền ${formatVND(debt.amount_due_vnd)} ạ. Mình quét mã VietQR giúp quán nhé: ${debt.vietqr_url ?? ''}`;
              const copyText = aiDraft
                ? `${aiDraft.messageVi}\nLink VietQR thanh toán: ${aiDraft.vietqrUrl}`
                : defaultMsg;
              const isSettled = debt.status === 'settled';
              const qrToShow = aiDraft?.vietqrUrl ?? debt.vietqr_url;

              return (
                <div
                  key={debt.id}
                  className="rounded-2xl border border-border bg-white p-3.5 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {debt.customer_name}
                        </span>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {debt.order_code}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{debt.channel_handle}</p>
                      {debt.notes && (
                        <p className="text-xs text-muted-foreground mt-0.5">{debt.notes}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-primary">
                        {formatVND(debt.amount_due_vnd)}
                      </p>
                      <Badge
                        className={
                          isSettled
                            ? 'mt-1 bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'mt-1 bg-amber-100 text-amber-800 border-amber-200'
                        }
                      >
                        {isSettled ? 'Đã tất toán' : 'Chưa thu'}
                      </Badge>
                    </div>
                  </div>

                  {aiDraft && (
                    <div className="rounded-xl bg-secondary/45 border border-primary/15 p-2.5 text-xs text-foreground leading-relaxed">
                      {aiDraft.messageVi}
                    </div>
                  )}

                  {openQrCode === debt.order_code && qrToShow && (
                    <div className="flex justify-center rounded-xl border border-border bg-secondary/20 p-2">
                      <img
                        src={qrToShow}
                        alt={`VietQR nhắc nợ ${debt.order_code}`}
                        className="w-44 h-auto rounded-lg bg-white"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleCopyReminder(debt.order_code, copyText)}
                      className="min-h-[44px] flex-1 border-primary/30 text-primary hover:bg-primary/8 cursor-pointer text-xs"
                    >
                      {copiedKey === debt.order_code ? (
                        <Check className="size-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3.5" aria-hidden="true" />
                      )}
                      <span>Copy tin nhắn + VietQR</span>
                    </Button>
                    {qrToShow && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          setOpenQrCode((prev) =>
                            prev === debt.order_code ? null : debt.order_code
                          )
                        }
                        aria-label={`Xem mã VietQR đơn ${debt.order_code}`}
                        className="min-h-[44px] min-w-[44px] border border-border cursor-pointer"
                      >
                        <QrCode className="size-4 text-primary" />
                      </Button>
                    )}
                    {!isSettled && (
                      <Button
                        type="button"
                        disabled={settlingId === debt.id}
                        onClick={() => void handleSettleDebt(debt.id, debt.order_code)}
                        className="min-h-[44px] bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer text-xs"
                      >
                        {settlingId === debt.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        )}
                        <span>Đánh dấu đã thu</span>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
});
