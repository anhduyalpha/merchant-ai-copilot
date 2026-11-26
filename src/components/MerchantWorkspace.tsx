'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Coffee,
  Play,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  OperationsCopilotPanel,
  type OperationsCopilotHandle,
} from '@/components/copilot/OperationsCopilotPanel';
import { JudgeDemoBar, type JudgePresetId } from '@/components/demo/JudgeDemoBar';
import {
  OrderIntakePanel,
  type OrderIntakeHandle,
  type StoreOrderWithItems,
} from '@/components/pos/OrderIntakePanel';
import {
  ReceiptFraudInspector,
  type ReceiptFraudInspectorHandle,
} from '@/components/receipt/ReceiptFraudInspector';
import { formatVND } from '@/lib/vietqr';
import type { CustomerDebtRow, PaymentReceiptRow } from '@/types/database';

interface HealthSnapshot {
  status: string;
  ai: {
    activeProvider: string;
    activeProviderReady: boolean;
    geminiModelId: string;
    bedrockModelId: string;
  };
  supabase: {
    connected: boolean;
  };
}

interface StoreStateSnapshot {
  summary: {
    totalOrders: number;
    paidOrderCount: number;
    pendingOrderCount: number;
    debtOrderCount: number;
    paidRevenueVnd: number;
    cashCollectedVnd: number;
    transferCollectedVnd: number;
    unpaidDebtVnd: number;
    unpaidDebtCount: number;
    flaggedReceiptCount: number;
  };
  orders: StoreOrderWithItems[];
  paymentReceipts: PaymentReceiptRow[];
  customerDebts: CustomerDebtRow[];
}

type WorkspaceTab = 'pos' | 'receipt' | 'copilot';

