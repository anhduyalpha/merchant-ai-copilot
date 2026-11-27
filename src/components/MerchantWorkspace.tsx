'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Coffee,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
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
import type { CustomerDebtRow, MenuItemRow, PaymentReceiptRow } from '@/types/database';

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

export interface StoreSummary {
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
}

interface StoreStateSnapshot {
  summary: StoreSummary;
  menuItems: MenuItemRow[];
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
  const [simulatorOpen, setSimulatorOpen] = useState(false);
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
      toast.error('Không thể tải dữ liệu quầy.');
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
        if (active) toast.error('Không thể tải dữ liệu quầy.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function handleKeyShortcut(e: KeyboardEvent) {
      if (e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setSimulatorOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyShortcut);
    return () => window.removeEventListener('keydown', handleKeyShortcut);
  }, []);

  useEffect(() => {
    if (!statusPopoverOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setStatusPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [statusPopoverOpen]);

  async function handleResetDemo() {
    setIsResetting(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST', body: '{}' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể khôi phục dữ liệu.');
      }
      setActivePreset(null);
      setSelectedOrderId(null);
      orderPanelRef.current?.resetView();
      receiptPanelRef.current?.resetView();
      copilotPanelRef.current?.resetView();
      await loadWorkspaceData();
      setSimulatorOpen(false);
      toast.success('Đã khôi phục dữ liệu quầy về trạng thái ban đầu.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi khôi phục dữ liệu.');
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
          'Tổng kết ca hôm nay, xem món nào cần đẩy bán và soạn tin nhắn nhắc khách còn ghi sổ kèm mã VietQR'
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
    { id: 'pos', label: 'Quầy thu ngân', mobileLabel: 'Thu ngân', icon: ReceiptText },
    {
      id: 'receipt',
      label: 'Kiểm duyệt CK',
      mobileLabel: 'Kiểm duyệt',
      icon: ShieldCheck,
      badgeCount: summary?.flaggedReceiptCount,
      badgeTone: 'danger',
    },
    {
      id: 'copilot',
      label: 'Doanh thu & Sổ nợ',
      mobileLabel: 'Doanh thu',
      icon: BookOpen,
      badgeCount: summary?.unpaidDebtCount,
      badgeTone: 'caution',
    },
  ];

  return (
    <div className="relative min-h-screen flex flex-col lg:flex-row text-foreground">
      {/* Harmonious Light MoMo Blush Backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#FBF8FA]" aria-hidden="true">
        <div
          className="absolute -top-40 -left-24 h-[520px] w-[520px] rounded-full blur-[120px]"
          style={{ background: 'radial-gradient(circle, rgba(244, 114, 182, 0.11) 0%, transparent 72%)' }}
        />
        <div
          className="absolute -top-24 -right-24 h-[460px] w-[460px] rounded-full blur-[120px]"
          style={{ background: 'radial-gradient(circle, rgba(165, 0, 100, 0.06) 0%, transparent 72%)' }}
        />
      </div>

      {/* Desktop Left Navigation Rail (>=1024px) */}
      <aside className="hidden lg:flex lg:w-[244px] lg:shrink-0 lg:sticky lg:top-0 lg:h-screen flex-col justify-between bg-white border-r border-[#EAE0E7] px-3.5 py-4 z-30">
        <div className="space-y-5">
          {/* Brand + Live Shift Indicator */}
          <div className="px-1.5 space-y-2.5" ref={statusMenuRef}>
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-lg bg-gradient-to-br from-[#A50064] to-[#D82D8B] text-white flex items-center justify-center shadow-xs shrink-0">
                <Coffee className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h1 className="text-[15px] font-bold tracking-tight text-foreground truncate">
                  Tiệm Cà Phê Mộc
                </h1>
                <p className="text-[11px] font-medium text-muted-foreground truncate">
                  Quầy thu ngân thông minh
                </p>
              </div>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setStatusPopoverOpen((prev) => !prev)}
                aria-expanded={statusPopoverOpen}
                className="w-full min-h-[34px] rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] px-2.5 py-1.5 flex items-center justify-between gap-2 text-xs text-foreground hover:bg-[#FDF2F8]/70 hover:border-[#F0D2E2] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <span className="relative flex size-2 shrink-0" aria-hidden="true">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        isSystemHealthy ? 'animate-ping bg-[#0F766E]' : 'bg-[#B45309]'
                      }`}
                    />
                    <span
                      className={`relative inline-flex size-2 rounded-full ${
                        isSystemHealthy ? 'bg-[#0F766E]' : 'bg-[#B45309]'
                      }`}
                    />
                  </span>
                  <span className="font-medium truncate">Ca sáng • Đang mở quầy</span>
                </span>
              </button>

              {statusPopoverOpen && (
                <div className="absolute left-0 top-10 z-50 w-64 rounded-xl surface-elevated p-3.5 text-xs">
                  <p className="font-semibold text-foreground mb-2">Trạng thái kết nối</p>
                  <div className="space-y-1.5 text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Bộ xử lý</span>
                      <span className="font-mono text-foreground">
                        {health?.ai.activeProvider === 'bedrock'
                          ? 'Bedrock'
                          : health?.ai.geminiModelId || 'gemini-2.5-flash'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Kho dữ liệu</span>
                      <span className={health?.supabase.connected ? 'text-[#0F766E] font-medium' : 'text-[#B45309]'}>
                        {health?.supabase.connected ? 'Đã kết nối' : 'Đang đồng bộ'}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Primary Navigation Rail */}
          <nav aria-label="Điều hướng quầy làm việc" className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(item.id)}
                  className={`relative w-full min-h-[42px] rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-sm transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isActive
                      ? 'bg-[#FDF2F8] text-[#A50064] font-semibold border border-[#F3D0E2]'
                      : 'text-muted-foreground font-medium hover:text-foreground hover:bg-[#F9F4F7] border border-transparent'
                  }`}
                >
                  {isActive && (
                    <span
                      className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary"
                      aria-hidden="true"
                    />
                  )}
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon
                      className={`size-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                  </span>

                  {item.badgeCount !== undefined && item.badgeCount > 0 && (
                    <span
                      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full tabular-nums text-[11px] font-semibold ${
                        item.badgeTone === 'danger'
                          ? 'bg-[#FFF1F2] text-[#BE123C]'
                          : 'bg-[#FFFBEB] text-[#B45309]'
                      }`}
                    >
                      {item.badgeCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom: Live Shift Pill + Discreet Simulator Drawer Trigger */}
        <div className="space-y-2.5 pt-3 border-t border-[#EAE0E7]">
          <div className="rounded-xl border border-[#F0D2E2] bg-[#FFF8FB] p-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="font-medium">Ca bán hôm nay</span>
              <span className="tabular-nums">
                {summary ? `${summary.paidOrderCount} đã thu` : '...'}
              </span>
            </div>
            <p className="font-sans tabular-nums text-lg font-bold tracking-tight text-foreground">
              {summary ? formatVND(summary.paidRevenueVnd) : '...'}
            </p>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1.5 border-t border-[#F3DCE8]">
              <span>Chờ CK: <strong className="tabular-nums text-foreground">{summary?.pendingOrderCount ?? 0}</strong></span>
              <span>Ghi sổ: <strong className="tabular-nums text-[#B45309]">{summary?.unpaidDebtCount ?? 0}</strong></span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSimulatorOpen(true)}
            aria-expanded={simulatorOpen}
            className="w-full min-h-[40px] rounded-lg border border-[#EAE0E7] bg-white hover:bg-[#FDF2F8]/60 hover:border-[#F0D2E2] px-3 py-2 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="size-3.5 text-primary" aria-hidden="true" />
              <span>Bộ mô phỏng nhanh</span>
            </span>
            <kbd className="rounded border border-[#EAE0E7] bg-[#FBF8FA] px-1.5 py-0.5 font-mono text-[10px]">
              Alt+D
            </kbd>
          </button>
        </div>
      </aside>

      {/* Mobile & Tablet Top Bar (<1024px) */}
      <header className="lg:hidden sticky top-0 z-30 h-14 px-4 flex items-center justify-between gap-3 bg-white/95 backdrop-blur-md border-b border-[#EAE0E7]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="size-8 rounded-lg bg-gradient-to-br from-[#A50064] to-[#D82D8B] text-white flex items-center justify-center shadow-xs shrink-0">
            <Coffee className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-tight text-foreground truncate">
              Tiệm Cà Phê Mộc
            </p>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 truncate">
              <span
                className={`size-1.5 rounded-full shrink-0 ${
                  isSystemHealthy ? 'bg-[#0F766E]' : 'bg-[#B45309]'
                }`}
                aria-hidden="true"
              />
              <span className="tabular-nums">Ca sáng • {summary ? formatVND(summary.paidRevenueVnd) : '...'}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setSimulatorOpen(true)}
          aria-expanded={simulatorOpen}
          className="min-h-[36px] rounded-lg border border-[#EAE0E7] bg-white px-2.5 py-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:bg-[#FDF2F8] hover:border-[#F0D2E2] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0"
        >
          <SlidersHorizontal className="size-3.5 text-primary" aria-hidden="true" />
          <span>Mô phỏng</span>
        </button>
      </header>

      {/* Main Fluid Workspace Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-4 sm:py-5 pb-24 lg:pb-6">
          <div className={activeTab === 'pos' ? 'block' : 'hidden'}>
            <OrderIntakePanel
              ref={orderPanelRef}
              menuItems={storeState?.menuItems ?? []}
              orders={storeState?.orders ?? []}
              onOrderCreated={loadWorkspaceData}
              onProceedToReceiptVerify={(order) => {
                setSelectedOrderId(order.id);
                setActiveTab('receipt');
              }}
            />
          </div>

          <div className={activeTab === 'receipt' ? 'block' : 'hidden'}>
            <ReceiptFraudInspector
              ref={receiptPanelRef}
              orders={storeState?.orders ?? []}
              paymentReceipts={storeState?.paymentReceipts ?? []}
              selectedOrderId={selectedOrderId}
              onSelectOrderId={(id) => setSelectedOrderId(id)}
              onVerificationUpdated={loadWorkspaceData}
              onOpenSimulator={() => setSimulatorOpen(true)}
            />
          </div>

          <div className={activeTab === 'copilot' ? 'block' : 'hidden'}>
            <OperationsCopilotPanel
              ref={copilotPanelRef}
              summary={summary ?? null}
              menuItems={storeState?.menuItems ?? []}
              debts={storeState?.customerDebts ?? []}
              onDebtSettled={loadWorkspaceData}
            />
          </div>
        </main>
      </div>

      {/* Mobile & Tablet Floating Bottom Dock (<1024px) */}
      <nav
        aria-label="Điều hướng di động"
        className="lg:hidden fixed bottom-3 inset-x-3 z-30 rounded-xl bg-white/95 backdrop-blur-md border border-[#EAE0E7] shadow-lg p-1.5 grid grid-cols-3 gap-1"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative min-h-[46px] rounded-lg px-2 py-1.5 flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                isActive
                  ? 'bg-[#FDF2F8] text-[#A50064] font-semibold border border-[#F3D0E2]'
                  : 'text-muted-foreground font-medium hover:text-foreground hover:bg-[#FBF8FA] border border-transparent'
              }`}
            >
              <span className="relative">
                <Icon className="size-4" aria-hidden="true" />
                {item.badgeCount !== undefined && item.badgeCount > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-2.5 min-w-[15px] h-[15px] px-1 rounded-full tabular-nums text-[9px] font-bold flex items-center justify-center ${
                      isActive
                        ? 'bg-[#A50064] text-white'
                        : item.badgeTone === 'danger'
                          ? 'bg-[#BE123C] text-white'
                          : 'bg-[#B45309] text-white'
                    }`}
                  >
                    {item.badgeCount}
                  </span>
                )}
              </span>
              <span>{item.mobileLabel}</span>
            </button>
          );
        })}
      </nav>

      {/* Frosted Slide-Over Simulator Drawer (Closed by Default) */}
      <JudgeDemoBar
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        onSelectPreset={handleSelectJudgePreset}
        onResetDemo={handleResetDemo}
        isResetting={isResetting}
        activePreset={activePreset}
      />
    </div>
  );
}
