'use client';

import Image from 'next/image';
import { forwardRef, useImperativeHandle, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  QrCode,
  Send,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import type { StoreSummary } from '@/components/MerchantWorkspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CopilotAction } from '@/lib/ai/schemas';
import { cleanChannelDisplay, cleanCustomerDisplay, cleanMerchantCopy } from '@/lib/utils';
import { formatVND } from '@/lib/vietqr';
import type { CustomerDebtRow, MenuItemRow } from '@/types/database';

export interface OperationsCopilotHandle {
  runDemoPrompt: (promptText: string) => void;
  resetView: () => void;
}

interface OperationsCopilotPanelProps {
  summary: StoreSummary | null;
  menuItems: MenuItemRow[];
  debts: CustomerDebtRow[];
  onDebtSettled: () => Promise<void>;
}

const QUICK_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: 'Tổng kết ca hôm nay',
    prompt:
      'Tổng kết ca hôm nay, xem món nào cần đẩy bán và soạn tin nhắn nhắc khách còn ghi sổ kèm mã VietQR',
  },
  {
    label: 'Gợi ý combo đẩy món bán chậm',
    prompt: 'Món nào hôm nay đang bán chậm nhất? Gợi ý giúp tôi combo đẩy bán buổi chiều',
  },
  {
    label: 'Soạn tin nhắn nhắc khách ghi sổ',
    prompt: 'Soạn giúp tôi tin nhắn nhắc nợ lịch sự qua Zalo cho các đơn chưa thu tiền',
  },
];

const TOOL_LABELS_VI: Record<string, string> = {
  get_daily_revenue: 'Doanh thu trong ngày',
  get_slow_moving_items: 'Thống kê thực đơn',
  get_unpaid_debts: 'Sổ nợ khách quen',
};

