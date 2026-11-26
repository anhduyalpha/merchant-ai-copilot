'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ImagePlus,
  Loader2,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { fetchAssetAsBase64, fileToBase64 } from '@/lib/client-image';
import { RECEIPT_FRAUD_SCENARIOS, type ReceiptFraudScenario } from '@/lib/demo-presets';
import { cleanBankDisplay, cleanCustomerDisplay, stripLayerPrefix } from '@/lib/utils';
import { formatVND } from '@/lib/vietqr';
import type { OrderRow, PaymentReceiptRow } from '@/types/database';

interface FraudLayerCheck {
  layer: 1 | 2 | 3 | 4;
  key: string;
  labelVi: string;
  passed: boolean;
  severity: 'pass' | 'warning' | 'fail';
  detailVi: string;
}

interface VerifyResponsePayload {
  receipt: PaymentReceiptRow;
  verdict: 'valid' | 'warning' | 'fraud_suspected';
  riskLevel: 'low' | 'medium' | 'high';
  recommendedVerdict: 'approved' | 'pending_review' | 'rejected';
  checks: FraudLayerCheck[];
  extraction: {
    transactionRef: string;
    bankName: string;
    extractedAmountVnd: number;
    receiptTimestampIso: string | null;
    transferNote: string | null;
  };
  reasoningVi: string[];
}

export interface ReceiptFraudInspectorHandle {
  runDemoPreset: (scenarioId: ReceiptFraudScenario['id']) => void;
  resetView: () => void;
}

interface ReceiptFraudInspectorProps {
  orders: OrderRow[];
  paymentReceipts: PaymentReceiptRow[];
  selectedOrderId: string | null;
  onSelectOrderId: (id: string) => void;
  onVerificationUpdated: () => Promise<void>;
}

export const ReceiptFraudInspector = forwardRef<
  ReceiptFraudInspectorHandle,
  ReceiptFraudInspectorProps
