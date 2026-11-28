'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  QrCode,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { LocalVietQRCode } from '@/components/pos/LocalVietQRCode';
import type { StoreOrderWithItems } from '@/components/pos/OrderIntakePanel';
import { Button } from '@/components/ui/button';
import { cleanBankDisplay, cleanCustomerDisplay } from '@/lib/utils';
import { formatVND } from '@/lib/vietqr';
import type { OrderRow, PaymentReceiptRow } from '@/types/database';

interface OrderDetailModalProps {
  order: StoreOrderWithItems | null;
  receipts: PaymentReceiptRow[];
  onClose: () => void;
  onOrderUpdated: () => Promise<void>;
  onProceedToReceiptVerify: (order: OrderRow) => void;
}

export function OrderDetailModal({
  order,
  receipts,
  onClose,
  onOrderUpdated,
  onProceedToReceiptVerify,
}: OrderDetailModalProps) {
  const [updatingStatus, setUpdatingStatus] = useState<'paid' | 'cancelled' | null>(null);
  const [qrOrderId, setQrOrderId] = useState<string | null>(null);
  const showQr = Boolean(order && qrOrderId === order.id);

  useEffect(() => {
    if (!order) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [order, onClose]);

  if (!order) return null;

  const linkedReceipts = receipts.filter((r) => r.order_id === order.id);
  const customerName = cleanCustomerDisplay(order.customer_name);
  const channelLabel = cleanCustomerDisplay(order.table_or_channel);
  const transferAmount =
    order.payment_method === 'cash'
      ? 0
      : order.transfer_amount_vnd > 0
        ? order.transfer_amount_vnd
        : order.payment_method === 'vietqr' || order.payment_method === 'debt'
          ? order.total_vnd
          : 0;

  async function handleStatusAction(status: 'paid' | 'cancelled') {
    if (!order) return;
    setUpdatingStatus(status);
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || 'Không thể cập nhật trạng thái đơn.');
      }
      toast.success(
        status === 'paid'
          ? `Đã đánh dấu thu đủ đơn ${order.order_code}.`
          : `Đã hủy đơn ${order.order_code}.`
      );
      await onOrderUpdated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lỗi cập nhật đơn hàng.');
    } finally {
      setUpdatingStatus(null);
    }
  }

  const createdTime = (() => {
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date(order.created_at));
    } catch {
      return order.created_at;
    }
  })();

  const paymentLabel =
    order.payment_method === 'cash'
      ? 'Tiền mặt'
      : order.payment_method === 'split'
        ? 'Tách tiền mặt + VietQR'
        : order.payment_method === 'debt'
          ? 'Ghi sổ công nợ'
          : 'Chuyển khoản VietQR';

  const statusPill =
    order.status === 'paid'
      ? { text: 'Đã thanh toán', cls: 'border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]' }
      : order.status === 'debt'
        ? { text: 'Ghi sổ nợ', cls: 'border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]' }
        : order.status === 'cancelled'
          ? { text: 'Đã hủy', cls: 'border-[#EAE0E7] bg-[#F5EEF3] text-[#665562]' }
          : { text: 'Chờ thanh toán', cls: 'border-[#F3D0E2] bg-[#FDF2F8] text-[#A50064]' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-detail-title"
    >
      <div
        className="fixed inset-0 bg-[#231520]/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-[#EAE0E7] shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-[#EAE0E7] px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="order-detail-title" className="text-base font-bold text-foreground font-mono">
                {order.order_code}
              </h2>
              <span
                className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusPill.cls}`}
              >
                {statusPill.text}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {createdTime} • {channelLabel}
              {customerName ? ` • ${customerName}` : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng chi tiết đơn hàng"
            className="size-8 rounded-lg border border-[#EAE0E7] bg-white text-muted-foreground hover:text-foreground hover:bg-[#FBF8FA] inline-flex items-center justify-center cursor-pointer"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Itemized list */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Chi tiết món đã gọi</p>
            {order.items.length > 0 ? (
              <div className="divide-y divide-[#F0E7ED] rounded-xl border border-[#EAE0E7] bg-[#FBF8FA]/60 px-3.5">
                {order.items.map((item) => (
                  <div key={item.id} className="py-2.5 flex items-start justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground">
                        {item.quantity} × {item.item_name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="font-sans tabular-nums">
                          {formatVND(item.unit_price_vnd)} / phần
                        </span>
                        {item.modifiers?.map((m, idx) => (
                          <span
                            key={idx}
                            className="rounded bg-[#F5EEF3] px-1.5 py-0.5 text-[10px] text-foreground"
                          >
                            {m}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className="font-sans tabular-nums font-bold text-foreground shrink-0">
                      {formatVND(item.line_total_vnd)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-[#EAE0E7] bg-[#FBF8FA] p-3 text-xs text-muted-foreground">
                Chưa có chi tiết dòng món cho đơn này.
              </p>
            )}
          </div>

          {/* Totals & Payment Breakdown */}
          <div className="rounded-xl border border-[#EAE0E7] bg-white p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Hình thức thanh toán</span>
              <span className="font-semibold text-foreground">{paymentLabel}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Tạm tính</span>
              <span className="font-sans tabular-nums">{formatVND(order.subtotal_vnd)}</span>
            </div>
            {order.discount_vnd > 0 && (
              <div className="flex justify-between text-[#0F766E]">
                <span>Giảm giá</span>
                <span className="font-sans tabular-nums">-{formatVND(order.discount_vnd)}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline pt-1.5 border-t border-[#EAE0E7] text-sm font-bold text-foreground">
              <span>Tổng cộng</span>
              <span className="font-sans tabular-nums text-base text-[#A50064]">
                {formatVND(order.total_vnd)}
              </span>
            </div>
            {order.payment_method === 'split' && (
              <div className="flex justify-between text-[11px] text-muted-foreground pt-1">
                <span>Tiền mặt: {formatVND(order.cash_amount_vnd)}</span>
                <span>VietQR: {formatVND(order.transfer_amount_vnd)}</span>
              </div>
            )}
            {order.notes && (
              <p className="text-[11px] text-muted-foreground pt-1 border-t border-[#F3EBF0]">
                Ghi chú: {order.notes}
              </p>
            )}
          </div>

          {/* Linked Receipt Audits */}
          {linkedReceipts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground">Lịch sử đối soát chuyển khoản</p>
              <div className="space-y-2">
                {linkedReceipts.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] px-3 py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-mono font-semibold text-foreground">{r.transaction_ref}</span>
                      <span className="text-muted-foreground"> • {cleanBankDisplay(r.bank_name)}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-sans tabular-nums font-semibold">
                        {formatVND(r.extracted_amount_vnd)}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          r.verdict === 'approved'
                            ? 'bg-[#ECFDF5] text-[#065F46]'
                            : r.verdict === 'rejected'
                              ? 'bg-[#FFF1F2] text-[#9F1239]'
                              : 'bg-[#FFFBEB] text-[#92400E]'
                        }`}
                      >
                        {r.verdict === 'approved'
                          ? 'Đã nhận'
                          : r.verdict === 'rejected'
                            ? 'Từ chối'
                            : 'Chờ duyệt'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Optional Local VietQR View */}
          {showQr && transferAmount > 0 && (
            <div className="rounded-xl border border-[#F0D2E2] bg-[#FFF8FB] p-4 flex justify-center">
              <LocalVietQRCode
                amount={transferAmount}
                addInfo={order.order_code}
                orderCode={order.order_code}
                compact
                showDownload
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-1">
            {order.status !== 'paid' && order.status !== 'cancelled' && transferAmount > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setQrOrderId((prev) => (prev === order.id ? null : order.id))}
                className="min-h-[40px] rounded-lg border-[#EAE0E7] bg-white hover:bg-[#FDF2F8] hover:border-[#EAB8D2] text-xs font-semibold cursor-pointer"
              >
                <QrCode className="size-3.5 text-[#A50064]" aria-hidden="true" />
                <span>{showQr ? 'Ẩn mã VietQR' : 'Xem mã VietQR'}</span>
              </Button>
            )}

            {order.status === 'pending_payment' && order.payment_method !== 'cash' && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose();
                  onProceedToReceiptVerify(order);
                }}
                className="min-h-[40px] rounded-lg border-[#EAB8D2] bg-[#FDF2F8] text-[#A50064] hover:bg-[#FCE7F3] text-xs font-semibold cursor-pointer"
              >
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                <span>Kiểm duyệt CK</span>
              </Button>
            )}

            {(order.status === 'pending_payment' || order.status === 'debt') && (
              <>
                <Button
                  type="button"
                  disabled={updatingStatus !== null}
                  onClick={() => void handleStatusAction('paid')}
                  className="min-h-[40px] flex-1 rounded-lg bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-xs font-semibold cursor-pointer"
                >
                  {updatingStatus === 'paid' ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                  )}
                  <span>Đánh dấu đã thu</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updatingStatus !== null}
                  onClick={() => void handleStatusAction('cancelled')}
                  className="min-h-[40px] rounded-lg border-[#EAB8C4] bg-white text-[#BE123C] hover:bg-[#FFF1F2] text-xs font-semibold cursor-pointer"
                >
                  {updatingStatus === 'cancelled' ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <XCircle className="size-3.5" aria-hidden="true" />
                  )}
                  <span>Hủy đơn</span>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
