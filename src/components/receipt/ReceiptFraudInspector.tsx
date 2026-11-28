'use client';

import Image from 'next/image';
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
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
  receipt?: PaymentReceiptRow;
  isUnreadableReceipt?: boolean;
  alreadyPaidWarningVi?: string | null;
  message?: string;
  verdict: 'valid' | 'warning' | 'fraud_suspected';
  riskLevel: 'low' | 'medium' | 'high';
  recommendedVerdict: 'approved' | 'pending_review' | 'rejected';
  checks: FraudLayerCheck[];
  extraction: {
    isValidReceiptImage?: boolean;
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
  onInspectOrderDetail: (orderId: string) => void;
}

function buildDossierFromHistoryRow(receipt: PaymentReceiptRow): VerifyResponsePayload {
  const verdict: VerifyResponsePayload['verdict'] =
    receipt.verdict === 'rejected' || receipt.risk_level === 'high'
      ? 'fraud_suspected'
      : receipt.risk_level === 'medium'
        ? 'warning'
        : 'valid';

  const checks: FraudLayerCheck[] = [
    {
      layer: 1,
      key: 'amount_match',
      labelVi: 'Khớp số tiền giao dịch',
      passed: receipt.amount_match,
      severity: receipt.amount_match ? 'pass' : 'fail',
      detailVi: receipt.amount_match
        ? `Số tiền đọc từ ảnh khớp ${formatVND(receipt.expected_amount_vnd)}.`
        : `Lệch tiền: trên ảnh là ${formatVND(receipt.extracted_amount_vnd)}, đơn cần thu ${formatVND(receipt.expected_amount_vnd)}.`,
    },
    {
      layer: 2,
      key: 'duplicate_ref',
      labelVi: 'Kiểm tra trùng mã tham chiếu',
      passed: !receipt.is_duplicate_ref,
      severity: receipt.is_duplicate_ref ? 'fail' : 'pass',
      detailVi: receipt.is_duplicate_ref
        ? `Mã tham chiếu ${receipt.transaction_ref} đã từng xuất hiện trước đó.`
        : `Mã ${receipt.transaction_ref} chưa từng trùng lặp khi đối soát.`,
    },
    {
      layer: 3,
      key: 'timestamp_note',
      labelVi: 'Đối chiếu thời gian & nội dung CK',
      passed: !receipt.timestamp_anomaly,
      severity: receipt.timestamp_anomaly ? 'warning' : 'pass',
      detailVi: receipt.timestamp_anomaly
        ? 'Mốc thời gian hoặc nội dung chuyển khoản cần kiểm tra lại.'
        : 'Thời gian chuyển khoản và nội dung tham chiếu hợp lệ.',
    },
    {
      layer: 4,
      key: 'visual_tampering',
      labelVi: 'Phân tích dấu hiệu chỉnh sửa ảnh',
      passed: receipt.visual_tampering_flags.length === 0,
      severity: receipt.visual_tampering_flags.length > 0 ? 'fail' : 'pass',
      detailVi:
        receipt.visual_tampering_flags.length > 0
          ? receipt.visual_tampering_flags.join('; ')
          : 'Không phát hiện lệch phông chữ hay vết ghép nền quanh con số.',
    },
  ];

  return {
    receipt,
    verdict,
    riskLevel: receipt.risk_level,
    recommendedVerdict: receipt.verdict,
    checks,
    extraction: {
      transactionRef: receipt.transaction_ref,
      bankName: receipt.bank_name,
      extractedAmountVnd: receipt.extracted_amount_vnd,
      receiptTimestampIso: receipt.receipt_timestamp,
      transferNote: receipt.transfer_note,
    },
    reasoningVi: [],
  };
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
    onInspectOrderDetail,
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
  const [isDragOver, setIsDragOver] = useState(false);

  const [isVerifying, setIsVerifying] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [liveAuditResult, setLiveAuditResult] = useState<VerifyResponsePayload | null>(null);
  const [inspectedHistoryId, setInspectedHistoryId] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scenarioLockRef = useRef(false);
  const verifyReqIdRef = useRef(0);

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
    const img = opts?.imgOverride ?? imagePayload;
    const scenarioId = opts?.scenarioOverride ?? activeScenarioId;

    if (!img && !scenarioId) {
      toast.error('Hãy tải ảnh biên lai hoặc dán ảnh (Ctrl+V) để kiểm tra.');
      return;
    }

    const reqId = ++verifyReqIdRef.current;
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
              : undefined),
          imageBase64: img?.imageBase64,
          imageMimeType: img?.imageMimeType,
          imageUrl: img?.imageUrl,
          presetScenarioId: scenarioId,
        }),
      });
      const data = await res.json();
      if (reqId !== verifyReqIdRef.current) return;
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể kiểm tra biên lai.');
      }

      const payload = data as VerifyResponsePayload;
      setLiveAuditResult(payload);
      if (payload.isUnreadableReceipt || !payload.receipt) {
        toast.warning(
          payload.message ||
            'Không nhận diện được biên lai chuyển khoản — vui lòng chụp rõ ảnh màn hình ngân hàng.'
        );
        return;
      }

      setInspectedHistoryId(payload.receipt.id);
      await onVerificationUpdated();

      if (payload.alreadyPaidWarningVi) {
        toast.warning(payload.alreadyPaidWarningVi);
      } else if (data.verdict === 'fraud_suspected') {
        toast.error('Cảnh báo: Phát hiện dấu hiệu bất thường trên biên lai.');
      } else if (data.verdict === 'warning') {
        toast.warning('Biên lai có điểm cần kiểm tra lại.');
      } else {
        toast.success('Khớp đủ 4 tiêu chí. Có thể xác nhận đã nhận tiền.');
      }
    } catch (err) {
      if (reqId !== verifyReqIdRef.current) return;
      toast.error(err instanceof Error ? err.message : 'Lỗi kiểm tra biên lai.');
    } finally {
      if (reqId === verifyReqIdRef.current) {
        setIsVerifying(false);
      }
    }
  }

  async function handleLoadAndRunScenario(scenario: ReceiptFraudScenario) {
    if (scenarioLockRef.current) return;
    scenarioLockRef.current = true;
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
        omitTargetOrder: true,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không tải được ảnh biên lai.');
    } finally {
      scenarioLockRef.current = false;
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
      verifyReqIdRef.current += 1;
      setImagePreviewUrl(null);
      setImagePayload(null);
      setActiveScenarioId(undefined);
      setLiveAuditResult(null);
      setInspectedHistoryId(null);
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
      toast.success('Đã nạp ảnh biên lai.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không đọc được ảnh biên lai.');
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) void handleFileUpload(file);
        return;
      }
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      void handleFileUpload(file);
    }
  }

  async function handleHumanDecision(action: 'approve' | 'reject') {
    const activeReceiptId = displayedDossier?.receipt?.id;
    if (!activeReceiptId) return;
    setIsApproving(true);
    try {
      const res = await fetch(`/api/receipts/${activeReceiptId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể cập nhật quyết định.');
      }
      if (liveAuditResult && liveAuditResult.receipt?.id === activeReceiptId) {
        setLiveAuditResult({
          ...liveAuditResult,
          receipt: data.receipt as PaymentReceiptRow,
        });
      }
      await onVerificationUpdated();
      toast.success(
        action === 'approve'
          ? 'Đã xác nhận nhận tiền cho đơn hàng.'
          : 'Đã từ chối giao dịch và ghi nhận cảnh báo.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật quyết định.');
    } finally {
      setIsApproving(false);
    }
  }

  async function handleCopyRef(refText: string) {
    try {
      await navigator.clipboard.writeText(refText);
      setCopiedRef(true);
      toast.success(`Đã sao chép mã ${refText}`);
      setTimeout(() => setCopiedRef(false), 1800);
    } catch {
      toast.error('Không sao chép được tự động.');
    }
  }

  // Always show a populated verification dossier on right (live result OR selected/latest history receipt)
  const selectedHistoryRow =
    paymentReceipts.find((r) => r.id === inspectedHistoryId) ?? paymentReceipts[0] ?? null;

  const displayedDossier: VerifyResponsePayload | null =
    liveAuditResult &&
    (liveAuditResult.isUnreadableReceipt ||
      !inspectedHistoryId ||
      liveAuditResult.receipt?.id === inspectedHistoryId)
      ? liveAuditResult
      : selectedHistoryRow
        ? buildDossierFromHistoryRow(selectedHistoryRow)
        : null;

  return (
    <div onPaste={handlePaste} className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
      {/* Left 5 Columns: Intake Dropzone & Transfer History Queue */}
      <div className="xl:col-span-5 flex flex-col gap-4">
        <section aria-labelledby="receipt-upload-heading" className="surface-card rounded-xl p-4 sm:p-5 space-y-4">
          <div>
            <h2 id="receipt-upload-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
              Kiểm tra biên lai chuyển khoản
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Chọn đơn cần đối chiếu rồi kéo thả hoặc dán ảnh chuyển khoản của khách.
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
              className="mt-1.5 h-10 w-full rounded-lg border border-[#DFD1DB] bg-white px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {orders.length === 0 ? (
                <option value="">Chưa có đơn chờ thu — kiểm tra biên lai độc lập</option>
              ) : (
                orders.map((o) => {
                  const expected = o.transfer_amount_vnd > 0 ? o.transfer_amount_vnd : o.total_vnd;
                  const customer = cleanCustomerDisplay(o.customer_name) || cleanCustomerDisplay(o.table_or_channel);
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
                      {o.order_code} • {formatVND(expected)} • {customer} ({statusLabel})
                    </option>
                  );
                })
              )}
            </select>
          </div>

          {/* Drag & Drop / Ctrl+V Receipt Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={`relative overflow-hidden rounded-xl border border-dashed transition-colors p-4 ${
              isDragOver
                ? 'border-primary bg-[#FDF2F8]/60'
                : 'border-[#DFC7D7] bg-[#FBF8FA] hover:border-primary/50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => void handleFileUpload(e.target.files?.[0])}
            />

            {imagePreviewUrl ? (
              <div className="relative flex justify-center rounded-lg bg-white p-2 border border-[#EAE0E7]">
                <Image
                  src={imagePreviewUrl}
                  alt="Ảnh biên lai chuyển khoản"
                  width={360}
                  height={280}
                  unoptimized
                  className="max-h-56 w-auto object-contain rounded-md"
                />
                {isVerifying && (
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-primary/25 via-primary/10 to-transparent animate-scan-sweep"
                    aria-hidden="true"
                  />
                )}
              </div>
            ) : (
              <div className="py-4 text-center space-y-2.5">
                <div className="mx-auto size-10 rounded-lg bg-[#FDF2F8] border border-[#F3D0E2] flex items-center justify-center">
                  <ImagePlus className="size-5 text-primary" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    Kéo thả ảnh biên lai hoặc bấm Ctrl+V để dán
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Hoặc{' '}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="font-semibold text-primary hover:underline cursor-pointer"
                    >
                      chọn tệp từ máy
                    </button>
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {imagePreviewUrl && (
              <Button
                type="button"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="min-h-[42px] rounded-lg bg-white border-[#EAE0E7] hover:bg-[#FDF2F8] hover:border-[#EAB8D2] cursor-pointer"
              >
                <ImagePlus className="size-4 text-primary" aria-hidden="true" />
                <span>Đổi ảnh</span>
              </Button>
            )}
            <Button
              type="button"
              onClick={() => void runVerification()}
              disabled={isVerifying || (!imagePayload && !activeScenarioId)}
              className="min-h-[42px] flex-1 rounded-lg bg-primary text-primary-foreground hover:bg-[#8B0054] font-semibold text-sm cursor-pointer shadow-xs disabled:bg-[#F3EBF0] disabled:text-[#968491] disabled:border disabled:border-[#E6DAE2] disabled:opacity-100 disabled:shadow-none"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang quét biên lai...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  <span>Kiểm tra giao dịch</span>
                </>
              )}
            </Button>
          </div>
        </section>

        {/* Clickable Transfer Audit History */}
        <section aria-labelledby="receipt-history-heading" className="surface-card rounded-xl p-4 sm:p-5 space-y-3 flex-1">
          <div className="flex items-center justify-between">
            <h3 id="receipt-history-heading" className="text-sm font-semibold text-foreground">
              Lịch sử kiểm duyệt gần đây
            </h3>
            <span className="tabular-nums text-xs text-muted-foreground">
              {paymentReceipts.length} giao dịch
            </span>
          </div>

          <div className="divide-y divide-[#F0E7ED] max-h-64 overflow-y-auto pr-1">
            {paymentReceipts.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                Chưa phát sinh giao dịch chuyển khoản nào.
              </p>
            ) : (
              paymentReceipts.slice(0, 8).map((r) => {
                const isApproved = r.verdict === 'approved';
                const isRejected = r.verdict === 'rejected';
                const isWarning = !isApproved && !isRejected && (r.risk_level === 'high' || r.risk_level === 'medium');
                const isSelected = displayedDossier?.receipt?.id === r.id;

                const statusColor = isApproved
                  ? 'text-[#0F766E]'
                  : isRejected
                    ? 'text-[#BE123C]'
                    : isWarning
                      ? 'text-[#B45309]'
                      : 'text-muted-foreground';
                const dotColor = isApproved
                  ? 'bg-[#0F766E]'
                  : isRejected
                    ? 'bg-[#BE123C]'
                    : isWarning
                      ? 'bg-[#B45309]'
                      : 'bg-[#968491]';
                const statusText = isApproved
                  ? 'Đã nhận'
                  : isRejected
                    ? 'Từ chối'
                    : isWarning
                      ? 'Cảnh báo'
                      : 'Chờ duyệt';

                return (
                  <div
                    key={r.id}
                    className={`w-full py-2.5 px-2.5 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors ${
                      isSelected
                        ? 'bg-[#FDF2F8] border border-[#F3D0E2]'
                        : 'hover:bg-[#FBF8FA] border border-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setInspectedHistoryId(r.id)}
                      className="min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                    >
                      <span className="font-mono font-semibold text-foreground">{r.transaction_ref}</span>
                      <span className="text-muted-foreground"> • {cleanBankDisplay(r.bank_name)}</span>
                    </button>
                    <div className="flex items-center gap-2.5 shrink-0">
                      {r.order_id && (
                        <button
                          type="button"
                          onClick={() => onInspectOrderDetail(r.order_id as string)}
                          className="rounded border border-[#EAE0E7] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-[#A50064] hover:border-[#EAB8D2] cursor-pointer"
                        >
                          Xem đơn
                        </button>
                      )}
                      <span className="font-sans tabular-nums font-semibold text-foreground">
                        {formatVND(r.extracted_amount_vnd)}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 font-medium ${statusColor}`}>
                        <span className={`size-1.5 rounded-full ${dotColor}`} aria-hidden="true" />
                        {statusText}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Right 7 Columns: Light Verdict Verification Dossier (Never Empty) */}
      <div className="xl:col-span-7 flex flex-col">
        {isVerifying && (
          <section className="surface-card rounded-xl p-6 space-y-4 animate-pulse flex-1">
            <div className="h-24 rounded-lg bg-[#F5EEF3]" />
            <div className="space-y-3">
              <div className="h-14 rounded-lg bg-[#F9F4F7]" />
              <div className="h-14 rounded-lg bg-[#F9F4F7]" />
              <div className="h-14 rounded-lg bg-[#F9F4F7]" />
              <div className="h-14 rounded-lg bg-[#F9F4F7]" />
            </div>
          </section>
        )}

        {!isVerifying && displayedDossier && (
          <section
            aria-labelledby="dossier-heading"
            className="surface-elevated rounded-xl overflow-hidden flex flex-col justify-between flex-1"
          >
            {/* Dynamic Verdict-Tinted Light Security Header */}
            <div
              className={`p-5 space-y-4 border-b ${
                displayedDossier.verdict === 'valid'
                  ? 'bg-gradient-to-br from-[#F2FBF7] via-[#FFFFFF] to-[#F4FBF8] border-[#D1F0E4]'
                  : displayedDossier.verdict === 'warning'
                    ? 'bg-gradient-to-br from-[#FFFBF2] via-[#FFFFFF] to-[#FEF8E8] border-[#F3DFB4]'
                    : 'bg-gradient-to-br from-[#FFF5F7] via-[#FFFFFF] to-[#FEECEF] border-[#F7C6D0]'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="dossier-heading" className="text-base font-semibold tracking-tight text-foreground">
                    Hồ sơ xác thực giao dịch
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Hệ thống kiểm tra tự động, chủ quán giữ quyền xác nhận cuối cùng.
                  </p>
                </div>
                <VerdictPill verdict={displayedDossier.verdict} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-[#EAE0E7] bg-white/95 p-3.5 text-xs">
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground whitespace-nowrap">Mã tham chiếu</p>
                  <button
                    type="button"
                    onClick={() => void handleCopyRef(displayedDossier.extraction.transactionRef)}
                    className="mt-1 inline-flex items-center gap-1 font-mono font-bold text-foreground hover:text-primary cursor-pointer max-w-full"
                  >
                    <span className="truncate">{displayedDossier.extraction.transactionRef}</span>
                    {copiedRef ? <Check className="size-3 text-[#0F766E] shrink-0" /> : <Copy className="size-3 text-muted-foreground shrink-0" />}
                  </button>
                </div>

                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground whitespace-nowrap">Số tiền ảnh</p>
                  <p className="mt-1 font-sans tabular-nums font-bold text-foreground">
                    {formatVND(displayedDossier.extraction.extractedAmountVnd)}
                  </p>
                  {displayedDossier.receipt && (
                    <p className="font-sans tabular-nums text-[11px] text-muted-foreground">
                      Đơn: {formatVND(displayedDossier.receipt.expected_amount_vnd)}
                    </p>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground whitespace-nowrap">Ngân hàng</p>
                  <p className="mt-1 font-medium text-foreground truncate">
                    {cleanBankDisplay(displayedDossier.extraction.bankName)}
                  </p>
                </div>

                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground whitespace-nowrap">Nội dung CK</p>
                  <p className="mt-1 font-mono text-foreground truncate">
                    {displayedDossier.extraction.transferNote || 'Không có'}
                  </p>
                </div>
              </div>
            </div>

            {/* 4 Verification Checks + Human-in-the-Loop Footer */}
            <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
              <div className="divide-y divide-[#F0E7ED] rounded-lg border border-[#EAE0E7] bg-white px-4">
                {displayedDossier.checks.map((chk) => (
                  <div key={chk.key} className="flex items-start gap-3 py-3">
                    {chk.severity === 'pass' ? (
                      <CheckCircle2 className="size-4 text-[#0F766E] shrink-0 mt-0.5" aria-hidden="true" />
                    ) : chk.severity === 'warning' ? (
                      <AlertTriangle className="size-4 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
                    ) : (
                      <XCircle className="size-4 text-[#BE123C] shrink-0 mt-0.5" aria-hidden="true" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">
                        {stripLayerPrefix(chk.labelVi)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        {cleanMerchantCopySafe(chk.detailVi)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Warnings for Unreadable Image or Already-Paid Order */}
              {displayedDossier.isUnreadableReceipt && (
                <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-xs text-[#92400E] flex items-center justify-between gap-2">
                  <span>
                    {displayedDossier.message ||
                      'Không nhận diện được biên lai chuyển khoản — vui lòng chụp rõ ảnh màn hình ngân hàng.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="shrink-0 font-semibold underline hover:text-[#78350F] cursor-pointer"
                  >
                    Chọn ảnh khác
                  </button>
                </div>
              )}

              {displayedDossier.alreadyPaidWarningVi && (
                <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-xs text-[#92400E]">
                  {displayedDossier.alreadyPaidWarningVi}
                </div>
              )}

              {/* Human-in-the-Loop Action Footer */}
              {displayedDossier.receipt && (
                <div className="rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-foreground">Quyết định của chủ quán</span>
                    <div className="flex items-center gap-3">
                      {displayedDossier.receipt.order_id && (
                        <button
                          type="button"
                          onClick={() =>
                            onInspectOrderDetail(displayedDossier.receipt!.order_id as string)
                          }
                          className="font-semibold text-[#A50064] hover:underline cursor-pointer"
                        >
                          Xem chi tiết đơn
                        </button>
                      )}
                      <span className="font-medium text-muted-foreground">
                        Trạng thái:{' '}
                        <strong
                          className={
                            displayedDossier.receipt.verdict === 'approved'
                              ? 'text-[#0F766E]'
                              : displayedDossier.receipt.verdict === 'rejected'
                                ? 'text-[#BE123C]'
                                : 'text-foreground'
                          }
                        >
                          {displayedDossier.receipt.verdict === 'approved'
                            ? 'Đã xác nhận nhận tiền'
                            : displayedDossier.receipt.verdict === 'rejected'
                              ? 'Đã từ chối giao dịch'
                              : 'Chờ chủ quán duyệt'}
                        </strong>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Button
                      type="button"
                      disabled={isApproving || displayedDossier.receipt.verdict === 'approved'}
                      onClick={() => void handleHumanDecision('approve')}
                      className="min-h-[42px] rounded-lg bg-[#0D7A5F] hover:bg-[#0A644E] text-white font-semibold cursor-pointer disabled:opacity-60"
                    >
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      <span>
                        {displayedDossier.receipt.verdict === 'approved'
                          ? 'Đã xác nhận trước đó'
                          : 'Xác nhận đã nhận tiền'}
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isApproving}
                      onClick={() => void handleHumanDecision('reject')}
                      className="min-h-[42px] rounded-lg border-[#EAB8C4] bg-white text-[#BE123C] hover:bg-[#FFF1F2] font-semibold cursor-pointer"
                    >
                      <ShieldX className="size-4" aria-hidden="true" />
                      <span>Từ chối giao dịch</span>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {!isVerifying && !displayedDossier && (
          <section className="surface-card rounded-xl p-8 text-center space-y-2.5 flex flex-col items-center justify-center flex-1 min-h-[340px]">
            <div className="size-11 rounded-xl bg-[#FDF2F8] border border-[#F3D0E2] flex items-center justify-center text-primary">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              Sẵn sàng đối soát biên lai chuyển khoản
            </h3>
            <p className="max-w-sm text-xs text-muted-foreground leading-relaxed">
              Tải lên hoặc dán ảnh màn hình chuyển khoản ở khung bên trái để AI trích xuất mã giao dịch, kiểm tra 4 lớp và đối chiếu trùng lặp tự động.
            </p>
          </section>
        )}
      </div>
    </div>
  );
});

function cleanMerchantCopySafe(text: string): string {
  return text.replace(/Quán Cà Phê Demo/gi, 'Tiệm Cà Phê Mộc').replace(/\(Synthetic Demo\)/gi, '').trim();
}

function VerdictPill({ verdict }: { verdict: VerifyResponsePayload['verdict'] }) {
  if (verdict === 'valid') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-1 text-xs font-semibold text-[#065F46]">
        <span className="size-1.5 rounded-full bg-[#0F766E]" aria-hidden="true" />
        Hợp lệ • Khớp 4/4 tiêu chí
      </span>
    );
  }
  if (verdict === 'warning') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1 text-xs font-semibold text-[#92400E]">
        <span className="size-1.5 rounded-full bg-[#B45309]" aria-hidden="true" />
        Cần xem lại
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#FECDD3] bg-[#FFF1F2] px-2.5 py-1 text-xs font-semibold text-[#9F1239]">
      <span className="size-1.5 rounded-full bg-[#BE123C]" aria-hidden="true" />
      Cảnh báo giả mạo / Trùng mã GD
    </span>
  );
}
