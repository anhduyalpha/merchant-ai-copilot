'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  Banknote,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Store,
  Wallet,
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
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

export function MerchantWorkspace() {
  const [activeTab, setActiveTab] = useState<'pos' | 'receipt' | 'copilot'>('pos');
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [storeState, setStoreState] = useState<StoreStateSnapshot | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const [isResetting, setIsResetting] = useState(false);
  const [activePreset, setActivePreset] = useState<JudgePresetId | null>(null);

  const orderPanelRef = useRef<OrderIntakeHandle>(null);
  const receiptPanelRef = useRef<ReceiptFraudInspectorHandle>(null);
  const copilotPanelRef = useRef<OperationsCopilotHandle>(null);

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

  async function handleResetDemo() {
    setIsResetting(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST', body: '{}' });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể reset dữ liệu mẫu.');
      }
      setActivePreset(null);
      setSelectedOrderId(null);
      await loadWorkspaceData();
      toast.success('Đã khôi phục dữ liệu mẫu Quán Cà Phê Demo.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi reset dữ liệu mẫu.');
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
          'Tổng kết doanh thu hôm nay, tìm món bán chậm và soạn tin nhắn nhắc nợ kèm link VietQR cho khách quen'
        );
        break;
    }
  }

  const summary = storeState?.summary;

  return (
    <div className="min-h-screen bg-background">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-primary/15 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shadow-xs shrink-0">
              <Store className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-foreground truncate">
                Merchant AI Copilot — Quán Cà Phê Demo
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                MoMo Tech Contest 2026 • Trợ lý chốt đơn VietQR & Đối soát chống giả mạo 4 lớp
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={`gap-1.5 px-2.5 py-1 text-xs ${
                health?.ai.activeProviderReady
                  ? 'border-primary/30 bg-secondary text-secondary-foreground'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}
            >
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              <span>
                AI:{' '}
                {health?.ai.activeProvider === 'bedrock'
                  ? 'AWS Bedrock'
                  : health?.ai.geminiModelId || 'Gemini 2.5 Flash'}
              </span>
            </Badge>
            <Badge
              variant="outline"
              className={`gap-1.5 px-2.5 py-1 text-xs ${
                health?.supabase.connected
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-amber-300 bg-amber-50 text-amber-800'
              }`}
            >
              <Activity className="size-3.5" aria-hidden="true" />
              <span>{health?.supabase.connected ? 'Supabase Sẵn sàng' : 'Đang kiểm tra DB'}</span>
            </Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-5 space-y-5">
        {/* Live KPI Strip */}
        <section aria-label="Chỉ số vận hành cửa hàng" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <KpiCard
            title="Doanh thu đã thu"
            value={summary ? formatVND(summary.paidRevenueVnd) : '...'}
            subtitle={`${summary?.paidOrderCount ?? 0} đơn hoàn tất`}
            icon={Banknote}
            tone="primary"
          />
          <KpiCard
            title="Đơn chờ thanh toán"
            value={String(summary?.pendingOrderCount ?? 0)}
            subtitle="Đang đợi khách quét VietQR"
            icon={Clock}
            tone="neutral"
          />
          <KpiCard
            title="Công nợ khách quen"
            value={summary ? formatVND(summary.unpaidDebtVnd) : '...'}
            subtitle={`${summary?.unpaidDebtCount ?? 0} khoản chưa tất toán`}
            icon={Wallet}
            tone="amber"
          />
          <KpiCard
            title="Cảnh báo bill rủi ro"
            value={String(summary?.flaggedReceiptCount ?? 0)}
            subtitle="Nghi giả mạo / trùng mã GD"
            icon={ShieldAlert}
            tone="danger"
          />
        </section>

        {/* Judge Quick-Demo Bar */}
        <JudgeDemoBar
          onSelectPreset={handleSelectJudgePreset}
          onResetDemo={handleResetDemo}
          isResetting={isResetting}
          activePreset={activePreset}
        />

        {/* Main 3-Tab Workspace */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(String(v) as 'pos' | 'receipt' | 'copilot')}
          className="space-y-4"
        >
          <TabsList className="w-full h-auto flex flex-wrap sm:grid sm:grid-cols-3 gap-1.5 rounded-2xl bg-secondary/75 p-1.5 border border-primary/15">
            <TabsTrigger
              value="pos"
              className="min-h-[44px] flex-1 gap-2 rounded-xl text-xs sm:text-sm font-semibold data-active:bg-primary data-active:text-primary-foreground data-active:shadow-xs cursor-pointer"
            >
              <Sparkles className="size-4 shrink-0" aria-hidden="true" />
              <span>1. Chốt Đơn & VietQR</span>
            </TabsTrigger>
            <TabsTrigger
              value="receipt"
              className="min-h-[44px] flex-1 gap-2 rounded-xl text-xs sm:text-sm font-semibold data-active:bg-primary data-active:text-primary-foreground data-active:shadow-xs cursor-pointer"
            >
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              <span>2. Đối Soát Bill 4 Lớp</span>
            </TabsTrigger>
            <TabsTrigger
              value="copilot"
              className="min-h-[44px] flex-1 gap-2 rounded-xl text-xs sm:text-sm font-semibold data-active:bg-primary data-active:text-primary-foreground data-active:shadow-xs cursor-pointer"
            >
              <Wallet className="size-4 shrink-0" aria-hidden="true" />
              <span>3. Trợ Lý & Sổ Nợ</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pos" keepMounted className="mt-0">
            <OrderIntakePanel
              ref={orderPanelRef}
              orders={storeState?.orders ?? []}
              onOrderCreated={loadWorkspaceData}
              onProceedToReceiptVerify={(order) => {
                setSelectedOrderId(order.id);
                setActiveTab('receipt');
              }}
            />
          </TabsContent>

          <TabsContent value="receipt" keepMounted className="mt-0">
            <ReceiptFraudInspector
              ref={receiptPanelRef}
              orders={storeState?.orders ?? []}
              paymentReceipts={storeState?.paymentReceipts ?? []}
              selectedOrderId={selectedOrderId}
              onSelectOrderId={(id) => setSelectedOrderId(id)}
              onVerificationUpdated={loadWorkspaceData}
            />
          </TabsContent>

          <TabsContent value="copilot" keepMounted className="mt-0">
            <OperationsCopilotPanel
              ref={copilotPanelRef}
              debts={storeState?.customerDebts ?? []}
              onDebtSettled={loadWorkspaceData}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: typeof Banknote;
  tone: 'primary' | 'neutral' | 'amber' | 'danger';
}) {
  const iconClass =
    tone === 'primary'
      ? 'bg-primary/12 text-primary'
      : tone === 'amber'
        ? 'bg-amber-100 text-amber-800'
        : tone === 'danger'
          ? 'bg-rose-100 text-rose-700'
          : 'bg-secondary text-secondary-foreground';

  return (
    <Card className="border-border bg-card shadow-xs">
      <CardContent className="p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className="text-xl font-bold text-foreground mt-1 truncate">{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
        </div>
        <div className={`size-11 rounded-xl flex items-center justify-center shrink-0 ${iconClass}`}>
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </CardContent>
    </Card>
  );
}
