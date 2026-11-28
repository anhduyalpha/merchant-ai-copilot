'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Coffee,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  OperationsCopilotPanel,
  type OperationsCopilotHandle,
} from '@/components/copilot/OperationsCopilotPanel';
import { OrderDetailModal } from '@/components/pos/OrderDetailModal';
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
import type {
  CustomerDebtRow,
  MenuItemRow,
  OrderItemRow,
  OrderRow,
  PaymentReceiptRow,
} from '@/types/database';

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

function recomputeSummary(
  orders: StoreOrderWithItems[],
  paymentReceipts: PaymentReceiptRow[],
  customerDebts: CustomerDebtRow[]
): StoreSummary {
  const paidOrders = orders.filter((o) => o.status === 'paid');
  const pendingOrderCount = orders.filter((o) => o.status === 'pending_payment').length;
  const debtOrderCount = orders.filter((o) => o.status === 'debt').length;
  const openDebts = customerDebts.filter((d) => d.status !== 'settled');
  const flaggedReceiptCount = paymentReceipts.filter(
    (r) => r.risk_level === 'high' || r.verdict === 'rejected'
  ).length;

  return {
    totalOrders: orders.length,
    paidOrderCount: paidOrders.length,
    pendingOrderCount,
    debtOrderCount,
    paidRevenueVnd: paidOrders.reduce((sum, o) => sum + o.total_vnd, 0),
    cashCollectedVnd: paidOrders.reduce((sum, o) => sum + o.cash_amount_vnd, 0),
    transferCollectedVnd: paidOrders.reduce((sum, o) => sum + o.transfer_amount_vnd, 0),
    unpaidDebtVnd: openDebts.reduce((sum, d) => sum + d.amount_due_vnd, 0),
    unpaidDebtCount: openDebts.length,
    flaggedReceiptCount,
  };
}

