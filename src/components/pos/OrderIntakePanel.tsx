'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Minus,
  Plus,
  QrCode,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fetchAssetAsBase64, fileToBase64 } from '@/lib/client-image';
import {
  HANDWRITTEN_ORDER_DEMO,
  SLANG_CHAT_PRESETS,
  VOICE_TRANSCRIPT_PRESETS,
} from '@/lib/demo-presets';
import type { NormalizedOrderDraft, NormalizedOrderItem } from '@/lib/orders';
import { cleanCustomerDisplay } from '@/lib/utils';
import { buildVietQRUrl, formatVND } from '@/lib/vietqr';
import type { OrderItemRow, OrderRow, PaymentMethod } from '@/types/database';

const MERCHANT_BANK_LABEL = `${(process.env.NEXT_PUBLIC_VIETQR_BANK_ID || 'MB').trim()} • ${(process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO || '0123456789').trim()}`;

export interface StoreOrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

export interface OrderIntakeHandle {
  runDemoPreset: (mode: 'chat' | 'handwritten') => void;
  resetView: () => void;
}

interface OrderIntakePanelProps {
  orders: StoreOrderWithItems[];
  onOrderCreated: () => Promise<void>;
  onProceedToReceiptVerify: (order: OrderRow) => void;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionResultEvent {
  results: {
    length: number;
    [index: number]: {
      0: { transcript: string };
      isFinal: boolean;
    };
  };
}

export const OrderIntakePanel = forwardRef<OrderIntakeHandle, OrderIntakePanelProps>(
  function OrderIntakePanel({ orders, onOrderCreated, onProceedToReceiptVerify }, ref) {
    const [inputMode, setInputMode] = useState<'chat' | 'handwritten' | 'voice'>('chat');
    const [textInput, setTextInput] = useState<string>(SLANG_CHAT_PRESETS[0].rawMessage);
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
    const [imagePayload, setImagePayload] = useState<{
      imageBase64: string;
      imageMimeType: string;
    } | null>(null);

    const [isParsing, setIsParsing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [copiedCode, setCopiedCode] = useState(false);

    const [draft, setDraft] = useState<NormalizedOrderDraft | null>(null);
    const [reasoningVi, setReasoningVi] = useState<string>('');
    const [previewVietqrUrl, setPreviewVietqrUrl] = useState<string | null>(null);
    const [savedOrderResult, setSavedOrderResult] = useState<{
      order: OrderRow;
      vietqrUrl: string | null;
    } | null>(null);

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const demoLoadingRef = useRef(false);

    async function runParseOrder(opts?: {
      mode?: 'chat' | 'handwritten' | 'voice';
      textOverride?: string;
      imgOverride?: { imageBase64: string; imageMimeType: string };
    }) {
      if (isParsing) return;
      const mode = opts?.mode ?? inputMode;
      const text = (opts?.textOverride ?? textInput).trim();
      const img = opts?.imgOverride ?? imagePayload;

      if (mode === 'handwritten' && !img) {
        toast.error('Hãy chọn ảnh giấy ghi tay hoặc dùng ảnh mẫu Bàn 2.');
        return;
      }
      if (mode !== 'handwritten' && !text) {
        toast.error('Hãy nhập nội dung khách đặt trước khi tính tiền.');
        return;
      }

      setIsParsing(true);
      setSavedOrderResult(null);
      try {
        const res = await fetch('/api/orders/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inputType: mode,
            text: mode === 'handwritten' ? undefined : text,
            imageBase64: mode === 'handwritten' ? img?.imageBase64 : undefined,
            imageMimeType: mode === 'handwritten' ? img?.imageMimeType : undefined,
            autoSave: false,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Không thể tách món từ nội dung này.');
        }
        setDraft(data.parsed as NormalizedOrderDraft);
        setReasoningVi(data.reasoningVi || '');
        setPreviewVietqrUrl(data.previewVietqrUrl || null);
        toast.success('Đã tách món và tính tạm tính xong.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Có lỗi khi tách đơn hàng.');
      } finally {
        setIsParsing(false);
      }
    }

    useImperativeHandle(ref, () => ({
      runDemoPreset(mode) {
        if (isParsing || demoLoadingRef.current) return;
        if (mode === 'chat') {
          const presetText = SLANG_CHAT_PRESETS[0].rawMessage;
          setInputMode('chat');
          setTextInput(presetText);
          void runParseOrder({ mode: 'chat', textOverride: presetText });
        } else {
          demoLoadingRef.current = true;
          setInputMode('handwritten');
          void (async () => {
            try {
              const loaded = await fetchAssetAsBase64(HANDWRITTEN_ORDER_DEMO.imagePath);
              setImagePreviewUrl(loaded.dataUrl);
              setImagePayload({
                imageBase64: loaded.imageBase64,
                imageMimeType: loaded.imageMimeType,
              });
              await runParseOrder({
                mode: 'handwritten',
                imgOverride: {
                  imageBase64: loaded.imageBase64,
                  imageMimeType: loaded.imageMimeType,
                },
              });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Không tải được ảnh mẫu Bàn 2.');
            } finally {
              demoLoadingRef.current = false;
            }
          })();
        }
      },
      resetView() {
        setDraft(null);
        setReasoningVi('');
        setPreviewVietqrUrl(null);
        setSavedOrderResult(null);
        setImagePreviewUrl(null);
        setImagePayload(null);
        setInputMode('chat');
        setTextInput(SLANG_CHAT_PRESETS[0].rawMessage);
        setCopiedCode(false);
      },
    }));

    function recalculateDraft(next: NormalizedOrderDraft): NormalizedOrderDraft {
      const subtotalVnd = next.items.reduce((sum, i) => sum + i.quantity * i.unitPriceVnd, 0);
      const discountVnd = Math.min(Math.max(0, Math.round(next.discountVnd)), subtotalVnd);
      const totalVnd = Math.max(0, subtotalVnd - discountVnd);
      let cashAmountVnd = next.cashAmountVnd;
      let transferAmountVnd = next.transferAmountVnd;

      if (next.paymentMethod === 'cash') {
        cashAmountVnd = totalVnd;
        transferAmountVnd = 0;
      } else if (next.paymentMethod === 'vietqr') {
        cashAmountVnd = 0;
        transferAmountVnd = totalVnd;
      } else if (next.paymentMethod === 'debt') {
        cashAmountVnd = 0;
        transferAmountVnd = 0;
      } else if (next.paymentMethod === 'split') {
        cashAmountVnd = Math.min(totalVnd, Math.max(0, Math.round(cashAmountVnd)));
        transferAmountVnd = Math.max(0, totalVnd - cashAmountVnd);
      }

      return {
        ...next,
        subtotalVnd,
        discountVnd,
        totalVnd,
        cashAmountVnd,
        transferAmountVnd,
      };
    }

    function updateItemQuantity(index: number, delta: number) {
      if (!draft) return;
      const updatedItems: NormalizedOrderItem[] = draft.items
        .map((item, idx) => {
          if (idx !== index) return item;
          const quantity = Math.max(0, item.quantity + delta);
          return {
            ...item,
            quantity,
            lineTotalVnd: quantity * item.unitPriceVnd,
          };
        })
        .filter((item) => item.quantity > 0);

      if (updatedItems.length === 0) {
        toast.info('Đơn hàng cần giữ lại ít nhất 1 món.');
        return;
      }
      setSavedOrderResult(null);
      setDraft(recalculateDraft({ ...draft, items: updatedItems }));
    }

    function updatePaymentMethod(method: PaymentMethod) {
      if (!draft) return;
      const base = { ...draft, paymentMethod: method };
      if (method === 'split' && base.cashAmountVnd === 0) {
        const cashItemsTotal = base.items
          .filter((i) => i.paymentSplitTag === 'cash')
          .reduce((s, i) => s + i.lineTotalVnd, 0);
        base.cashAmountVnd = cashItemsTotal > 0 ? cashItemsTotal : Math.round(base.totalVnd / 2);
      }
      setSavedOrderResult(null);
      setDraft(recalculateDraft(base));
    }

    async function handleSaveOrder() {
      if (!draft || isSaving) return;
      setIsSaving(true);
      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            sourceType: inputMode,
            rawInput: inputMode === 'handwritten' ? '[Ảnh giấy ghi tay]' : textInput.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Không thể lưu đơn hàng.');
        }
        setSavedOrderResult({
          order: data.order as OrderRow,
          vietqrUrl: (data.vietqrUrl as string | null) ?? null,
        });
        toast.success(`Đã lưu đơn ${data.order.order_code}.`);
        await onOrderCreated();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi lưu đơn hàng.');
      } finally {
        setIsSaving(false);
      }
    }

    async function handleLoadHandwrittenSample() {
      try {
        const loaded = await fetchAssetAsBase64(HANDWRITTEN_ORDER_DEMO.imagePath);
        setImagePreviewUrl(loaded.dataUrl);
        setImagePayload({ imageBase64: loaded.imageBase64, imageMimeType: loaded.imageMimeType });
        toast.success('Đã mở ảnh giấy ghi tay Bàn 2.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không tải được ảnh mẫu.');
      }
    }

    async function handleUploadImage(file: File | undefined) {
      if (!file) return;
      try {
        const loaded = await fileToBase64(file);
        setImagePreviewUrl(loaded.dataUrl);
        setImagePayload({ imageBase64: loaded.imageBase64, imageMimeType: loaded.imageMimeType });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không đọc được tệp ảnh.');
      }
    }

    async function handleCopyOrderCode(code: string) {
      try {
        await navigator.clipboard.writeText(code);
        setCopiedCode(true);
        toast.success(`Đã sao chép mã đơn ${code}.`);
        setTimeout(() => setCopiedCode(false), 1800);
      } catch {
        toast.error('Không sao chép được, vui lòng chép thủ công.');
      }
    }

    function toggleVoiceRecognition() {
      if (isListening && recognitionRef.current) {
        recognitionRef.current.stop();
        setIsListening(false);
        return;
      }
      const win = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
      };
      const SpeechCtor = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (!SpeechCtor) {
        toast.info('Trình duyệt không hỗ trợ micro. Bạn có thể chọn câu đọc mẫu bên dưới.');
        return;
      }

      const recognition = new SpeechCtor();
      recognition.lang = 'vi-VN';
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript + ' ';
        }
        setTextInput(transcript.trim());
      };
      recognition.onerror = () => {
        setIsListening(false);
        toast.error('Không thu được âm thanh micro. Hãy thử lại hoặc chọn mẫu bên dưới.');
      };
      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    }

    const activeQrOrder = savedOrderResult?.order ?? null;
    const isCashOnly = activeQrOrder
      ? activeQrOrder.payment_method === 'cash'
      : draft?.paymentMethod === 'cash';

    const qrAmountVnd = isCashOnly
      ? 0
      : activeQrOrder
        ? activeQrOrder.transfer_amount_vnd > 0
          ? activeQrOrder.transfer_amount_vnd
          : activeQrOrder.total_vnd
        : draft
          ? draft.paymentMethod === 'split'
            ? draft.transferAmountVnd
            : draft.totalVnd
          : 0;

    const livePreviewQrUrl = (() => {
      if (!draft || isCashOnly || qrAmountVnd <= 0) return null;
      try {
        return buildVietQRUrl({
          amount: qrAmountVnd,
          addInfo: `TAM TINH ${draft.tableOrChannel || 'DON MOI'}`.slice(0, 40),
        });
      } catch {
        return previewVietqrUrl;
      }
    })();

    const activeQrUrl = isCashOnly ? null : (savedOrderResult?.vietqrUrl ?? livePreviewQrUrl);
    const cashCollectVnd = activeQrOrder
      ? activeQrOrder.cash_amount_vnd || activeQrOrder.total_vnd
      : draft?.totalVnd ?? 0;

    const saveCtaLabel =
      draft?.paymentMethod === 'debt'
        ? 'Lưu đơn vào sổ nợ'
        : draft?.paymentMethod === 'cash'
          ? 'Xác nhận thu tiền mặt'
          : 'Chốt đơn & Tạo mã QR';

    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left column: Order Intake + Editable Order Slip */}
        <div className="lg:col-span-7 space-y-5">
          <section aria-labelledby="order-intake-heading" className="surface-card rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2
                  id="order-intake-heading"
                  className="text-[15px] font-semibold tracking-tight text-foreground"
                >
                  Ghi đơn nhanh
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Dán tin nhắn khách đặt, chụp giấy ghi tay hoặc đọc món.
                </p>
              </div>
            </div>

            {/* Warm-stone Segmented Input Switcher */}
            <div
              role="tablist"
              aria-label="Cách nhập đơn hàng"
              className="grid grid-cols-3 gap-1 rounded-lg bg-[#F4F2EC] p-1"
            >
              {(
                [
                  { id: 'chat', label: 'Tin nhắn', icon: MessageSquareText },
                  { id: 'handwritten', label: 'Ảnh viết tay', icon: Camera },
                  { id: 'voice', label: 'Giọng nói', icon: Mic },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = inputMode === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setInputMode(tab.id)}
                    className={`min-h-[40px] flex items-center justify-center gap-1 sm:gap-1.5 rounded-md px-1.5 sm:px-2.5 text-[11.5px] sm:text-[13px] font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'bg-white text-foreground shadow-2xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon
                      className={`size-3.5 sm:size-4 shrink-0 ${active ? 'text-primary' : ''}`}
                      aria-hidden="true"
                    />
                    <span className="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {inputMode === 'chat' && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {SLANG_CHAT_PRESETS.map((preset) => {
                    const isCurrent = textInput.trim() === preset.rawMessage.trim();
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setTextInput(preset.rawMessage)}
                        className={`min-h-[36px] rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          isCurrent
                            ? 'border-primary/40 bg-[#FAF9F6] text-foreground'
                            : 'border-border bg-white text-muted-foreground hover:text-foreground hover:bg-[#FAF9F6]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
                <div>
                  <label htmlFor="order-text-input" className="sr-only">
                    Nội dung tin nhắn đặt món
                  </label>
                  <Textarea
                    id="order-text-input"
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={3}
                    placeholder="Ví dụ: Bàn 3 thêm 2 bx ít ngọt, 1 cf sữa nhiều đá, giảm 10k khách quen..."
                    className="bg-white border-input text-sm leading-relaxed rounded-lg resize-none focus-visible:ring-primary"
                  />
                </div>
              </div>
            )}

            {inputMode === 'voice' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={isListening ? 'destructive' : 'outline'}
                    onClick={toggleVoiceRecognition}
                    className="min-h-[44px] rounded-lg border-input bg-white text-foreground hover:bg-[#FAF9F6] cursor-pointer"
                  >
                    {isListening ? (
                      <>
                        <MicOff className="size-4" aria-hidden="true" />
                        <span>Dừng ghi âm</span>
                      </>
                    ) : (
                      <>
                        <Mic className="size-4 text-primary" aria-hidden="true" />
                        <span>Bắt đầu đọc món</span>
                      </>
                    )}
                  </Button>
                  {VOICE_TRANSCRIPT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setTextInput(preset.transcript)}
                      className="min-h-[36px] rounded-lg border border-border bg-[#FAF9F6] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-[#F3F1EC] cursor-pointer transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  placeholder="Lời đọc món sẽ hiện ở đây..."
                  className="bg-white border-input text-sm leading-relaxed rounded-lg resize-none focus-visible:ring-primary"
                />
              </div>
            )}

            {inputMode === 'handwritten' && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => void handleUploadImage(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[44px] rounded-lg border-input bg-white text-foreground hover:bg-[#FAF9F6] cursor-pointer"
                  >
                    <ImagePlus className="size-4 text-primary" aria-hidden="true" />
                    <span>Chọn ảnh từ máy</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleLoadHandwrittenSample}
                    className="min-h-[44px] rounded-lg border-border bg-[#FAF9F6] text-foreground hover:bg-[#F3F1EC] cursor-pointer"
                  >
                    <Camera className="size-4 text-muted-foreground" aria-hidden="true" />
                    <span>Dùng ảnh mẫu Bàn 2</span>
                  </Button>
                </div>

                {imagePreviewUrl ? (
                  <div className="rounded-lg border border-border bg-[#FAF9F6] p-2.5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imagePreviewUrl}
                      alt="Ảnh giấy ghi tay đặt món"
                      className="max-h-56 w-full object-contain rounded-md"
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-input bg-[#FAF9F6] px-5 py-6 flex flex-col items-center text-center gap-2">
                    <HandwrittenSlipIllustration />
                    <p className="text-xs text-muted-foreground max-w-xs">
                      Tải ảnh giấy ghi tay của nhân viên hoặc dùng ảnh mẫu Bàn 2 để tự động đọc món.
                    </p>
                  </div>
                )}
              </div>
            )}

            <Button
              type="button"
              onClick={() => void runParseOrder()}
              disabled={isParsing}
              className="min-h-[44px] w-full rounded-lg bg-primary text-primary-foreground hover:bg-[#8B0054] font-medium text-sm transition-colors cursor-pointer"
            >
              {isParsing ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>Đang tách món và tính tiền...</span>
                </>
              ) : (
                <>
                  <span>Lên đơn & Tính tiền</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </section>

          {/* Skeleton loader during order parsing */}
          {isParsing && (
            <section
              aria-label="Đang phân tích đơn hàng"
              className="surface-card rounded-xl p-5 space-y-4 animate-pulse"
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-36 rounded bg-[#F0EDE6]" />
                <div className="h-5 w-24 rounded-full bg-[#F0EDE6]" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="h-10 rounded-lg bg-[#F5F4F0]" />
                <div className="h-10 rounded-lg bg-[#F5F4F0]" />
              </div>
              <div className="space-y-2.5 pt-1">
                <div className="h-12 rounded-lg bg-[#F5F4F0]" />
                <div className="h-12 rounded-lg bg-[#F5F4F0]" />
                <div className="h-12 rounded-lg bg-[#F5F4F0]" />
              </div>
            </section>
          )}

          {/* Editable Draft Preview */}
          {!isParsing && draft && (
            <section aria-labelledby="draft-heading" className="surface-card rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="draft-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                  Chi tiết đơn hàng
                </h3>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#0F766E]/20 bg-[#F0FDFA] px-2 py-0.5 text-xs font-medium text-[#0F766E] tabular-nums">
                  <span className="size-1.5 rounded-full bg-[#0F766E]" aria-hidden="true" />
                  Khớp thực đơn {Math.round(draft.confidence * 100)}%
                </span>
              </div>

              {reasoningVi && (
                <p className="text-xs text-muted-foreground leading-relaxed rounded-lg bg-[#FAF9F6] border border-border px-3 py-2">
                  {reasoningVi}
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="draft-channel" className="text-xs font-medium text-muted-foreground">
                    Bàn / Kênh đặt
                  </label>
                  <Input
                    id="draft-channel"
                    value={draft.tableOrChannel}
                    onChange={(e) => setDraft({ ...draft, tableOrChannel: e.target.value })}
                    className="mt-1 h-10 bg-white rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="draft-customer" className="text-xs font-medium text-muted-foreground">
                    Tên khách hàng
                  </label>
                  <Input
                    id="draft-customer"
                    value={draft.customerName ?? ''}
                    placeholder="Khách lẻ"
                    onChange={(e) =>
                      setDraft({ ...draft, customerName: e.target.value || null })
                    }
                    className="mt-1 h-10 bg-white rounded-lg"
                  />
                </div>
              </div>

              {/* Hairline-divided Line Items */}
              <div className="rounded-lg border border-border divide-y divide-border bg-white overflow-hidden">
                {draft.items.map((item, idx) => (
                  <div
                    key={`${item.matchedItemName}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {item.matchedItemName}
                        </span>
                        {item.paymentSplitTag === 'cash' && (
                          <span className="inline-flex items-center rounded border border-[#B45309]/25 bg-[#FFFBEB] px-1.5 py-0.5 text-[11px] font-medium text-[#B45309]">
                            Tiền mặt
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">
                          {formatVND(item.unitPriceVnd)}
                        </span>
                        {item.modifiers.map((mod, mIdx) => (
                          <span
                            key={mIdx}
                            className="inline-flex items-center rounded bg-[#F4F2EC] px-1.5 py-0.5 text-[11px] text-[#57534E]"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(idx, -1)}
                        aria-label={`Giảm số lượng ${item.matchedItemName}`}
                        className="size-9 rounded-md border border-border bg-white text-muted-foreground hover:text-foreground hover:bg-[#FAF9F6] inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {item.quantity === 1 ? (
                          <Trash2 className="size-3.5" />
                        ) : (
                          <Minus className="size-3.5" />
                        )}
                      </button>
                      <span className="w-6 text-center font-mono tabular-nums text-sm font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(idx, 1)}
                        aria-label={`Tăng số lượng ${item.matchedItemName}`}
                        className="size-9 rounded-md border border-border bg-white text-muted-foreground hover:text-foreground hover:bg-[#FAF9F6] inline-flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Plus className="size-3.5" />
                      </button>
                      <span className="w-24 text-right font-mono tabular-nums text-sm font-semibold text-foreground">
                        {formatVND(item.lineTotalVnd)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Payment Method Selector */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Hình thức thanh toán
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 rounded-lg bg-[#F4F2EC] p-1">
                  {(
                    [
                      { id: 'vietqr', label: 'VietQR' },
                      { id: 'cash', label: 'Tiền mặt' },
                      { id: 'split', label: 'Tách tiền' },
                      { id: 'debt', label: 'Ghi sổ nợ' },
                    ] as const
                  ).map((pm) => {
                    const active = draft.paymentMethod === pm.id;
                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => updatePaymentMethod(pm.id)}
                        className={`min-h-[38px] rounded-md px-2 text-xs font-medium cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          active
                            ? 'bg-white text-foreground shadow-2xs'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {pm.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Discount & Cash Split Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-[#FAF9F6] border border-border p-3">
                <div>
                  <label htmlFor="draft-discount" className="text-xs font-medium text-muted-foreground">
                    Giảm giá (VND)
                  </label>
                  <Input
                    id="draft-discount"
                    type="number"
                    min={0}
                    step={1000}
                    value={draft.discountVnd}
                    onChange={(e) => {
                      setSavedOrderResult(null);
                      setDraft(
                        recalculateDraft({
                          ...draft,
                          discountVnd: Math.max(0, Number(e.target.value) || 0),
                        })
                      );
                    }}
                    className="mt-1 h-9 bg-white font-mono tabular-nums rounded-md"
                  />
                </div>
                {draft.paymentMethod === 'split' && (
                  <div>
                    <label htmlFor="draft-cash" className="text-xs font-medium text-muted-foreground">
                      Khách trả tiền mặt (VND)
                    </label>
                    <Input
                      id="draft-cash"
                      type="number"
                      min={0}
                      step={1000}
                      value={draft.cashAmountVnd}
                      onChange={(e) => {
                        setSavedOrderResult(null);
                        setDraft(
                          recalculateDraft({
                            ...draft,
                            cashAmountVnd: Math.max(0, Number(e.target.value) || 0),
                          })
                        );
                      }}
                      className="mt-1 h-9 bg-white font-mono tabular-nums rounded-md"
                    />
                  </div>
                )}
              </div>

              {/* Totals Breakdown */}
              <div className="space-y-1.5 border-t border-border pt-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Tạm tính</span>
                  <span className="font-mono tabular-nums">{formatVND(draft.subtotalVnd)}</span>
                </div>
                {draft.discountVnd > 0 && (
                  <div className="flex justify-between text-[#0F766E]">
                    <span>Giảm giá</span>
                    <span className="font-mono tabular-nums">-{formatVND(draft.discountVnd)}</span>
                  </div>
                )}
                <div className="flex justify-between items-baseline pt-1 text-base font-semibold text-foreground">
                  <span>Tổng cần thu</span>
                  <span className="font-mono tabular-nums text-lg font-bold text-foreground">
                    {formatVND(draft.totalVnd)}
                  </span>
                </div>
                {draft.paymentMethod === 'split' && (
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground pt-1 border-t border-dashed border-border">
                    <span>
                      Tiền mặt:{' '}
                      <strong className="font-mono tabular-nums text-foreground">
                        {formatVND(draft.cashAmountVnd)}
                      </strong>
                    </span>
                    <span>
                      Chuyển khoản QR:{' '}
                      <strong className="font-mono tabular-nums text-primary">
                        {formatVND(draft.transferAmountVnd)}
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              <Button
                type="button"
                onClick={handleSaveOrder}
                disabled={isSaving}
                className="min-h-[44px] w-full rounded-lg bg-primary text-primary-foreground hover:bg-[#8B0054] font-medium cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Đang lưu đơn...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="size-4" aria-hidden="true" />
                    <span>{saveCtaLabel}</span>
                  </>
                )}
              </Button>
            </section>
          )}
        </div>

        {/* Right column: Countertop Payment Stand (VietQR) + Recent Orders */}
        <div className="lg:col-span-5 space-y-5">
          <section aria-labelledby="vietqr-heading" className="surface-card rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id="vietqr-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                  Mã QR thanh toán
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tự điền đúng số tiền và mã đơn hàng.
                </p>
              </div>
              {activeQrUrl && (
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium shrink-0 ${
                    activeQrOrder
                      ? 'border-[#0F766E]/25 bg-[#F0FDFA] text-[#0F766E]'
                      : 'border-[#B45309]/25 bg-[#FFFBEB] text-[#B45309]'
                  }`}
                >
                  <span
                    className={`size-1.5 rounded-full ${
                      activeQrOrder ? 'bg-[#0F766E]' : 'bg-[#B45309]'
                    }`}
                    aria-hidden="true"
                  />
                  {activeQrOrder ? 'Đã chốt đơn' : 'Tạm tính'}
                </span>
              )}
            </div>

            {activeQrUrl ? (
              <div className="rounded-xl border border-border bg-[#FAF9F6] overflow-hidden">
                {/* Countertop Receipt Stand Header */}
                <div className="px-4 py-3 flex items-center justify-between text-xs border-b border-dashed border-border bg-white/70">
                  <div>
                    <p className="font-semibold text-foreground">TIỆM CÀ PHÊ MỘC</p>
                    <p className="text-[11px] text-muted-foreground font-mono">
                      {MERCHANT_BANK_LABEL}
                    </p>
                  </div>
                  {activeQrOrder && (
                    <button
                      type="button"
                      onClick={() => void handleCopyOrderCode(activeQrOrder.order_code)}
                      className="min-h-[36px] px-2.5 rounded-md border border-border bg-white text-xs font-mono font-semibold text-foreground hover:bg-[#FAF9F6] inline-flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span>{activeQrOrder.order_code}</span>
                      {copiedCode ? (
                        <Check className="size-3.5 text-[#0F766E]" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>

                {/* QR Frame */}
                <div className="p-4 flex flex-col items-center text-center">
                  <div className="rounded-xl border border-border bg-white p-2.5 shadow-2xs min-h-[220px] min-w-[220px] flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={activeQrUrl}
                      alt="Mã VietQR thanh toán theo đơn"
                      className="w-52 h-auto rounded-md"
                    />
                  </div>

                  <div className="mt-3.5 space-y-0.5">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      Số tiền cần chuyển khoản
                    </p>
                    <p className="font-mono tabular-nums text-2xl font-bold tracking-tight text-foreground">
                      {formatVND(qrAmountVnd)}
                    </p>
                  </div>

                  {activeQrOrder ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onProceedToReceiptVerify(activeQrOrder)}
                      className="mt-4 min-h-[44px] w-full rounded-lg border-primary/35 bg-white text-primary hover:bg-primary/5 font-medium cursor-pointer"
                    >
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      <span>Soát chuyển khoản đơn {activeQrOrder.order_code}</span>
                    </Button>
                  ) : (
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Bấm &ldquo;{saveCtaLabel}&rdquo; bên trái để chốt mã đơn chính thức.
                    </p>
                  )}
                </div>
              </div>
            ) : isCashOnly ? (
              <div className="rounded-xl border border-border bg-[#FAF9F6] px-6 py-8 flex flex-col items-center text-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-md border border-[#0F766E]/25 bg-[#F0FDFA] px-2.5 py-0.5 text-[11px] font-medium text-[#0F766E]">
                  <span className="size-1.5 rounded-full bg-[#0F766E]" aria-hidden="true" />
                  Thu tiền mặt tại quầy
                </span>
                <p className="mt-1 font-mono tabular-nums text-2xl font-bold tracking-tight text-foreground">
                  {formatVND(cashCollectVnd)}
                </p>
                <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
                  Đơn này thanh toán hoàn toàn bằng tiền mặt nên không cần tạo mã chuyển khoản VietQR.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-input bg-[#FAF9F6] px-6 py-10 flex flex-col items-center text-center gap-3">
                <QrStandIllustration />
                <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
                  Lên đơn để tạo mã thanh toán tự động.
                </p>
              </div>
            )}
          </section>

          {/* Recent Orders Ledger */}
          <section aria-labelledby="recent-orders-heading" className="surface-card rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <h2 id="recent-orders-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                Đơn gần đây
              </h2>
              <span className="font-mono tabular-nums text-xs text-muted-foreground">
                {orders.length} đơn
              </span>
            </div>

            {orders.length === 0 ? (
              <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                Chưa có đơn hàng nào hôm nay.
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[360px] overflow-y-auto">
                {orders.slice(0, 8).map((order) => {
                  const displayCustomer = cleanCustomerDisplay(order.customer_name);
                  const showCustomer =
                    displayCustomer &&
                    displayCustomer.toLowerCase() !== order.table_or_channel.toLowerCase();

                  return (
                    <div
                      key={order.id}
                      className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-[#FAF9F6]/70 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-foreground">
                            {order.order_code}
                          </span>
                          <OrderStatusIndicator status={order.status} />
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {order.table_or_channel}
                          {showCustomer ? ` • ${displayCustomer}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className="font-mono tabular-nums text-sm font-semibold text-foreground">
                          {formatVND(order.total_vnd)}
                        </p>
                        {order.status === 'pending_payment' && (
                          <button
                            type="button"
                            onClick={() => onProceedToReceiptVerify(order)}
                            className="inline-flex items-center min-h-[30px] px-2 rounded-md border border-primary/25 bg-[#FAF9F6] text-xs font-medium text-primary hover:bg-primary/5 cursor-pointer transition-colors"
                          >
                            Soát bill
                          </button>
                        )}
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
  }
);

function OrderStatusIndicator({ status }: { status: OrderRow['status'] }) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#0F766E]">
        <span className="size-1.5 rounded-full bg-[#0F766E]" aria-hidden="true" />
        Đã thu
      </span>
    );
  }
  if (status === 'debt') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#B45309]">
        <span className="size-1.5 rounded-full bg-[#B45309]" aria-hidden="true" />
        Ghi sổ
      </span>
    );
  }
  if (status === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#BE123C]">
        <span className="size-1.5 rounded-full bg-[#BE123C]" aria-hidden="true" />
        Đã hủy
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
      Chờ thanh toán
    </span>
  );
}

function QrStandIllustration() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      aria-hidden="true"
      className="text-[#A8A29E]"
    >
      <rect x="11" y="6" width="34" height="38" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="17" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="31" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="17" y="27" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M31 27h3v3h-3zM36 32h3v3h-3zM31 33h3v2h-3z" fill="currentColor" />
      <path d="M16 49h24" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M23 44l-2 5M33 44l2 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HandwrittenSlipIllustration() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 44 44"
      fill="none"
      aria-hidden="true"
      className="text-[#A8A29E]"
    >
      <rect x="9" y="6" width="26" height="32" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M15 14h14M15 20h10M15 26h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M27 31l4-4 2 2-4 4h-2v-2z" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
