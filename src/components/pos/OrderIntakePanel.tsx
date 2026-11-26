'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  Loader2,
  MessageSquareText,
  Mic,
  MicOff,
  Minus,
  Plus,
  QrCode,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fetchAssetAsBase64, fileToBase64 } from '@/lib/client-image';
import {
  HANDWRITTEN_ORDER_DEMO,
  SLANG_CHAT_PRESETS,
  VOICE_TRANSCRIPT_PRESETS,
} from '@/lib/demo-presets';
import type { NormalizedOrderDraft, NormalizedOrderItem } from '@/lib/orders';
import { formatVND } from '@/lib/vietqr';
import type { OrderItemRow, OrderRow, PaymentMethod } from '@/types/database';

export interface StoreOrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

export interface OrderIntakeHandle {
  runDemoPreset: (mode: 'chat' | 'handwritten') => void;
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
  function OrderIntakePanel(
    { orders, onOrderCreated, onProceedToReceiptVerify },
    ref
  ) {
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

    const [draft, setDraft] = useState<NormalizedOrderDraft | null>(null);
    const [reasoningVi, setReasoningVi] = useState<string>('');
    const [previewVietqrUrl, setPreviewVietqrUrl] = useState<string | null>(null);
    const [savedOrderResult, setSavedOrderResult] = useState<{
      order: OrderRow;
      vietqrUrl: string | null;
    } | null>(null);

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    async function runParseOrder(opts?: {
      mode?: 'chat' | 'handwritten' | 'voice';
      textOverride?: string;
      imgOverride?: { imageBase64: string; imageMimeType: string };
    }) {
      const mode = opts?.mode ?? inputMode;
      const text = (opts?.textOverride ?? textInput).trim();
      const img = opts?.imgOverride ?? imagePayload;

      if (mode === 'handwritten' && !img) {
        toast.error('Vui lòng chọn ảnh giấy ghi tay hoặc tải ảnh mẫu.');
        return;
      }
      if (mode !== 'handwritten' && !text) {
        toast.error('Vui lòng nhập nội dung đơn hàng trước khi phân tích.');
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
          throw new Error(data.message || 'Không thể phân tích đơn hàng.');
        }
        setDraft(data.parsed as NormalizedOrderDraft);
        setReasoningVi(data.reasoningVi || '');
        setPreviewVietqrUrl(data.previewVietqrUrl || null);
        toast.success('AI đã bóc tách đơn hàng thành công.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi phân tích đơn hàng.');
      } finally {
        setIsParsing(false);
      }
    }

