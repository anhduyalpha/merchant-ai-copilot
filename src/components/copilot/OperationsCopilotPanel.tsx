'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
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
import { LocalVietQRCode } from '@/components/pos/LocalVietQRCode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CopilotAction } from '@/lib/ai/schemas';
import { cleanChannelDisplay, cleanCustomerDisplay, cleanMerchantCopy } from '@/lib/utils';
import { formatTransferReminderText, formatVND } from '@/lib/vietqr';
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
  onInspectOrderDetail: (orderIdOrCode: string) => void;
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
    .replace(
      /https?:\/\/img\.vietqr\.io\/\S*accountName=[A-Z0-9%+_.-]+(?:[ \t]+[A-Z0-9%+_-]{2,})*/g,
      ''
    )
    .replace(/https?:\/\/img\.vietqr\.io\/\S+/gi, '')
    .replace(/Link VietQR(?:\s+thanh toán)?:\s*[.,]?$/gim, '')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export const OperationsCopilotPanel = forwardRef<
  OperationsCopilotHandle,
  OperationsCopilotPanelProps
>(function OperationsCopilotPanel({ summary, menuItems, debts, onDebtSettled, onInspectOrderDetail }, ref) {
  const [prompt, setPrompt] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [openQrCode, setOpenQrCode] = useState<string | null>(null);
  const [copilotData, setCopilotData] = useState<CopilotAction | null>(null);
  const copilotReqIdRef = useRef(0);

  async function runCopilot(promptText: string) {
    const clean = promptText.trim();
    if (!clean) {
      toast.error('Hãy nhập câu hỏi để xem phân tích từ dữ liệu quán.');
      return;
    }

    const reqId = ++copilotReqIdRef.current;
    setIsLoading(true);
    try {
      const res = await fetch('/api/copilot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: clean }),
      });
      const data = await res.json();
      if (reqId !== copilotReqIdRef.current) return;
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Chưa nhận được phản hồi phân tích.');
      }
      setCopilotData(data.copilot as CopilotAction);
      toast.success('Đã tổng hợp báo cáo từ dữ liệu quán.');
    } catch (err) {
      if (reqId !== copilotReqIdRef.current) return;
      toast.error(err instanceof Error ? err.message : 'Lỗi phân tích dữ liệu.');
    } finally {
      if (reqId === copilotReqIdRef.current) {
        setIsLoading(false);
      }
    }
  }

  useImperativeHandle(ref, () => ({
    runDemoPrompt(promptText) {
      setPrompt(promptText);
      void runCopilot(promptText);
    },
    resetView() {
      copilotReqIdRef.current += 1;
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
    <div className="space-y-4">
      {/* Top Bento Analytics Row (Live from Supabase — zero empty state) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Light Harmonious MoMo Blush Shift Revenue Hero Card */}
        <section
          aria-labelledby="shift-hero-heading"
          className="xl:col-span-7 surface-blush relative overflow-hidden rounded-xl p-5 flex flex-col justify-between gap-4"
        >
          <div
            className="h-1 w-full absolute top-0 inset-x-0 bg-gradient-to-r from-[#A50064] via-[#D82D8B] to-[#F472B6]"
            aria-hidden="true"
          />

          <div className="flex flex-wrap items-start justify-between gap-4 pt-0.5">
            <div>
              <p id="shift-hero-heading" className="text-xs font-medium text-muted-foreground">
                Doanh thu thực thu trong ca
              </p>
              <p className="mt-1 font-sans tabular-nums text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                {formatVND(paidRevenueVnd)}
              </p>
            </div>

            <div className="flex gap-4 text-right">
              <div>
                <p className="text-[11px] text-muted-foreground">Đơn hoàn tất</p>
                <p className="mt-0.5 font-sans tabular-nums text-lg font-bold text-foreground">
                  {paidOrderCount}
                </p>
              </div>
              <div className="pl-4 border-l border-[#EFE0E9]">
                <p className="text-[11px] text-muted-foreground">Trung bình / đơn</p>
                <p className="mt-0.5 font-sans tabular-nums text-lg font-bold text-foreground">
                  {formatVND(avgTicketVnd)}
                </p>
              </div>
            </div>
          </div>

          {/* 3-Tile Payment Breakdown (Fills middle meaningfully without dark void) */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border border-[#EAE0E7] bg-white px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-2 rounded-full bg-[#A50064] shrink-0" aria-hidden="true" />
                <span className="truncate">Chuyển khoản</span>
              </div>
              <p className="mt-1 font-sans tabular-nums text-sm font-bold text-foreground">
                {formatVND(transferVnd)}
              </p>
            </div>

            <div className="rounded-lg border border-[#EAE0E7] bg-white px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-2 rounded-full bg-[#0F766E] shrink-0" aria-hidden="true" />
                <span className="truncate">Tiền mặt</span>
              </div>
              <p className="mt-1 font-sans tabular-nums text-sm font-bold text-foreground">
                {formatVND(cashVnd)}
              </p>
            </div>

            <div className="rounded-lg border border-[#EAE0E7] bg-white px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-2 rounded-full bg-[#B45309] shrink-0" aria-hidden="true" />
                <span className="truncate">Ghi sổ</span>
              </div>
              <p className="mt-1 font-sans tabular-nums text-sm font-bold text-[#B45309]">
                {formatVND(totalOpenDebtVnd)}
              </p>
            </div>
          </div>

          {/* Payment Mix Split Bar */}
          <div className="h-2 w-full rounded-full bg-[#F1E6EE] overflow-hidden flex">
            {transferPct > 0 && (
              <div
                className="h-full bg-[#A50064]"
                style={{ width: `${transferPct}%` }}
                title={`Chuyển khoản: ${formatVND(transferVnd)}`}
              />
            )}
            {cashPct > 0 && (
              <div
                className="h-full bg-[#0F766E]"
                style={{ width: `${cashPct}%` }}
                title={`Tiền mặt: ${formatVND(cashVnd)}`}
              />
            )}
            {debtPct > 0 && (
              <div
                className="h-full bg-[#D97706]"
                style={{ width: `${debtPct}%` }}
                title={`Ghi sổ: ${formatVND(totalOpenDebtVnd)}`}
              />
            )}
          </div>
        </section>

        {/* Live Menu Performance Card */}
        <section aria-labelledby="menu-perf-heading" className="xl:col-span-5 surface-card rounded-xl p-5 space-y-3.5">
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
                    <span className="font-sans tabular-nums text-muted-foreground shrink-0">
                      {item.daily_sold_count} ly
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#F3EBF0] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#A50064] to-[#D82D8B]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {slowSellers.length > 0 && (
            <div className="pt-2.5 border-t border-[#EAE0E7] space-y-1.5">
              <p className="text-[11px] font-semibold text-[#B45309] inline-flex items-center gap-1">
                <TrendingDown className="size-3.5" aria-hidden="true" />
                Cần đẩy bán trong ca
              </p>
              <div className="flex flex-wrap gap-2">
                {slowSellers.map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#F3DFB4] bg-[#FFFBEB] px-2.5 py-1 text-xs text-foreground"
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="font-sans tabular-nums text-[11px] text-[#B45309]">
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
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Left 7 Columns: Natural-Language Shop Copilot */}
        <div className="xl:col-span-7 flex">
          <section
            aria-labelledby="assistant-heading"
            className="w-full surface-card rounded-xl p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-4">
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
                    className="min-h-[34px] rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] px-3 py-1.5 text-left text-xs font-medium text-foreground hover:bg-[#FDF2F8] hover:border-[#EAB8D2] hover:text-[#A50064] transition-colors cursor-pointer"
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
                  placeholder="Hỏi về doanh thu, món bán chậm hoặc nhắc khách ghi sổ..."
                  className="min-h-[42px] flex-1 bg-white border-[#DFD1DB] rounded-lg text-sm"
                />
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="min-h-[42px] px-5 rounded-lg bg-primary text-primary-foreground hover:bg-[#8B0054] font-semibold text-sm cursor-pointer shrink-0 shadow-xs"
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
                <div className="rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] p-4 space-y-2.5 animate-pulse">
                  <div className="h-4 w-48 rounded bg-[#EFE0E9]" />
                  <div className="h-14 rounded-lg bg-[#F5EEF3]" />
                </div>
              )}

              {!isLoading && copilotData && (
                <div className="rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] p-4 space-y-3.5">
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

                  <p className="text-sm text-foreground leading-relaxed rounded-lg bg-white border border-[#EAE0E7] p-3.5">
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
                            className="rounded-lg border border-[#F3DFB4] bg-[#FFFBEB] p-3 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-foreground">{item.name}</span>
                              <span className="font-sans tabular-nums text-[11px] font-semibold text-[#B45309]">
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
            </div>

            {!isLoading && !copilotData && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 rounded-lg border border-[#F0D2E2] bg-[#FFF8FB] p-3.5 text-xs">
                <div>
                  <p className="text-[11px] text-muted-foreground">Khách ghi sổ chưa tất toán</p>
                  <p className="mt-0.5 font-sans tabular-nums font-semibold text-foreground">
                    {debts.filter((d) => d.status !== 'settled').length} khách •{' '}
                    <span className="text-[#B45309]">{formatVND(totalOpenDebtVnd)}</span>
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Món cần đẩy bán chiều nay</p>
                  <p className="mt-0.5 font-sans tabular-nums font-semibold text-foreground">
                    {slowSellers.length} món có lượng gọi thấp
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Right 5 Columns: Customer Debt Ledger */}
        <div className="xl:col-span-5 flex">
          <section aria-labelledby="debt-ledger-heading" className="w-full surface-card rounded-xl p-5 space-y-3.5">
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
                <p className="font-sans tabular-nums text-sm font-bold text-[#B45309]">
                  {formatVND(totalOpenDebtVnd)}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {debts.length === 0 ? (
                <div className="rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] px-4 py-6 text-center text-xs text-muted-foreground">
                  Chưa có khách nào ghi sổ công nợ trong ca này.
                </div>
              ) : (
                debts.map((debt) => {
                  const aiDraft = reminderDraftByOrder.get(debt.order_code.toUpperCase());
                  const customerLabel = cleanCustomerDisplay(debt.customer_name);
                  const channelLabel = cleanChannelDisplay(debt.channel_handle);
                  const fallbackTransferText = formatTransferReminderText({
                    customerName: customerLabel,
                    orderCode: debt.order_code,
                    amountVnd: debt.amount_due_vnd,
                    notes: debt.notes,
                  });
                  const previewText = aiDraft
                    ? stripRawQrUrl(cleanMerchantCopy(aiDraft.messageVi))
                    : null;
                  const copyText = previewText
                    ? `${previewText}\n${fallbackTransferText.split('\n').slice(1).join('\n')}`
                    : fallbackTransferText;
                  const isSettled = debt.status === 'settled';

                  return (
                    <div
                      key={debt.id}
                      className="rounded-lg border border-[#EAE0E7] bg-[#FBF8FA]/60 p-3.5 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {customerLabel}
                            </span>
                            <button
                              type="button"
                              onClick={() => onInspectOrderDetail(debt.order_id ?? debt.order_code)}
                              className="rounded bg-[#F5EEF3] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#A50064] hover:bg-[#FDF2F8] hover:underline cursor-pointer"
                            >
                              {debt.order_code}
                            </button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{channelLabel}</p>
                          {debt.notes && (
                            <p className="text-xs text-muted-foreground mt-0.5">{debt.notes}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-sans tabular-nums text-sm font-bold text-foreground">
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
                        <div className="rounded-lg bg-white border border-[#EAE0E7] p-2.5 text-xs text-foreground leading-relaxed break-words [overflow-wrap:anywhere]">
                          {previewText}
                        </div>
                      )}

                      {openQrCode === debt.order_code && (
                        <div className="flex justify-center rounded-lg border border-[#EAE0E7] bg-white p-3">
                          <LocalVietQRCode
                            amount={debt.amount_due_vnd}
                            addInfo={debt.order_code}
                            orderCode={debt.order_code}
                            compact
                            showDownload
                          />
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleCopyReminder(debt.order_code, copyText)}
                          className="min-h-[38px] flex-1 rounded-lg border-[#EAE0E7] bg-white text-foreground hover:bg-[#FDF2F8] hover:border-[#EAB8D2] cursor-pointer text-xs font-medium"
                        >
                          {copiedKey === debt.order_code ? (
                            <Check className="size-3.5 text-[#0F766E]" aria-hidden="true" />
                          ) : (
                            <Copy className="size-3.5 text-muted-foreground" aria-hidden="true" />
                          )}
                          <span>Chép tin nhắn & STK</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setOpenQrCode((prev) =>
                              prev === debt.order_code ? null : debt.order_code
                            )
                          }
                          aria-label={`Xem mã VietQR đơn ${debt.order_code}`}
                          className="min-h-[38px] min-w-[38px] rounded-lg border-[#EAE0E7] bg-white hover:bg-[#FDF2F8] hover:border-[#EAB8D2] cursor-pointer"
                        >
                          <QrCode className="size-4 text-primary" />
                        </Button>
                        {!isSettled && (
                          <Button
                            type="button"
                            disabled={settlingId === debt.id}
                            onClick={() => void handleSettleDebt(debt.id, debt.order_code)}
                            className="min-h-[38px] rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46] hover:bg-[#D1FAE5] cursor-pointer text-xs font-semibold shadow-none"
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
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});