>(function ReceiptFraudInspector(
  {
    orders,
    paymentReceipts,
    selectedOrderId,
    onSelectOrderId,
    onVerificationUpdated,
  },
  ref
) {
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imagePayload, setImagePayload] = useState<{
    imageBase64: string;
    imageMimeType: string;
    imageUrl?: string;
  } | null>(null);
  const [activeScenarioId, setActiveScenarioId] = useState<ReceiptFraudScenario['id'] | undefined>(
    undefined
  );

  const [isVerifying, setIsVerifying] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [auditResult, setAuditResult] = useState<VerifyResponsePayload | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scenarioLoadingRef = useRef(false);

  const targetOrder =
    orders.find((o) => o.id === selectedOrderId) ??
    orders.find((o) => o.status === 'pending_payment') ??
    orders[0] ??
    null;

  async function runVerification(opts?: {
    imgOverride?: { imageBase64: string; imageMimeType: string; imageUrl?: string };
    scenarioOverride?: ReceiptFraudScenario['id'];
    expectedAmountOverride?: number;
    orderCodeOverride?: string;
    omitTargetOrder?: boolean;
  }) {
    if (isVerifying) return;
    const img = opts?.imgOverride ?? imagePayload;
    const scenarioId = opts?.scenarioOverride ?? activeScenarioId;

    if (!img && !scenarioId) {
      toast.error('Hãy chọn ảnh chuyển khoản hoặc thử một kịch bản mẫu.');
      return;
    }

    setIsVerifying(true);
    try {
      const res = await fetch('/api/receipts/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: opts?.omitTargetOrder ? undefined : targetOrder?.id,
          orderCode: opts?.orderCodeOverride ?? targetOrder?.order_code,
          expectedAmount:
            opts?.expectedAmountOverride ??
            (targetOrder
              ? targetOrder.transfer_amount_vnd > 0
                ? targetOrder.transfer_amount_vnd
                : targetOrder.total_vnd
              : 64000),
          imageBase64: img?.imageBase64,
          imageMimeType: img?.imageMimeType,
          imageUrl: img?.imageUrl,
          presetScenarioId: scenarioId,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể kiểm tra ảnh chuyển khoản.');
      }

      setAuditResult(data as VerifyResponsePayload);
      await onVerificationUpdated();

      if (data.verdict === 'fraud_suspected') {
        toast.error('Phát hiện dấu hiệu bất thường trên ảnh chuyển khoản.');
      } else if (data.verdict === 'warning') {
        toast.warning('Ảnh chuyển khoản có điểm cần kiểm tra thêm.');
      } else {
        toast.success('Đạt cả 4 lớp đối soát. Bạn có thể xác nhận đã nhận tiền.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi kiểm tra ảnh chuyển khoản.');
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleLoadAndRunScenario(scenario: ReceiptFraudScenario) {
    if (isVerifying || scenarioLoadingRef.current) return;
    scenarioLoadingRef.current = true;
    setActiveScenarioId(scenario.id);
    try {
      const loaded = await fetchAssetAsBase64(scenario.imagePath);
      const nextImg = {
        imageBase64: loaded.imageBase64,
        imageMimeType: loaded.imageMimeType,
        imageUrl: scenario.imagePath,
      };
      setImagePreviewUrl(loaded.dataUrl);
      setImagePayload(nextImg);

      await runVerification({
        imgOverride: nextImg,
        scenarioOverride: scenario.id,
        expectedAmountOverride: scenario.expectedAmountVnd,
        orderCodeOverride: scenario.targetOrderCode,
        omitTargetOrder: scenario.targetOrderCode !== targetOrder?.order_code,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tải được ảnh mẫu.');
    } finally {
      scenarioLoadingRef.current = false;
    }
  }

  useImperativeHandle(ref, () => ({
    runDemoPreset(scenarioId) {
      const scenario = RECEIPT_FRAUD_SCENARIOS.find((s) => s.id === scenarioId);
      if (scenario) {
        void handleLoadAndRunScenario(scenario);
      }
    },
    resetView() {
      setAuditResult(null);
      setImagePreviewUrl(null);
      setImagePayload(null);
      setActiveScenarioId(undefined);
      setCopiedRef(false);
    },
  }));

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    try {
      const loaded = await fileToBase64(file);
      setActiveScenarioId(undefined);
      setImagePreviewUrl(loaded.dataUrl);
      setImagePayload({
        imageBase64: loaded.imageBase64,
        imageMimeType: loaded.imageMimeType,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không đọc được tệp ảnh.');
    }
  }

  async function handleHumanDecision(action: 'approve' | 'reject') {
    if (!auditResult?.receipt?.id || isApproving) return;
    setIsApproving(true);
    try {
      const res = await fetch(`/api/receipts/${auditResult.receipt.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể cập nhật trạng thái.');
      }
      setAuditResult((prev) => (prev ? { ...prev, receipt: data.receipt as PaymentReceiptRow } : prev));
      await onVerificationUpdated();
      toast.success(
        action === 'approve'
          ? 'Đã xác nhận nhận tiền cho đơn hàng.'
          : 'Đã từ chối biên lai và gắn cảnh báo.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật trạng thái.');
    } finally {
      setIsApproving(false);
    }
  }

  async function handleCopyTxRef(txRef: string) {
    try {
      await navigator.clipboard.writeText(txRef);
      setCopiedRef(true);
      toast.success(`Đã sao chép mã giao dịch ${txRef}.`);
      setTimeout(() => setCopiedRef(false), 1800);
    } catch {
      toast.error('Không sao chép được mã giao dịch.');
    }
  }

  const amountMatches =
    auditResult &&
    auditResult.receipt.expected_amount_vnd === auditResult.extraction.extractedAmountVnd;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left: Order Selector + Receipt Upload + Quick Scenarios */}
      <div className="lg:col-span-5 space-y-5">
        <section aria-labelledby="receipt-upload-heading" className="surface-card rounded-xl p-5 space-y-4">
          <div>
            <h2
              id="receipt-upload-heading"
              className="text-[15px] font-semibold tracking-tight text-foreground"
            >
              Soát ảnh chuyển khoản
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Chọn đơn cần đối chiếu rồi tải ảnh khách gửi hoặc chạy thử 3 tình huống mẫu.
            </p>
          </div>

          <div>
            <label htmlFor="target-order-select" className="text-xs font-medium text-muted-foreground">
              Đơn hàng đối chiếu
            </label>
            <select
              id="target-order-select"
              value={targetOrder?.id ?? ''}
              onChange={(e) => onSelectOrderId(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-input bg-white px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {orders.map((o) => {
                const expected = o.transfer_amount_vnd > 0 ? o.transfer_amount_vnd : o.total_vnd;
                const customer = cleanCustomerDisplay(o.customer_name);
                const statusLabel =
                  o.status === 'paid'
                    ? 'Đã thu'
                    : o.status === 'debt'
                      ? 'Ghi sổ'
                      : o.status === 'cancelled'
                        ? 'Đã hủy'
                        : 'Chờ thu';
                return (
                  <option key={o.id} value={o.id}>
                    {o.order_code} • {formatVND(expected)}
                    {customer ? ` • ${customer}` : ''} ({statusLabel})
                  </option>
                );
              })}
            </select>
          </div>

          {/* 3 Test Scenarios — Clean hairline rows with status dot */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-muted-foreground">Tình huống mẫu</span>
            <div className="rounded-lg border border-border divide-y divide-border bg-white overflow-hidden">
              {RECEIPT_FRAUD_SCENARIOS.map((sc) => {
                const isSelected = activeScenarioId === sc.id;
                const isSafe = sc.expectedRiskLevel === 'low';
                return (
                  <button
                    key={sc.id}
                    type="button"
                    disabled={isVerifying}
                    onClick={() => void handleLoadAndRunScenario(sc)}
                    className={`min-h-[44px] w-full flex items-center justify-between gap-3 px-3.5 py-2.5 text-left text-xs transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${
                      isSelected ? 'bg-[#FAF9F6]' : 'hover:bg-[#FAF9F6]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`size-2 rounded-full shrink-0 ${
                          isSafe ? 'bg-[#0F766E]' : 'bg-[#BE123C]'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="font-medium text-foreground truncate">{sc.titleVi}</span>
                    </div>
                    <span
                      className={`text-[11px] font-medium shrink-0 ${
                        isSafe ? 'text-[#0F766E]' : 'text-[#BE123C]'
                      }`}
                    >
                      {sc.badgeLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5 pt-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void handleFileUpload(e.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="min-h-[44px] w-full rounded-lg border-input bg-white text-foreground hover:bg-[#FAF9F6] cursor-pointer"
            >
              <ImagePlus className="size-4 text-primary" aria-hidden="true" />
              <span>Tải ảnh chuyển khoản từ máy</span>
            </Button>

            {imagePreviewUrl && (
              <div className="rounded-lg border border-border bg-[#FAF9F6] p-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreviewUrl}
                  alt="Ảnh chụp màn hình chuyển khoản cần kiểm tra"
                  className="max-h-60 w-full object-contain rounded-md"
                />
              </div>
            )}

            <Button
              type="button"
              onClick={() => void runVerification()}
              disabled={isVerifying || (!imagePayload && !activeScenarioId)}
              className="min-h-[44px] w-full rounded-lg bg-primary text-primary-foreground hover:bg-[#8B0054] font-medium cursor-pointer"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang kiểm tra 4 lớp...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  <span>Kiểm tra chuyển khoản</span>
                </>
              )}
            </Button>
          </div>
        </section>
      </div>

      {/* Right: 4-Layer Bank Security Audit Console + History */}
      <div className="lg:col-span-7 space-y-5">
        <section aria-labelledby="audit-console-heading" className="surface-card rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2
                id="audit-console-heading"
                className="text-[15px] font-semibold tracking-tight text-foreground"
              >
                Kết quả đối soát 4 lớp
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Hệ thống kiểm tra tự động, bạn là người xác nhận cuối cùng.
              </p>
            </div>
            {!isVerifying && auditResult && <VerdictPill verdict={auditResult.verdict} />}
          </div>

          {isVerifying ? (
            <div className="space-y-3 animate-pulse" aria-label="Đang chạy kiểm tra 4 lớp">
              <div className="h-16 rounded-lg bg-[#F5F4F0]" />
              <div className="space-y-2">
                <div className="h-14 rounded-lg bg-[#F5F4F0]" />
                <div className="h-14 rounded-lg bg-[#F5F4F0]" />
                <div className="h-14 rounded-lg bg-[#F5F4F0]" />
                <div className="h-14 rounded-lg bg-[#F5F4F0]" />
              </div>
            </div>
          ) : auditResult ? (
            <>
              {/* Extracted Slip Comparison Bar */}
              <div className="rounded-lg border border-border bg-[#FAF9F6] grid grid-cols-2 sm:grid-cols-4 overflow-hidden text-xs">
                <div className="p-3 min-w-0 border-b sm:border-b-0 border-r border-border">
                  <p className="text-[11px] text-muted-foreground">Mã giao dịch</p>
                  <button
                    type="button"
                    onClick={() => void handleCopyTxRef(auditResult.extraction.transactionRef)}
                    className="mt-1 inline-flex items-center gap-1 font-mono font-semibold text-foreground hover:text-primary transition-colors cursor-pointer max-w-full"
                    title="Sao chép mã giao dịch"
                  >
                    <span className="truncate">{auditResult.extraction.transactionRef}</span>
                    {copiedRef ? (
                      <Check className="size-3 shrink-0 text-[#0F766E]" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <div className="p-3 min-w-0 border-b sm:border-b-0 sm:border-r border-border">
                  <p className="text-[11px] text-muted-foreground">
                    Trên ảnh / Cần thu
                  </p>
                  <p
                    className={`mt-1 font-mono tabular-nums font-bold truncate ${
                      amountMatches ? 'text-[#0F766E]' : 'text-[#BE123C]'
                    }`}
                  >
                    {formatVND(auditResult.extraction.extractedAmountVnd)}
                  </p>
                  <p className="mt-0.5 font-mono tabular-nums text-[10.5px] text-muted-foreground truncate">
                    Đơn: {formatVND(auditResult.receipt.expected_amount_vnd)}
                  </p>
                </div>
                <div className="p-3 min-w-0 border-r border-border">
                  <p className="text-[11px] text-muted-foreground">Ngân hàng</p>
                  <p className="mt-1 font-medium text-foreground truncate">
                    {cleanBankDisplay(auditResult.extraction.bankName)}
                  </p>
                </div>
                <div className="p-3 min-w-0">
                  <p className="text-[11px] text-muted-foreground">Nội dung CK</p>
                  <p className="mt-1 font-mono text-[11px] font-medium text-foreground truncate">
                    {auditResult.extraction.transferNote || 'Không ghi'}
                  </p>
                </div>
              </div>

              {/* Structured 4-Layer Audit Rows */}
              <div className="rounded-lg border border-border divide-y divide-border bg-white overflow-hidden">
                {auditResult.checks.map((chk) => {
                  const statusColor =
                    chk.severity === 'pass'
                      ? 'text-[#0F766E]'
                      : chk.severity === 'warning'
                        ? 'text-[#B45309]'
                        : 'text-[#BE123C]';
                  const rowBg =
                    chk.severity === 'fail'
                      ? 'bg-[#FFF1F2]/40'
                      : chk.severity === 'warning'
                        ? 'bg-[#FFFBEB]/40'
                        : 'bg-white';

                  return (
                    <div key={chk.key} className={`flex items-start gap-3 px-4 py-3 ${rowBg}`}>
                      <div className={`mt-0.5 shrink-0 ${statusColor}`}>
                        {chk.severity === 'pass' ? (
                          <CheckCircle2 className="size-4" aria-hidden="true" />
                        ) : chk.severity === 'warning' ? (
                          <AlertTriangle className="size-4" aria-hidden="true" />
                        ) : (
                          <XCircle className="size-4" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-medium text-muted-foreground">
                            Lớp {chk.layer}
                          </span>
                          <span className="text-sm font-medium text-foreground">
                            {stripLayerPrefix(chk.labelVi)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {chk.detailVi}
                        </p>
                      </div>
                      <span className={`text-[11px] font-semibold shrink-0 mt-0.5 ${statusColor}`}>
                        {chk.severity === 'pass'
                          ? 'Đạt'
                          : chk.severity === 'warning'
                            ? 'Lưu ý'
                            : 'Bất thường'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Human-in-the-Loop Action Footer */}
              <div className="rounded-xl border border-border bg-[#FAF9F6] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-foreground">Xác nhận của chủ quán</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        auditResult.receipt.verdict === 'approved'
                          ? 'bg-[#0F766E]'
                          : auditResult.receipt.verdict === 'rejected'
                            ? 'bg-[#BE123C]'
                            : 'bg-[#B45309]'
                      }`}
                      aria-hidden="true"
                    />
                    {auditResult.receipt.verdict === 'approved'
                      ? 'Đã xác nhận nhận tiền'
                      : auditResult.receipt.verdict === 'rejected'
                        ? 'Đã từ chối & báo giả'
                        : 'Chờ bạn xác nhận'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Button
                    type="button"
                    disabled={isApproving}
                    onClick={() => void handleHumanDecision('approve')}
                    className="min-h-[44px] rounded-lg bg-[#0F766E] hover:bg-[#115E59] text-white font-medium cursor-pointer"
                  >
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    <span>Xác nhận đã nhận tiền</span>
                  </Button>
                  <Button
                    type="button"
                    variant={auditResult.verdict === 'fraud_suspected' ? 'destructive' : 'outline'}
                    disabled={isApproving}
                    onClick={() => void handleHumanDecision('reject')}
                    className={`min-h-[44px] rounded-lg font-medium cursor-pointer ${
                      auditResult.verdict === 'fraud_suspected'
                        ? 'bg-[#BE123C] hover:bg-[#9F1239] text-white'
                        : 'border-[#BE123C]/30 bg-white text-[#BE123C] hover:bg-[#FFF1F2]'
                    }`}
                  >
                    <ShieldX className="size-4" aria-hidden="true" />
                    <span>Từ chối & Báo giả</span>
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-input bg-[#FAF9F6] px-6 py-12 flex flex-col items-center text-center gap-3">
              <AuditConsoleIllustration />
              <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
                Chọn ảnh chuyển khoản hoặc thử một tình huống mẫu bên trái để kiểm tra số tiền, mã giao dịch và dấu hiệu chỉnh sửa ảnh.
              </p>
            </div>
          )}
        </section>

        {/* Recent Audit Log */}
        <section aria-labelledby="receipt-history-heading" className="surface-card rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
            <h2
              id="receipt-history-heading"
              className="text-[15px] font-semibold tracking-tight text-foreground"
            >
              Lịch sử đối soát
            </h2>
            <span className="font-mono tabular-nums text-xs text-muted-foreground">
              {paymentReceipts.length} giao dịch
            </span>
          </div>

          {paymentReceipts.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-muted-foreground">
              Chưa có biên lai nào được kiểm tra.
            </div>
          ) : (
            <div className="divide-y divide-border max-h-60 overflow-y-auto">
              {paymentReceipts.slice(0, 8).map((r) => {
                const isApproved = r.verdict === 'approved';
                const isRejected = r.verdict === 'rejected';
                const isHighRiskPending = !isApproved && !isRejected && r.risk_level === 'high';
                const toneText = isApproved
                  ? 'text-[#0F766E]'
                  : isRejected || isHighRiskPending
                    ? 'text-[#BE123C]'
                    : 'text-[#B45309]';
                const toneDot = isApproved
                  ? 'bg-[#0F766E]'
                  : isRejected || isHighRiskPending
                    ? 'bg-[#BE123C]'
                    : 'bg-[#B45309]';
                const statusLabel = isApproved
                  ? 'Đã nhận'
                  : isRejected
                    ? 'Từ chối'
                    : isHighRiskPending
                      ? 'Cảnh báo'
                      : 'Chờ duyệt';

                return (
                  <div
                    key={r.id}
                    className="px-5 py-3 flex items-center justify-between gap-3 text-xs hover:bg-[#FAF9F6]/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-foreground">
                        {r.transaction_ref}
                      </span>
                      <span className="text-muted-foreground">
                        {' '}
                        • {cleanBankDisplay(r.bank_name)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-mono tabular-nums font-semibold text-foreground">
                        {formatVND(r.extracted_amount_vnd)}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${toneText}`}>
                        <span className={`size-1.5 rounded-full ${toneDot}`} aria-hidden="true" />
                        {statusLabel}
                      </span>
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

function VerdictPill({ verdict }: { verdict: VerifyResponsePayload['verdict'] }) {
  if (verdict === 'valid') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[#0F766E]/25 bg-[#F0FDFA] px-2.5 py-1 text-xs font-medium text-[#0F766E]">
        <span className="size-1.5 rounded-full bg-[#0F766E]" aria-hidden="true" />
        Hợp lệ • Đạt 4/4 lớp
      </span>
    );
  }
  if (verdict === 'warning') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-[#B45309]/25 bg-[#FFFBEB] px-2.5 py-1 text-xs font-medium text-[#B45309]">
        <span className="size-1.5 rounded-full bg-[#B45309]" aria-hidden="true" />
        Cần kiểm tra kỹ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#BE123C]/25 bg-[#FFF1F2] px-2.5 py-1 text-xs font-medium text-[#BE123C]">
      <span className="size-1.5 rounded-full bg-[#BE123C]" aria-hidden="true" />
      Cảnh báo giả mạo
    </span>
  );
}

function AuditConsoleIllustration() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
      className="text-[#A8A29E]"
    >
      <path
        d="M28 7l16 6v13c0 10.5-6.8 18.6-16 23-9.2-4.4-16-12.5-16-23V13l16-6z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M22 27.5l4.2 4.2L34.5 23"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