function stripRawQrUrl(text: string): string {
  return text
    .replace(/https?:\/\/img\.vietqr\.io\/\S+/gi, '')
    .replace(/Link VietQR(?:\s+thanh toán)?:\s*$/gim, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const OperationsCopilotPanel = forwardRef<
  OperationsCopilotHandle,
  OperationsCopilotPanelProps
>(function OperationsCopilotPanel({ summary, menuItems, debts, onDebtSettled }, ref) {
  const [prompt, setPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openQrCode, setOpenQrCode] = useState<string | null>(null);
  const [copilotData, setCopilotData] = useState<CopilotAction | null>(null);

  async function runCopilot(promptText: string) {
    const clean = promptText.trim();
    if (!clean) {
      toast.error('Hãy nhập câu hỏi để xem phân tích từ dữ liệu quán.');
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
        throw new Error(data.message || 'Chưa nhận được phản hồi phân tích.');
      }
      setCopilotData(data.copilot as CopilotAction);
      toast.success('Đã tổng hợp báo cáo từ dữ liệu quán.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi phân tích dữ liệu.');
    } finally {
      setIsLoading(false);
    }
  }

  useImperativeHandle(ref, () => ({
    runDemoPrompt(promptText) {
      setPrompt(promptText);
      void runCopilot(promptText);
    },
    resetView() {
      setPrompt('');
      setCopilotData(null);
      setOpenQrCode(null);
      setCopiedKey(null);
    },
  }));

  async function handleCopyReminder(key: string, textToCopy: string) {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedKey(key);
      toast.success('Đã sao chép tin nhắn kèm mã VietQR.');
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error('Không sao chép được tự động, hãy chọn và chép thủ công.');
    }
  }

  async function handleSettleDebt(debtId: string, orderCode: string) {
    setSettlingId(debtId);
    try {
      const res = await fetch(`/api/debts/${debtId}/settle`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể xác nhận đã thu.');
      }
      toast.success(`Đã xác nhận thu đủ đơn ${orderCode}.`);
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
  const totalOpenDebtVnd = debts
    .filter((d) => d.status !== 'settled')
    .reduce((sum, d) => sum + d.amount_due_vnd, 0);

  // Live analytics computations (always populated on load)
  const paidRevenueVnd = summary?.paidRevenueVnd ?? 0;
  const paidOrderCount = summary?.paidOrderCount ?? 0;
  const avgTicketVnd = paidOrderCount > 0 ? Math.round(paidRevenueVnd / paidOrderCount) : 0;
  const transferVnd = summary?.transferCollectedVnd ?? 0;
  const cashVnd = summary?.cashCollectedVnd ?? 0;
  const totalMixDenominator = Math.max(1, transferVnd + cashVnd + totalOpenDebtVnd);
  const transferPct = Math.round((transferVnd / totalMixDenominator) * 100);
  const cashPct = Math.round((cashVnd / totalMixDenominator) * 100);
  const debtPct = Math.max(0, 100 - transferPct - cashPct);

  const sortedMenuBySales = [...menuItems].sort((a, b) => b.daily_sold_count - a.daily_sold_count);
  const topSellers = sortedMenuBySales.slice(0, 3);
  const slowSellers = [...menuItems]
    .filter((m) => m.is_available && m.daily_sold_count <= 5)
    .sort((a, b) => a.daily_sold_count - b.daily_sold_count)
    .slice(0, 2);
  const maxSoldCount = Math.max(1, topSellers[0]?.daily_sold_count ?? 1);

  return (
    <div className="space-y-5">
      {/* Top Bento Analytics Row (Live from Supabase — zero empty state) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Dark Smoked-Glass Shift Revenue Hero Card */}
        <section aria-labelledby="shift-hero-heading" className="xl:col-span-7 glass-dark relative overflow-hidden rounded-2xl p-6 flex flex-col justify-between gap-5">
          <div
            className="pointer-events-none absolute -top-24 -right-12 h-56 w-72 rounded-full blur-[80px]"
            style={{ background: 'radial-gradient(circle, rgba(165, 0, 100, 0.36) 0%, transparent 72%)' }}
            aria-hidden="true"
          />

          <div className="relative flex flex-wrap items-start justify-between gap-4">
            <div>
              <p id="shift-hero-heading" className="text-xs font-medium text-white/65">
                Doanh thu thực thu trong ca
              </p>
              <p className="mt-1 font-mono tabular-nums text-3xl sm:text-4xl font-bold tracking-tight text-white">
                {formatVND(paidRevenueVnd)}
              </p>
            </div>

            <div className="flex gap-4 text-right">
              <div>
                <p className="text-[11px] text-white/60">Đơn hoàn tất</p>
                <p className="mt-0.5 font-mono tabular-nums text-lg font-bold text-white">
                  {paidOrderCount}
                </p>
              </div>
              <div className="pl-4 border-l border-white/15">
                <p className="text-[11px] text-white/60">Trung bình / đơn</p>
                <p className="mt-0.5 font-mono tabular-nums text-lg font-bold text-white">
                  {formatVND(avgTicketVnd)}
                </p>
              </div>
            </div>
          </div>

          {/* Payment Mix Split Bar */}
          <div className="relative space-y-2.5">
            <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden flex">
              {transferPct > 0 && (
                <div
                  className="h-full bg-[#D82D8B]"
                  style={{ width: `${transferPct}%` }}
                  title={`Chuyển khoản: ${formatVND(transferVnd)}`}
                />
              )}
              {cashPct > 0 && (
                <div
                  className="h-full bg-emerald-400"
                  style={{ width: `${cashPct}%` }}
                  title={`Tiền mặt: ${formatVND(cashVnd)}`}
                />
              )}
              {debtPct > 0 && (
                <div
                  className="h-full bg-amber-400"
                  style={{ width: `${debtPct}%` }}
                  title={`Ghi sổ: ${formatVND(totalOpenDebtVnd)}`}
                />
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/75">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-[#D82D8B]" aria-hidden="true" />
                Chuyển khoản:{' '}
                <strong className="font-mono tabular-nums text-white">{formatVND(transferVnd)}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
                Tiền mặt:{' '}
                <strong className="font-mono tabular-nums text-white">{formatVND(cashVnd)}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-amber-400" aria-hidden="true" />
                Ghi sổ:{' '}
                <strong className="font-mono tabular-nums text-amber-200">{formatVND(totalOpenDebtVnd)}</strong>
              </span>
            </div>
          </div>
        </section>

        {/* Live Menu Performance Card */}
        <section aria-labelledby="menu-perf-heading" className="xl:col-span-5 glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="menu-perf-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
              Hiệu suất thực đơn
            </h2>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-[#0F766E]">
              <TrendingUp className="size-3.5" aria-hidden="true" />
              Món bán chạy
            </span>
          </div>

          <div className="space-y-2.5">
            {topSellers.map((item) => {
              const pct = Math.max(12, Math.round((item.daily_sold_count / maxSoldCount) * 100));
              return (
                <div key={item.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground truncate">{item.name}</span>
                    <span className="font-mono tabular-nums text-muted-foreground shrink-0">
                      {item.daily_sold_count} ly
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-black/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {slowSellers.length > 0 && (
            <div className="pt-2.5 border-t border-border/75 space-y-1.5">
              <p className="text-[11px] font-semibold text-[#B45309] inline-flex items-center gap-1">
                <TrendingDown className="size-3.5" aria-hidden="true" />
                Cần đẩy bán trong ca
              </p>
              <div className="flex flex-wrap gap-2">
                {slowSellers.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#B45309]/20 bg-[#FFFBEB]/80 px-2.5 py-1 text-xs text-foreground"
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="font-mono tabular-nums text-[11px] text-[#B45309]">
                      ({item.daily_sold_count} ly)
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Lower 12-Col Split: Shop Assistant + Debt Ledger */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 7 Columns: Natural-Language Shop Copilot */}
        <div className="xl:col-span-7 space-y-4">
          <section aria-labelledby="assistant-heading" className="glass-panel rounded-2xl p-5 space-y-4">
            <div>
              <h2 id="assistant-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                Trợ lý điều hành
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hỏi đáp trực tiếp trên số liệu doanh thu, thực đơn và sổ nợ của quán.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setPrompt(item.prompt);
                    void runCopilot(item.prompt);
                  }}
                  className="min-h-[34px] rounded-xl border border-white/90 bg-white/75 px-3 py-1.5 text-left text-xs font-medium text-foreground hover:bg-white hover:border-primary/30 transition-colors cursor-pointer"
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
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                aria-label="Câu hỏi cho trợ lý điều hành"
                placeholder="Hỏi về doanh thu ca, món cần đẩy bán hoặc soạn tin nhắc khách ghi sổ..."
                className="min-h-[44px] flex-1 bg-white/85 border-white/90 rounded-xl text-sm"
              />
              <Button
                type="submit"
                disabled={isLoading}
                className="min-h-[44px] px-5 rounded-xl bg-primary text-primary-foreground hover:bg-[#8B0054] font-semibold text-sm cursor-pointer shrink-0"
              >
                {isLoading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                <span>Hỏi ngay</span>
              </Button>
            </form>

            {isLoading && (
              <div className="rounded-xl border border-white/80 bg-white/60 p-4 space-y-2.5 animate-pulse">
                <div className="h-4 w-48 rounded bg-black/10" />
                <div className="h-14 rounded-lg bg-black/5" />
              </div>
            )}

            {!isLoading && copilotData && (
              <div className="rounded-xl border border-white/90 bg-white/80 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">Phân tích tổng hợp</span>
                  {copilotData.invokedTools.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      Nguồn:{' '}
                      {copilotData.invokedTools
                        .map((t) => TOOL_LABELS_VI[t] ?? t)
                        .join(' • ')}
                    </span>
                  )}
                </div>

                <p className="text-sm text-foreground leading-relaxed rounded-xl bg-[#F4F3F8]/80 border border-border/60 p-3.5">
                  {cleanMerchantCopy(copilotData.summaryVi)}
                </p>

                {copilotData.highlightsVi.length > 0 && (
                  <ul className="space-y-1.5 text-xs text-muted-foreground list-disc pl-5">
                    {copilotData.highlightsVi.map((h, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {cleanMerchantCopy(h)}
                      </li>
                    ))}
                  </ul>
                )}

                {copilotData.slowMovingItems.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <TrendingDown className="size-4 text-[#B45309]" aria-hidden="true" />
                      Gợi ý đẩy món bán chậm
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {copilotData.slowMovingItems.map((item) => (
                        <div
                          key={item.sku}
                          className="rounded-xl border border-[#B45309]/20 bg-[#FFFBEB]/80 p-3 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-foreground">{item.name}</span>
                            <span className="font-mono tabular-nums text-[11px] font-semibold text-[#B45309]">
                              {item.dailySoldCount} ly
                            </span>
                          </div>
                          <p className="text-muted-foreground leading-relaxed">
                            {cleanMerchantCopy(item.suggestionVi)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!isLoading && !copilotData && (
              <div className="rounded-xl border border-white/85 bg-white/55 px-4 py-3 text-xs text-muted-foreground flex items-center justify-between gap-3">
                <span>
                  Tóm tắt nhanh: Đang có{' '}
                  <strong className="font-mono tabular-nums text-foreground">
                    {debts.filter((d) => d.status !== 'settled').length}
                  </strong>{' '}
                  khách ghi sổ ({formatVND(totalOpenDebtVnd)}) và{' '}
                  <strong className="font-mono tabular-nums text-foreground">{slowSellers.length}</strong>{' '}
                  món cần đẩy bán chiều nay.
                </span>
              </div>
            )}
          </section>
        </div>

        {/* Right 5 Columns: Customer Debt Ledger */}
        <div className="xl:col-span-5">
          <section aria-labelledby="debt-ledger-heading" className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="debt-ledger-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                  Sổ công nợ
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sao chép tin nhắn nhắc khéo kèm sẵn mã VietQR đúng số tiền.
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-muted-foreground">Còn phải thu</p>
                <p className="font-mono tabular-nums text-sm font-bold text-[#B45309]">
                  {formatVND(totalOpenDebtVnd)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {debts.map((debt) => {
                const aiDraft = reminderDraftByOrder.get(debt.order_code.toUpperCase());
                const customerLabel = cleanCustomerDisplay(debt.customer_name);
                const channelLabel = cleanChannelDisplay(debt.channel_handle);
                const defaultMsg = `Dạ em chào ${customerLabel}, em gửi lại mình hóa đơn ${debt.order_code} (${debt.notes ?? 'đơn tại quán'}) số tiền ${formatVND(debt.amount_due_vnd)} ạ. Mình quét mã VietQR giúp quán nhé: ${debt.vietqr_url ?? ''}`;
                const copyText = aiDraft
                  ? `${cleanMerchantCopy(aiDraft.messageVi)}\nMã VietQR thanh toán: ${aiDraft.vietqrUrl}`
                  : defaultMsg;
                const previewText = aiDraft ? stripRawQrUrl(cleanMerchantCopy(aiDraft.messageVi)) : null;
                const isSettled = debt.status === 'settled';
                const qrToShow = aiDraft?.vietqrUrl ?? debt.vietqr_url;

                return (
                  <div
                    key={debt.id}
                    className="rounded-xl border border-white/90 bg-white/80 p-3.5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {customerLabel}
                          </span>
                          <span className="rounded bg-black/[0.045] px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                            {debt.order_code}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{channelLabel}</p>
                        {debt.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5">{debt.notes}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-mono tabular-nums text-sm font-bold text-foreground">
                          {formatVND(debt.amount_due_vnd)}
                        </p>
                        <span
                          className={`mt-1 inline-flex items-center gap-1 text-[11px] font-medium ${
                            isSettled ? 'text-[#0F766E]' : 'text-[#B45309]'
                          }`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${isSettled ? 'bg-[#0F766E]' : 'bg-[#B45309]'}`}
                            aria-hidden="true"
                          />
                          {isSettled ? 'Đã tất toán' : 'Chưa trả'}
                        </span>
                      </div>
                    </div>

                    {previewText && (
                      <div className="rounded-lg bg-[#F4F3F8]/85 border border-border/60 p-2.5 text-xs text-foreground leading-relaxed break-words [overflow-wrap:anywhere]">
                        {previewText}
                      </div>
                    )}

                    {openQrCode === debt.order_code && qrToShow && (
                      <div className="flex justify-center rounded-xl border border-border/70 bg-white p-2.5">
                        <Image
                          src={qrToShow}
                          alt={`Mã VietQR đơn ${debt.order_code}`}
                          width={176}
                          height={208}
                          unoptimized
                          className="w-44 h-auto rounded"
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void handleCopyReminder(debt.order_code, copyText)}
                        className="min-h-[40px] flex-1 rounded-xl border-border bg-white text-foreground hover:bg-white/90 cursor-pointer text-xs font-medium"
                      >
                        {copiedKey === debt.order_code ? (
                          <Check className="size-3.5 text-[#0F766E]" aria-hidden="true" />
                        ) : (
                          <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span>Chép tin nhắn & QR</span>
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
                          aria-label={`Xem mã VietQR đơn ${debt.order_code}`}
                          className="min-h-[40px] min-w-[40px] rounded-xl border-border bg-white cursor-pointer"
                        >
                          <QrCode className="size-4 text-primary" />
                        </Button>
                      )}
                      {!isSettled && (
                        <Button
                          type="button"
                          disabled={settlingId === debt.id}
                          onClick={() => void handleSettleDebt(debt.id, debt.order_code)}
                          className="min-h-[40px] rounded-xl bg-[#0F766E] hover:bg-[#0D625B] text-white cursor-pointer text-xs font-medium"
                        >
                          {settlingId === debt.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                          )}
                          <span>Xác nhận đã thu</span>
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});