export function MerchantWorkspace() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('pos');
  const [visitedTabs, setVisitedTabs] = useState<Record<WorkspaceTab, boolean>>({
    pos: true,
    receipt: false,
    copilot: false,
  });
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [storeState, setStoreState] = useState<StoreStateSnapshot | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [detailOrderKey, setDetailOrderKey] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false);

  const orderPanelRef = useRef<OrderIntakeHandle>(null);
  const receiptPanelRef = useRef<ReceiptFraudInspectorHandle>(null);
  const copilotPanelRef = useRef<OperationsCopilotHandle>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const refreshSeqRef = useRef(0);

  const switchTab = useCallback((tab: WorkspaceTab) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => (prev[tab] ? prev : { ...prev, [tab]: true }));
  }, []);

  const refreshStoreState = useCallback(async () => {
    const seq = ++refreshSeqRef.current;
    try {
      const storeRes = await fetch('/api/store/state', { cache: 'no-store' });
      if (seq !== refreshSeqRef.current) return;
      if (storeRes.ok) {
        const s = (await storeRes.json()) as StoreStateSnapshot;
        if (seq !== refreshSeqRef.current) return;
        setStoreState(s);
        setFetchError(null);
      } else {
        setFetchError('Không thể đồng bộ dữ liệu cửa hàng từ cơ sở dữ liệu.');
      }
    } catch {
      if (seq !== refreshSeqRef.current) return;
      setFetchError('Mất kết nối tới máy chủ cửa hàng.');
      toast.error('Không thể tải dữ liệu quầy.');
    }
  }, []);

  const handleOrderCreatedOptimistic = useCallback(
    (created?: { order: OrderRow; items: OrderItemRow[]; debt?: CustomerDebtRow | null }) => {
      if (created?.order) {
        const qtyByMenuId = new Map<string, number>();
        for (const item of created.items) {
          if (item.menu_item_id && item.quantity > 0) {
            qtyByMenuId.set(
              item.menu_item_id,
              (qtyByMenuId.get(item.menu_item_id) ?? 0) + item.quantity
            );
          }
        }

        setStoreState((prev) => {
          if (!prev) return prev;
          const nextOrder: StoreOrderWithItems = { ...created.order, items: created.items };
          const nextOrders = [
            nextOrder,
            ...prev.orders.filter((o) => o.id !== created.order.id),
          ].slice(0, 25);
          const nextMenuItems =
            qtyByMenuId.size > 0
              ? prev.menuItems.map((m) => {
                  const delta = qtyByMenuId.get(m.id);
                  return delta
                    ? { ...m, daily_sold_count: Math.max(0, m.daily_sold_count + delta) }
                    : m;
                })
              : prev.menuItems;
          const nextDebts = created.debt
            ? [
                created.debt,
                ...prev.customerDebts.filter((d) => d.id !== created.debt?.id),
              ].slice(0, 25)
            : prev.customerDebts;

          return {
            summary: recomputeSummary(nextOrders, prev.paymentReceipts, nextDebts),
            menuItems: nextMenuItems,
            orders: nextOrders,
            paymentReceipts: prev.paymentReceipts,
            customerDebts: nextDebts,
          };
        });
      }
      void refreshStoreState();
    },
    [refreshStoreState]
  );

  const handleOrderStatusOptimistic = useCallback(
    (orderId?: string, nextStatus?: 'paid' | 'cancelled') => {
      if (orderId && nextStatus) {
        setStoreState((prev) => {
          if (!prev) return prev;
          const target = prev.orders.find((o) => o.id === orderId);
          if (!target) return prev;

          const decByMenuId = new Map<string, number>();
          if (nextStatus === 'cancelled') {
            for (const item of target.items) {
              if (item.menu_item_id && item.quantity > 0) {
                decByMenuId.set(
                  item.menu_item_id,
                  (decByMenuId.get(item.menu_item_id) ?? 0) + item.quantity
                );
              }
            }
          }

          const nextOrders = prev.orders.map((o) =>
            o.id === orderId ? { ...o, status: nextStatus } : o
          );
          const nextMenuItems =
            decByMenuId.size > 0
              ? prev.menuItems.map((m) => {
                  const dec = decByMenuId.get(m.id);
                  return dec ? { ...m, daily_sold_count: Math.max(0, m.daily_sold_count - dec) } : m;
                })
              : prev.menuItems;
          const nextDebts =
            target.payment_method === 'debt'
              ? prev.customerDebts.map((d) =>
                  d.order_id === orderId ? { ...d, status: 'settled' as const } : d
                )
              : prev.customerDebts;

          return {
            summary: recomputeSummary(nextOrders, prev.paymentReceipts, nextDebts),
            menuItems: nextMenuItems,
            orders: nextOrders,
            paymentReceipts: prev.paymentReceipts,
            customerDebts: nextDebts,
          };
        });
      }
      void refreshStoreState();
    },
    [refreshStoreState]
  );

  const handleDebtSettledOptimistic = useCallback(
    (debtId?: string) => {
      if (debtId) {
        setStoreState((prev) => {
          if (!prev) return prev;
          const targetDebt = prev.customerDebts.find((d) => d.id === debtId);
          const nextDebts = prev.customerDebts.map((d) =>
            d.id === debtId ? { ...d, status: 'settled' as const } : d
          );
          const nextOrders = targetDebt?.order_id
            ? prev.orders.map((o) =>
                o.id === targetDebt.order_id ? { ...o, status: 'paid' as const } : o
              )
            : prev.orders;

          return {
            summary: recomputeSummary(nextOrders, prev.paymentReceipts, nextDebts),
            menuItems: prev.menuItems,
            orders: nextOrders,
            paymentReceipts: prev.paymentReceipts,
            customerDebts: nextDebts,
          };
        });
      }
      void refreshStoreState();
    },
    [refreshStoreState]
  );

  const handleVerificationUpdated = useCallback(() => {
    void refreshStoreState();
  }, [refreshStoreState]);

  const handleProceedToReceiptVerify = useCallback(
    (order: OrderRow) => {
      setSelectedOrderId(order.id);
      switchTab('receipt');
    },
    [switchTab]
  );

  const handleInspectOrderDetail = useCallback((key: string) => {
    setDetailOrderKey(key);
  }, []);

  const handleCloseDetailModal = useCallback(() => {
    setDetailOrderKey(null);
  }, []);

  useEffect(() => {
    let active = true;
    const initialSeq = ++refreshSeqRef.current;

    void fetch('/api/health', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((h: HealthSnapshot | null) => {
        if (active && h) setHealth(h);
      })
      .catch(() => {
        // Non-blocking health check
      });

    void fetch('/api/store/state', { cache: 'no-store' })
      .then(async (storeRes) => {
        if (!active || initialSeq !== refreshSeqRef.current) return;
        if (storeRes.ok) {
          const s = (await storeRes.json()) as StoreStateSnapshot;
          if (active && initialSeq === refreshSeqRef.current) {
            setStoreState(s);
            setFetchError(null);
          }
        } else if (active) {
          setFetchError('Không thể đồng bộ dữ liệu cửa hàng từ cơ sở dữ liệu.');
        }
      })
      .catch(() => {
        if (active) {
          setFetchError('Mất kết nối tới máy chủ cửa hàng.');
          toast.error('Không thể tải dữ liệu quầy.');
        }
      });

    const warmupTimer = window.setTimeout(() => {
      if (active) {
        setVisitedTabs({ pos: true, receipt: true, copilot: true });
      }
    }, 1200);

    return () => {
      active = false;
      window.clearTimeout(warmupTimer);
    };
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
      {/* Harmonious Light MoMo Blush Backdrop (CSS gradient without GPU blur filter cost) */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 bg-[#FBF8FA]"
        style={{
          backgroundImage:
            'radial-gradient(560px circle at 8% 0%, rgba(244, 114, 182, 0.10), transparent 70%), radial-gradient(500px circle at 92% 0%, rgba(165, 0, 100, 0.06), transparent 70%)',
        }}
        aria-hidden="true"
      />

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
                  onClick={() => switchTab(item.id)}
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
      </header>

      {/* Main Fluid Workspace Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-7 py-4 sm:py-5 pb-24 lg:pb-6">
          {(fetchError || (health && !health.supabase.connected)) && (
            <div className="mb-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-xs text-[#92400E] flex items-center justify-between gap-2">
              <span>
                {fetchError ||
                  'Chưa kết nối được cơ sở dữ liệu Supabase — hãy kiểm tra cấu hình môi trường trước khi lưu đơn.'}
              </span>
              <button
                type="button"
                onClick={() => void refreshStoreState()}
                className="font-semibold underline hover:text-[#78350F] shrink-0 cursor-pointer"
              >
                Thử lại
              </button>
            </div>
          )}

          <div className={activeTab === 'pos' ? 'block' : 'hidden'}>
            <OrderIntakePanel
              ref={orderPanelRef}
              menuItems={storeState?.menuItems ?? []}
              orders={storeState?.orders ?? []}
              onOrderCreated={handleOrderCreatedOptimistic}
              onProceedToReceiptVerify={handleProceedToReceiptVerify}
              onInspectOrderDetail={handleInspectOrderDetail}
            />
          </div>

          {visitedTabs.receipt && (
            <div className={activeTab === 'receipt' ? 'block' : 'hidden'}>
              <ReceiptFraudInspector
                ref={receiptPanelRef}
                orders={storeState?.orders ?? []}
                paymentReceipts={storeState?.paymentReceipts ?? []}
                selectedOrderId={selectedOrderId}
                onSelectOrderId={setSelectedOrderId}
                onVerificationUpdated={handleVerificationUpdated}
                onInspectOrderDetail={handleInspectOrderDetail}
              />
            </div>
          )}

          {visitedTabs.copilot && (
            <div className={activeTab === 'copilot' ? 'block' : 'hidden'}>
              <OperationsCopilotPanel
                ref={copilotPanelRef}
                summary={summary ?? null}
                menuItems={storeState?.menuItems ?? []}
                debts={storeState?.customerDebts ?? []}
                onDebtSettled={handleDebtSettledOptimistic}
                onInspectOrderDetail={handleInspectOrderDetail}
              />
            </div>
          )}
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
              onClick={() => switchTab(item.id)}
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

      <OrderDetailModal
        order={
          detailOrderKey
            ? (storeState?.orders.find(
                (o) =>
                  o.id === detailOrderKey ||
                  o.order_code.toUpperCase() === detailOrderKey.toUpperCase()
              ) ?? null)
            : null
        }
        receipts={storeState?.paymentReceipts ?? []}
        onClose={handleCloseDetailModal}
        onOrderUpdated={handleOrderStatusOptimistic}
        onProceedToReceiptVerify={handleProceedToReceiptVerify}
      />
    </div>
  );
}