export function MerchantWorkspace() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('pos');
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [storeState, setStoreState] = useState<StoreStateSnapshot | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [isResetting, setIsResetting] = useState(false);
  const [activePreset, setActivePreset] = useState<JudgePresetId | null>(null);
  const [demoBarOpen, setDemoBarOpen] = useState(true);
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);

  const orderPanelRef = useRef<OrderIntakeHandle>(null);
  const receiptPanelRef = useRef<ReceiptFraudInspectorHandle>(null);
  const copilotPanelRef = useRef<OperationsCopilotHandle>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [healthRes, storeRes] = await Promise.all([
        fetch('/api/health', { cache: 'no-store' }),
        fetch('/api/store/state', { cache: 'no-store' }),
      ]);
      if (healthRes.ok) {
        const h = (await healthRes.json()) as HealthSnapshot;
        setHealth(h);
      }
      if (storeRes.ok) {
        const s = (await storeRes.json()) as StoreStateSnapshot;
        setStoreState(s);
      }
    } catch {
      toast.error('Không thể tải dữ liệu cửa hàng.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [healthRes, storeRes] = await Promise.all([
          fetch('/api/health', { cache: 'no-store' }),
          fetch('/api/store/state', { cache: 'no-store' }),
        ]);
        if (!active) return;
        if (healthRes.ok) {
          const h = (await healthRes.json()) as HealthSnapshot;
          if (active) setHealth(h);
        }
        if (storeRes.ok) {
          const s = (await storeRes.json()) as StoreStateSnapshot;
          if (active) setStoreState(s);
        }
      } catch {
        if (active) toast.error('Không thể tải dữ liệu cửa hàng.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!statusPopoverOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (statusMenuRef.current && !statusMenuRef.current.contains(event.target as Node)) {
        setStatusPopoverOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setStatusPopoverOpen(false);
    }
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [statusPopoverOpen]);

  async function handleResetDemo() {
    if (isResetting) return;
    setIsResetting(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST', body: '{}' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể khôi phục dữ liệu mẫu.');
      }
      setActivePreset(null);
      setSelectedOrderId(null);
      await loadWorkspaceData();
      toast.success('Đã khôi phục dữ liệu mẫu Tiệm Cà Phê Mộc.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi khôi phục dữ liệu mẫu.');
    } finally {
      setIsResetting(false);
    }
  }

  function handleSelectJudgePreset(presetId: JudgePresetId) {
    setActivePreset(presetId);
    switch (presetId) {
      case 'slang_chat':
        setActiveTab('pos');
        orderPanelRef.current?.runDemoPreset('chat');
        break;
      case 'handwritten_order':
        setActiveTab('pos');
        orderPanelRef.current?.runDemoPreset('handwritten');
        break;
      case 'valid_receipt':
        setActiveTab('receipt');
        receiptPanelRef.current?.runDemoPreset('valid_receipt');
        break;
      case 'tampered_receipt':
        setActiveTab('receipt');
        receiptPanelRef.current?.runDemoPreset('tampered_amount_receipt');
        break;
      case 'reused_receipt':
        setActiveTab('receipt');
        receiptPanelRef.current?.runDemoPreset('reused_transaction_ref');
        break;
      case 'copilot_revenue_debt':
        setActiveTab('copilot');
        copilotPanelRef.current?.runDemoPrompt(
          'Tổng kết doanh thu hôm nay, tìm món bán chậm và soạn tin nhắn nhắc nợ kèm mã VietQR cho khách quen'
        );
        break;
    }
  }

  const summary = storeState?.summary;
  const isSystemHealthy = Boolean(health?.supabase.connected && health?.ai.activeProviderReady);

  const navItems: ReadonlyArray<{
    id: WorkspaceTab;
    label: string;
    mobileLabel: string;
    icon: typeof ReceiptText;
    badgeCount?: number;
    badgeTone?: 'danger' | 'caution';
  }> = [
    { id: 'pos', label: 'Bán hàng', mobileLabel: 'Bán hàng', icon: ReceiptText },
    {
      id: 'receipt',
      label: 'Soát chuyển khoản',
      mobileLabel: 'Soát CK',
      icon: ShieldCheck,
      badgeCount: summary?.flaggedReceiptCount,
      badgeTone: 'danger',
    },
    {
      id: 'copilot',
      label: 'Sổ nợ & Doanh thu',
      mobileLabel: 'Sổ nợ',
      icon: BookOpen,
      badgeCount: summary?.unpaidDebtCount,
      badgeTone: 'caution',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Razor-sharp single-row 56px top navigation bar */}
      <header className="sticky top-0 z-30 h-14 border-b border-border bg-white/95 backdrop-blur-xs">
        <div className="mx-auto max-w-7xl h-full px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-2.5 min-w-0 shrink-0">
            <div className="size-8 rounded-lg bg-[#181512] text-[#FAF9F6] flex items-center justify-center shrink-0">
              <Coffee className="size-4" aria-hidden="true" />
            </div>
            <div className="flex items-baseline gap-2 min-w-0">
              <h1 className="text-sm sm:text-[15px] font-semibold tracking-tight text-foreground truncate">
                Tiệm Cà Phê Mộc
              </h1>
              <span className="hidden xl:inline-flex items-center rounded border border-border bg-[#FAF9F6] px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground shrink-0">
                Merchant Copilot
              </span>
            </div>
          </div>

          {/* Center Navigation (Desktop & Tablet) */}
          <nav
            aria-label="Điều hướng quầy làm việc"
            role="tablist"
            className="hidden md:flex items-center h-full gap-1"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`panel-${item.id}`}
                  id={`tab-${item.id}`}
                  onClick={() => setActiveTab(item.id)}
                  className={`relative h-full px-2.5 xl:px-3.5 inline-flex items-center gap-2 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                    isActive
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon
                    className={`size-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                    aria-hidden="true"
                  />
                  <span className="whitespace-nowrap">{item.label}</span>
                  {item.badgeCount !== undefined && item.badgeCount > 0 && (
                    <span
                      className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full font-mono tabular-nums text-[11px] font-semibold ${
                        item.badgeTone === 'danger'
                          ? 'bg-[#FFF1F2] text-[#BE123C]'
                          : 'bg-[#FFFBEB] text-[#B45309]'
                      }`}
                    >
                      {item.badgeCount}
                    </span>
                  )}
                  {isActive && (
                    <span
                      className="absolute inset-x-2 bottom-0 h-[2px] rounded-t-full bg-primary"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right Controls: Live Status Popover + Quick Demo Toggle + Reset */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div ref={statusMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setStatusPopoverOpen((prev) => !prev)}
                aria-expanded={statusPopoverOpen}
                aria-haspopup="dialog"
                aria-label="Trạng thái hệ thống"
                className="min-h-[36px] px-2.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-[#F5F4F0] inline-flex items-center gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="relative flex size-2 shrink-0">
                  <span
                    className={`relative inline-flex rounded-full size-2 ${
                      isSystemHealthy ? 'bg-[#0F766E]' : 'bg-[#B45309]'
                    }`}
                  />
                </span>
                <span className="hidden xl:inline whitespace-nowrap">
                  {health ? (isSystemHealthy ? 'Đang hoạt động' : 'Đang kết nối') : 'Đang kiểm tra'}
                </span>
              </button>

              {statusPopoverOpen && (
                <div
                  role="dialog"
                  aria-label="Thông tin kết nối hệ thống"
                  className="fixed sm:absolute right-4 sm:right-0 top-14 sm:top-full mt-1.5 w-64 rounded-xl border border-border bg-white p-3.5 shadow-lg z-50 text-xs space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">Trạng thái hệ thống</span>
                    <span
                      className={`inline-flex items-center gap-1.5 font-medium ${
                        isSystemHealthy ? 'text-[#0F766E]' : 'text-[#B45309]'
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          isSystemHealthy ? 'bg-[#0F766E]' : 'bg-[#B45309]'
                        }`}
                      />
                      {isSystemHealthy ? 'Trực tuyến' : 'Đang kiểm tra'}
                    </span>
                  </div>
                  <div className="border-t border-border pt-2.5 space-y-1.5 text-muted-foreground">
                    <div className="flex items-center justify-between gap-2">
                      <span>Bộ xử lý AI</span>
                      <span className="font-mono text-[11px] text-foreground truncate">
                        {health?.ai.activeProvider === 'bedrock'
                          ? 'AWS Bedrock'
                          : health?.ai.geminiModelId || 'gemini-2.5-flash'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span>Cơ sở dữ liệu</span>
                      <span className="font-medium text-foreground">
                        {health?.supabase.connected ? 'Supabase (Kết nối)' : 'Đang chờ'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setDemoBarOpen((prev) => !prev)}
              aria-expanded={demoBarOpen}
              className={`min-h-[36px] px-2.5 sm:px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                demoBarOpen
                  ? 'border-primary/30 bg-[#FAF9F6] text-primary'
                  : 'border-border bg-white text-foreground hover:bg-[#FAF9F6]'
              }`}
            >
              <Play className="size-3 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline whitespace-nowrap">Thử nhanh 6 kịch bản</span>
              <span className="sm:hidden whitespace-nowrap">Kịch bản</span>
              <ChevronDown
                className={`size-3.5 transition-transform duration-150 ${demoBarOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            <button
              type="button"
              onClick={() => void handleResetDemo()}
              disabled={isResetting}
              title="Làm mới dữ liệu mẫu"
              aria-label="Làm mới dữ liệu mẫu"
              className="size-9 rounded-lg border border-border bg-white text-muted-foreground hover:text-foreground hover:bg-[#FAF9F6] disabled:opacity-50 inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <RotateCcw
                className={`size-4 ${isResetting ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
      </header>

      {/* Collapsible slim 44px Demo Scenario Strip */}
      <JudgeDemoBar
        open={demoBarOpen}
        onClose={() => setDemoBarOpen(false)}
        onSelectPreset={handleSelectJudgePreset}
        onResetDemo={handleResetDemo}
        isResetting={isResetting}
        activePreset={activePreset}
      />

      {/* Main Content */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 pt-4 pb-24 md:pb-8 space-y-4">
        {/* Compact Hairline-Divided Metric Ledger Strip */}
        <section
          aria-label="Tổng quan quầy hôm nay"
          className="surface-card rounded-xl overflow-hidden"
        >
          <div className="grid grid-cols-2 lg:grid-cols-4">
            <LedgerMetric
              label="Doanh thu đã thu"
              value={summary ? formatVND(summary.paidRevenueVnd) : '—'}
              detail={`${summary?.paidOrderCount ?? 0} đơn hoàn tất`}
              tone="default"
              borderClass="border-b lg:border-b-0 border-r border-border"
            />
            <LedgerMetric
              label="Đơn chờ thanh toán"
              value={summary ? String(summary.pendingOrderCount) : '—'}
              detail="Đang đợi khách quét mã"
              tone="default"
              borderClass="border-b lg:border-b-0 lg:border-r border-border"
            />
            <LedgerMetric
              label="Khách đang ghi sổ"
              value={summary ? formatVND(summary.unpaidDebtVnd) : '—'}
              detail={`${summary?.unpaidDebtCount ?? 0} khách chưa trả`}
              tone={summary && summary.unpaidDebtVnd > 0 ? 'caution' : 'default'}
              borderClass="border-r border-border"
            />
            <LedgerMetric
              label="Bill cần kiểm tra"
              value={summary ? String(summary.flaggedReceiptCount) : '—'}
              detail="Lệch tiền hoặc trùng mã GD"
              tone={summary && summary.flaggedReceiptCount > 0 ? 'danger' : 'default'}
              borderClass=""
            />
          </div>
        </section>

        {/* Keep all 3 panels mounted so 1-click scenarios work instantaneously across tabs */}
        <div
          id="panel-pos"
          role="tabpanel"
          aria-labelledby="tab-pos"
          hidden={activeTab !== 'pos'}
        >
          <OrderIntakePanel
            ref={orderPanelRef}
            orders={storeState?.orders ?? []}
            onOrderCreated={loadWorkspaceData}
            onProceedToReceiptVerify={(order) => {
              setSelectedOrderId(order.id);
              setActiveTab('receipt');
            }}
          />
        </div>

        <div
          id="panel-receipt"
          role="tabpanel"
          aria-labelledby="tab-receipt"
          hidden={activeTab !== 'receipt'}
        >
          <ReceiptFraudInspector
            ref={receiptPanelRef}
            orders={storeState?.orders ?? []}
            paymentReceipts={storeState?.paymentReceipts ?? []}
            selectedOrderId={selectedOrderId}
            onSelectOrderId={(id) => setSelectedOrderId(id)}
            onVerificationUpdated={loadWorkspaceData}
          />
        </div>

        <div
          id="panel-copilot"
          role="tabpanel"
          aria-labelledby="tab-copilot"
          hidden={activeTab !== 'copilot'}
        >
          <OperationsCopilotPanel
            ref={copilotPanelRef}
            debts={storeState?.customerDebts ?? []}
            onDebtSettled={loadWorkspaceData}
          />
        </div>
      </main>

      {/* Subtle Footer */}
      <footer className="hidden md:block border-t border-border bg-white/60">
        <div className="mx-auto max-w-7xl px-6 py-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Tiệm Cà Phê Mộc • Quầy bán hàng & Đối soát VietQR</span>
          <span>Dữ liệu thanh toán mẫu phục vụ trình diễn</span>
        </div>
      </footer>

      {/* Mobile Bottom Tab Bar */}
      <nav
        aria-label="Điều hướng di động"
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-white/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-3 h-16">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`relative flex flex-col items-center justify-center gap-1 min-h-[44px] text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                {isActive && (
                  <span
                    className="absolute top-0 inset-x-6 h-[2px] rounded-b-full bg-primary"
                    aria-hidden="true"
                  />
                )}
                <div className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {item.badgeCount !== undefined && item.badgeCount > 0 && (
                    <span
                      className={`absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full font-mono text-[10px] font-semibold text-white flex items-center justify-center ${
                        item.badgeTone === 'danger' ? 'bg-[#BE123C]' : 'bg-[#B45309]'
                      }`}
                    >
                      {item.badgeCount}
                    </span>
                  )}
                </div>
                <span>{item.mobileLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function LedgerMetric({
  label,
  value,
  detail,
  tone,
  borderClass,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'default' | 'caution' | 'danger';
  borderClass: string;
}) {
  const valueToneClass =
    tone === 'danger'
      ? 'text-[#BE123C]'
      : tone === 'caution'
        ? 'text-[#B45309]'
        : 'text-foreground';

  return (
    <div className={`px-4 py-3 min-w-0 ${borderClass}`}>
      <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
      <p
        className={`mt-1 font-mono tabular-nums text-lg sm:text-xl font-semibold tracking-tight truncate ${valueToneClass}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{detail}</p>
    </div>
  );
}
