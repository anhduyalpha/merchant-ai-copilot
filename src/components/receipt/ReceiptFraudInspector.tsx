'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchAssetAsBase64, fileToBase64 } from '@/lib/client-image';
import { RECEIPT_FRAUD_SCENARIOS, type ReceiptFraudScenario } from '@/lib/demo-presets';
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
  const [auditResult, setAuditResult] = useState<VerifyResponsePayload | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      toast.error('Vui lòng tải ảnh biên lai hoặc chọn 1 kịch bản kiểm tra mẫu.');
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
        throw new Error(data.message || 'Không thể kiểm tra biên lai.');
      }

      setAuditResult(data as VerifyResponsePayload);
      await onVerificationUpdated();

      if (data.verdict === 'fraud_suspected') {
        toast.error('Cảnh báo rủi ro cao: Phát hiện dấu hiệu gian lận biên lai!');
      } else if (data.verdict === 'warning') {
        toast.warning('Biên lai có điểm cần lưu ý, vui lòng kiểm tra kỹ.');
      } else {
        toast.success('4 lớp đối soát an toàn! Sẵn sàng duyệt 1 chạm.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi kiểm tra biên lai.');
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleLoadAndRunScenario(scenario: ReceiptFraudScenario) {
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
      toast.error(err instanceof Error ? err.message : 'Không tải được ảnh kịch bản.');
    }
  }

  useImperativeHandle(ref, () => ({
    runDemoPreset(scenarioId) {
      const scenario = RECEIPT_FRAUD_SCENARIOS.find((s) => s.id === scenarioId);
      if (scenario) {
        void handleLoadAndRunScenario(scenario);
      }
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
      toast.error(err instanceof Error ? err.message : 'Không đọc được ảnh biên lai.');
    }
  }

  async function handleHumanDecision(action: 'approve' | 'reject') {
    if (!auditResult?.receipt?.id) return;
    setIsApproving(true);
    try {
      const res = await fetch(`/api/receipts/${auditResult.receipt.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể cập nhật quyết định.');
      }
      setAuditResult((prev) => (prev ? { ...prev, receipt: data.receipt as PaymentReceiptRow } : prev));
      await onVerificationUpdated();
      toast.success(
        action === 'approve'
          ? 'Đã duyệt thanh toán biên lai!'
          : 'Đã từ chối biên lai và gắn cảnh báo đơn hàng.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật quyết định.');
    } finally {
      setIsApproving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left: Order Target + Receipt Upload + 3 Presets */}
      <div className="lg:col-span-5 space-y-5">
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldAlert className="size-4 text-primary" aria-hidden="true" />
              Nạp biên lai cần đối soát
            </CardTitle>
            <CardDescription>
              Chọn đơn đối chiếu rồi tải ảnh chụp màn hình chuyển khoản hoặc thử 1 trong 3 kịch bản gian lận.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="target-order-select" className="text-xs font-medium text-muted-foreground">
                Đơn hàng đối chiếu
              </label>
              <select
                id="target-order-select"
                value={targetOrder?.id ?? ''}
                onChange={(e) => onSelectOrderId(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-input bg-white px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {orders.map((o) => {
                  const expected = o.transfer_amount_vnd > 0 ? o.transfer_amount_vnd : o.total_vnd;
                  return (
                    <option key={o.id} value={o.id}>
                      {o.order_code} • {formatVND(expected)} ({o.status === 'paid' ? 'Đã thu' : 'Chờ thu'})
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Kịch bản kiểm chứng nhanh</p>
              <div className="space-y-2">
                {RECEIPT_FRAUD_SCENARIOS.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    disabled={isVerifying}
                    onClick={() => void handleLoadAndRunScenario(sc)}
                    className={`min-h-[44px] w-full flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-all cursor-pointer ${
                      sc.expectedRiskLevel === 'low'
                        ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100/70'
                        : 'border-rose-200 bg-rose-50/70 text-rose-900 hover:bg-rose-100/70'
                    }`}
                  >
                    <span>{sc.titleVi}</span>
                    <Badge
                      variant="outline"
                      className={
                        sc.expectedRiskLevel === 'low'
                          ? 'border-emerald-300 bg-white text-emerald-800 shrink-0'
                          : 'border-rose-300 bg-white text-rose-800 shrink-0'
                      }
                    >
                      {sc.expectedRiskLevel === 'low' ? 'An toàn' : 'Rủi ro cao'}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
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
                className="min-h-[44px] w-full border-primary/30 cursor-pointer"
              >
                <ImagePlus className="size-4 text-primary" aria-hidden="true" />
                <span>Tải ảnh biên lai từ thiết bị</span>
              </Button>

              {imagePreviewUrl && (
                <div className="rounded-xl border border-border bg-muted/40 p-2">
                  <img
                    src={imagePreviewUrl}
                    alt="Ảnh biên lai cần đối soát"
                    className="max-h-64 w-full object-contain rounded-lg"
                  />
                </div>
              )}

              <Button
                type="button"
                onClick={() => void runVerification()}
                disabled={isVerifying || (!imagePayload && !activeScenarioId)}
                className="min-h-[44px] w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold cursor-pointer"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Đang chạy 4 lớp đối soát AI...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" aria-hidden="true" />
                    <span>Kiểm tra biên lai bằng AI</span>
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right: 4-Layer Audit Card + Human-in-the-Loop + History */}
      <div className="lg:col-span-7 space-y-5">
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base font-semibold">
                Kết quả thẩm định chống giả mạo 4 lớp
              </CardTitle>
              {auditResult && <VerdictBannerBadge verdict={auditResult.verdict} />}
            </div>
            <CardDescription>
              AI đề xuất rủi ro minh bạch, chủ quán giữ quyền xác nhận cuối cùng.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {auditResult ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-border bg-secondary/25 p-3 text-xs">
                  <div>
                    <p className="text-muted-foreground">Mã giao dịch</p>
                    <p className="font-mono font-bold text-foreground mt-0.5">
                      {auditResult.extraction.transactionRef}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Số tiền đọc được</p>
                    <p className="font-bold text-primary mt-0.5">
                      {formatVND(auditResult.extraction.extractedAmountVnd)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Ngân hàng</p>
                    <p className="font-medium text-foreground mt-0.5 truncate">
                      {auditResult.extraction.bankName}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Nội dung CK</p>
                    <p className="font-medium text-foreground mt-0.5 truncate">
                      {auditResult.extraction.transferNote || 'Không có'}
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {auditResult.checks.map((chk) => (
                    <div
                      key={chk.key}
                      className={`flex items-start gap-3 rounded-xl border p-3 ${
                        chk.severity === 'pass'
                          ? 'border-emerald-200 bg-emerald-50/60'
                          : chk.severity === 'warning'
                            ? 'border-amber-200 bg-amber-50/70'
                            : 'border-rose-200 bg-rose-50/70'
                      }`}
                    >
                      {chk.severity === 'pass' ? (
                        <CheckCircle2 className="size-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : chk.severity === 'warning' ? (
                        <AlertTriangle className="size-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                      ) : (
                        <XCircle className="size-5 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{chk.labelVi}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {chk.detailVi}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Human-in-the-Loop Decision Bar */}
                <div className="rounded-xl border border-primary/25 bg-secondary/35 p-3.5 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      Quyết định của chủ quán (Human-in-the-Loop)
                    </span>
                    <Badge variant="outline" className="bg-white">
                      Trạng thái:{' '}
                      {auditResult.receipt.verdict === 'approved'
                        ? 'Đã duyệt thu tiền'
                        : auditResult.receipt.verdict === 'rejected'
                          ? 'Đã từ chối'
                          : 'Chờ xác nhận'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <Button
                      type="button"
                      disabled={isApproving}
                      onClick={() => void handleHumanDecision('approve')}
                      className="min-h-[44px] bg-emerald-700 hover:bg-emerald-800 text-white cursor-pointer"
                    >
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      <span>Duyệt thanh toán</span>
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isApproving}
                      onClick={() => void handleHumanDecision('reject')}
                      className="min-h-[44px] cursor-pointer"
                    >
                      <ShieldX className="size-4" aria-hidden="true" />
                      <span>Từ chối & Cảnh báo</span>
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-8 text-center text-xs text-muted-foreground">
                Chọn 1 trong 3 kịch bản kiểm tra bên trái hoặc tải ảnh biên lai để xem chi tiết chẩn đoán 4 lớp.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Lịch sử đối soát gần đây</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-60 overflow-y-auto">
            {paymentReceipts.slice(0, 6).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-mono font-bold text-foreground">{r.transaction_ref}</span>
                  <span className="text-muted-foreground"> • {r.bank_name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="font-semibold">{formatVND(r.extracted_amount_vnd)}</span>
                  <Badge
                    className={
                      r.risk_level === 'high' || r.verdict === 'rejected'
                        ? 'bg-rose-100 text-rose-800 border-rose-200'
                        : r.verdict === 'approved'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : 'bg-amber-100 text-amber-800 border-amber-200'
                    }
                  >
                    {r.verdict === 'approved'
                      ? 'Đã duyệt'
                      : r.verdict === 'rejected'
                        ? 'Từ chối'
                        : 'Chờ duyệt'}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

function VerdictBannerBadge({ verdict }: { verdict: VerifyResponsePayload['verdict'] }) {
  if (verdict === 'valid') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
        An toàn • Khớp 4/4 lớp
      </Badge>
    );
  }
  if (verdict === 'warning') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200">
        Cần kiểm tra lại
      </Badge>
    );
  }
  return (
    <Badge className="bg-rose-100 text-rose-800 border-rose-200">
      Nghi ngờ giả mạo
    </Badge>
  );
}