    useImperativeHandle(ref, () => ({
      runDemoPreset(mode) {
        if (mode === 'chat') {
          const presetText = SLANG_CHAT_PRESETS[0].rawMessage;
          setInputMode('chat');
          setTextInput(presetText);
          void runParseOrder({ mode: 'chat', textOverride: presetText });
        } else {
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
              toast.error(err instanceof Error ? err.message : 'Không tải được ảnh mẫu viết tay.');
            }
          })();
        }
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
      toast.info('Đơn hàng cần ít nhất 1 món.');
      return;
    }
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
    setDraft(recalculateDraft(base));
  }

  async function handleSaveOrder() {
    if (!draft) return;
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
      toast.success(`Đã tạo đơn ${data.order.order_code} thành công.`);
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
      toast.success('Đã nạp ảnh giấy ghi tay Bàn 2.');
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
      toast.error(err instanceof Error ? err.message : 'Không đọc được file ảnh.');
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
      toast.info('Trình duyệt không hỗ trợ micro trực tiếp. Bạn có thể chọn câu đọc mẫu bên dưới.');
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
      toast.error('Không thu được âm thanh micro. Hãy thử lại hoặc chọn mẫu giọng nói.');
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  }

  const activeQrUrl = savedOrderResult?.vietqrUrl ?? previewVietqrUrl;
  const activeQrOrder = savedOrderResult?.order;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* Left column: Multimodal Input + AI Draft Preview */}
      <div className="lg:col-span-7 space-y-5">
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              Nhận đơn đa phương thức
            </CardTitle>
            <CardDescription>
              Nhập tin nhắn tiếng lóng Zalo, nói qua micro hoặc chụp giấy ghi tay để AI tự khớp thực đơn.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode Switcher */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setInputMode('chat')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                  inputMode === 'chat'
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                    : 'bg-secondary/50 text-foreground border-border hover:bg-secondary'
                }`}
              >
                <MessageSquareText className="size-4 shrink-0" aria-hidden="true" />
                <span>Chat tiếng lóng</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode('handwritten')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                  inputMode === 'handwritten'
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                    : 'bg-secondary/50 text-foreground border-border hover:bg-secondary'
                }`}
              >
                <Camera className="size-4 shrink-0" aria-hidden="true" />
                <span>Giấy ghi tay</span>
              </button>
              <button
                type="button"
                onClick={() => setInputMode('voice')}
                className={`min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                  inputMode === 'voice'
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                    : 'bg-secondary/50 text-foreground border-border hover:bg-secondary'
                }`}
              >
                <Mic className="size-4 shrink-0" aria-hidden="true" />
                <span>Giọng nói</span>
              </button>
            </div>

            {inputMode === 'chat' && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {SLANG_CHAT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setTextInput(preset.rawMessage)}
                      className="min-h-[36px] rounded-full border border-primary/25 bg-secondary/70 px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary cursor-pointer transition-colors"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  placeholder="Ví dụ: Bàn 3 thêm 2 bx ít ngọt, 1 cf sữa nhiều đá, giảm 10k khách quen..."
                  className="bg-white border-border focus-visible:ring-primary text-sm"
                />
              </div>
            )}

            {inputMode === 'voice' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={isListening ? 'destructive' : 'outline'}
                    onClick={toggleVoiceRecognition}
                    className="min-h-[44px] border-primary/30 cursor-pointer"
                  >
                    {isListening ? (
                      <>
                        <MicOff className="size-4 animate-pulse" aria-hidden="true" />
                        <span>Dừng thu âm</span>
                      </>
                    ) : (
                      <>
                        <Mic className="size-4 text-primary" aria-hidden="true" />
                        <span>Bấm để nói tiếng Việt</span>
                      </>
                    )}
                  </Button>
                  {VOICE_TRANSCRIPT_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setTextInput(preset.transcript)}
                      className="min-h-[36px] rounded-full border border-primary/25 bg-secondary/70 px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <Textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  placeholder="Nội dung giọng nói sẽ hiển thị tại đây..."
                  className="bg-white border-border focus-visible:ring-primary text-sm"
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
                    className="min-h-[44px] border-primary/30 cursor-pointer"
                  >
                    <ImagePlus className="size-4 text-primary" aria-hidden="true" />
                    <span>Tải ảnh giấy ghi tay</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleLoadHandwrittenSample}
                    className="min-h-[44px] cursor-pointer"
                  >
                    <FileImageIcon />
                    <span>Nạp ảnh mẫu Bàn 2</span>
                  </Button>
                </div>

                {imagePreviewUrl ? (
                  <div className="relative rounded-xl border border-border bg-muted/40 p-2">
                    <img
                      src={imagePreviewUrl}
                      alt="Ảnh giấy ghi tay order"
                      className="max-h-56 w-full object-contain rounded-lg"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-primary/30 bg-secondary/30 p-6 text-center text-xs text-muted-foreground">
                    Chọn ảnh giấy ghi tay từ máy hoặc bấm &ldquo;Nạp ảnh mẫu Bàn 2&rdquo; để AI Vision đọc món.
                  </div>
                )}
              </div>
            )}

            <Button
              type="button"
              onClick={() => void runParseOrder()}
              disabled={isParsing}
              className="min-h-[44px] w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold cursor-pointer"
            >
              {isParsing ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  <span>AI đang bóc tách thực đơn...</span>
                </>
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden="true" />
                  <span>Phân tích đơn bằng AI</span>
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Editable AI Draft Preview */}
        {draft && (
          <Card className="border-primary/25 bg-card shadow-xs">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-semibold">
                  Xem trước đơn đã bóc tách
                </CardTitle>
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">
                  Độ tin cậy {Math.round(draft.confidence * 100)}%
                </Badge>
              </div>
              {reasoningVi && (
                <p className="text-xs text-muted-foreground leading-relaxed">{reasoningVi}</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Bàn / Kênh</label>
                  <Input
                    value={draft.tableOrChannel}
                    onChange={(e) => setDraft({ ...draft, tableOrChannel: e.target.value })}
                    className="mt-1 h-10 bg-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Khách hàng</label>
                  <Input
                    value={draft.customerName ?? ''}
                    placeholder="Khách lẻ"
                    onChange={(e) =>
                      setDraft({ ...draft, customerName: e.target.value || null })
                    }
                    className="mt-1 h-10 bg-white"
                  />
                </div>
              </div>

              <div className="space-y-2">
                {draft.items.map((item, idx) => (
                  <div
                    key={`${item.matchedItemName}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-secondary/25 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {item.matchedItemName}
                        </span>
                        {item.paymentSplitTag === 'cash' && (
                          <Badge variant="outline" className="text-[11px] border-amber-300 bg-amber-50 text-amber-800">
                            Thu tiền mặt
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{formatVND(item.unitPriceVnd)} / phần</span>
                        {item.modifiers.map((mod, mIdx) => (
                          <Badge key={mIdx} variant="secondary" className="text-[11px]">
                            {mod}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => updateItemQuantity(idx, -1)}
                        aria-label={`Giảm số lượng ${item.matchedItemName}`}
                        className="size-9 cursor-pointer"
                      >
                        {item.quantity === 1 ? <Trash2 className="size-3.5" /> : <Minus className="size-3.5" />}
                      </Button>
                      <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => updateItemQuantity(idx, 1)}
                        aria-label={`Tăng số lượng ${item.matchedItemName}`}
                        className="size-9 cursor-pointer"
                      >
                        <Plus className="size-3.5" />
                      </Button>
                      <span className="w-24 text-right text-sm font-semibold text-primary">
                        {formatVND(item.lineTotalVnd)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Payment method + Discount */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(
                  [
                    { id: 'vietqr', label: 'VietQR' },
                    { id: 'cash', label: 'Tiền mặt' },
                    { id: 'split', label: 'Tách tiền' },
                    { id: 'debt', label: 'Ghi sổ nợ' },
                  ] as const
                ).map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => updatePaymentMethod(pm.id)}
                    className={`min-h-[40px] rounded-xl border px-2 text-xs font-medium cursor-pointer transition-colors ${
                      draft.paymentMethod === pm.id
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-white text-foreground border-border hover:bg-secondary/50'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl bg-muted/50 p-3 text-sm">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Giảm giá khách quen</label>
                  <Input
                    type="number"
                    min={0}
                    step={1000}
                    value={draft.discountVnd}
                    onChange={(e) =>
                      setDraft(
                        recalculateDraft({
                          ...draft,
                          discountVnd: Math.max(0, Number(e.target.value) || 0),
                        })
                      )
                    }
                    className="mt-1 h-9 bg-white"
                  />
                </div>
                {draft.paymentMethod === 'split' && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Thu tiền mặt</label>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={draft.cashAmountVnd}
                      onChange={(e) =>
                        setDraft(
                          recalculateDraft({
                            ...draft,
                            cashAmountVnd: Math.max(0, Number(e.target.value) || 0),
                          })
                        )
                      }
                      className="mt-1 h-9 bg-white"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5 border-t border-border pt-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Tạm tính</span>
                  <span>{formatVND(draft.subtotalVnd)}</span>
                </div>
                {draft.discountVnd > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Giảm giá</span>
                    <span>-{formatVND(draft.discountVnd)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-foreground">
                  <span>Tổng thanh toán</span>
                  <span className="text-primary">{formatVND(draft.totalVnd)}</span>
                </div>
                {draft.paymentMethod === 'split' && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Tiền mặt: {formatVND(draft.cashAmountVnd)}</span>
                    <span>Chuyển khoản VietQR: {formatVND(draft.transferAmountVnd)}</span>
                  </div>
                )}
              </div>

              <Button
                type="button"
                onClick={handleSaveOrder}
                disabled={isSaving}
                className="min-h-[44px] w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Đang lưu đơn hàng...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="size-4" aria-hidden="true" />
                    <span>Tạo Đơn & Sinh VietQR</span>
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Right column: Dynamic VietQR Card + Recent Orders */}
      <div className="lg:col-span-5 space-y-5">
        <Card className="border-primary/25 bg-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <QrCode className="size-4 text-primary" aria-hidden="true" />
              Mã VietQR Động Theo Đơn
            </CardTitle>
            <CardDescription>
              Tự động điền chính xác số tiền cần chuyển khoản và mã đơn hàng.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeQrUrl ? (
              <div className="flex flex-col items-center rounded-2xl border border-primary/20 bg-gradient-to-b from-[#FDF2F8] to-white p-4 text-center">
                {activeQrOrder ? (
                  <Badge className="mb-2 bg-primary text-primary-foreground">
                    Đơn {activeQrOrder.order_code} • Đã lưu hệ thống
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="mb-2">
                    Mã QR Tạm tính • Bấm Tạo Đơn để chốt mã
                  </Badge>
                )}
                <img
                  src={activeQrUrl}
                  alt="Mã VietQR thanh toán động"
                  className="w-60 h-auto rounded-xl border border-border bg-white p-1 shadow-xs"
                />
                {activeQrOrder && (
                  <div className="mt-3 w-full space-y-2">
                    <p className="text-sm font-semibold text-foreground">
                      Số tiền quét QR:{' '}
                      <span className="text-primary">
                        {formatVND(
                          activeQrOrder.transfer_amount_vnd > 0
                            ? activeQrOrder.transfer_amount_vnd
                            : activeQrOrder.total_vnd
                        )}
                      </span>
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onProceedToReceiptVerify(activeQrOrder)}
                      className="min-h-[44px] w-full border-primary/35 text-primary hover:bg-primary/8 cursor-pointer"
                    >
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      <span>Chuyển sang Đối soát Bill cho {activeQrOrder.order_code}</span>
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-8 text-center text-xs text-muted-foreground">
                Phân tích đơn hàng bên trái để hiển thị mã VietQR chính xác theo số tiền chuyển khoản.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Đơn hàng gần nhất</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 max-h-[380px] overflow-y-auto">
            {orders.slice(0, 8).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold text-foreground">
                      {order.order_code}
                    </span>
                    <OrderStatusBadge status={order.status} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {order.table_or_channel}
                    {order.customer_name ? ` • ${order.customer_name}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-sm font-bold text-primary">{formatVND(order.total_vnd)}</p>
                  {order.status === 'pending_payment' && (
                    <button
                      type="button"
                      onClick={() => onProceedToReceiptVerify(order)}
                      className="text-xs font-medium text-primary hover:underline cursor-pointer"
                    >
                      Đối soát bill
                    </button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

function FileImageIcon() {
  return <Camera className="size-4 text-primary" aria-hidden="true" />;
}

function OrderStatusBadge({ status }: { status: OrderRow['status'] }) {
  if (status === 'paid') {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 gap-1">
        <CheckCircle2 className="size-3" aria-hidden="true" />
        Đã thu
      </Badge>
    );
  }
  if (status === 'debt') {
    return (
      <Badge className="bg-amber-100 text-amber-800 border-amber-200">Ghi sổ</Badge>
    );
  }
  if (status === 'cancelled') {
    return <Badge variant="destructive">Đã hủy</Badge>;
  }
  return (
    <Badge className="bg-secondary text-secondary-foreground border-primary/20">
      Chờ thanh toán
    </Badge>
  );
}
