'use client';

import Image from 'next/image';
import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import {
  ArrowRight,
  Banknote,
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
  Search,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fetchAssetAsBase64, fileToBase64 } from '@/lib/client-image';
import {
  HANDWRITTEN_ORDER_DEMO,
  SLANG_CHAT_PRESETS,
} from '@/lib/demo-presets';
import type { NormalizedOrderDraft, NormalizedOrderItem } from '@/lib/orders';
import { cleanCustomerDisplay } from '@/lib/utils';
import { buildVietQRUrl, formatVND } from '@/lib/vietqr';
import type {
  MenuCategory,
  MenuItemRow,
  OrderItemRow,
  OrderRow,
  PaymentMethod,
} from '@/types/database';

const MERCHANT_BANK_ID = (process.env.NEXT_PUBLIC_VIETQR_BANK_ID || 'MB').trim();
const MERCHANT_ACCOUNT_NO = (process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO || '0123456789').trim();
const MERCHANT_ACCOUNT_NAME = (
  process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME || 'TIEM CA PHE MOC'
)
  .replace(/QUAN CA PHE DEMO/gi, 'TIEM CA PHE MOC')
  .trim();

export interface StoreOrderWithItems extends OrderRow {
  items: OrderItemRow[];
}

export interface OrderIntakeHandle {
  runDemoPreset: (mode: 'chat' | 'handwritten') => void;
  resetView: () => void;
}

interface OrderIntakePanelProps {
  menuItems: MenuItemRow[];
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

const MENU_CATEGORY_TABS: ReadonlyArray<{ id: 'all' | MenuCategory; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'coffee', label: 'Cà phê' },
  { id: 'tea', label: 'Trà trái cây' },
  { id: 'milk_tea', label: 'Trà sữa' },
  { id: 'snack', label: 'Ăn vặt' },
  { id: 'pastry', label: 'Bánh ngọt' },
];

export const OrderIntakePanel = forwardRef<OrderIntakeHandle, OrderIntakePanelProps>(
  function OrderIntakePanel(
    { menuItems, orders, onOrderCreated, onProceedToReceiptVerify },
    ref
  ) {
    const [inputMode, setInputMode] = useState<'chat' | 'handwritten' | 'voice'>('chat');
    const [textInput, setTextInput] = useState<string>('');
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
    const [imagePayload, setImagePayload] = useState<{
      imageBase64: string;
      imageMimeType: string;
    } | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);

    const [menuCategory, setMenuCategory] = useState<'all' | MenuCategory>('all');
    const [menuQuery, setMenuQuery] = useState('');

    const [isParsing, setIsParsing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isListening, setIsListening] = useState(false);

    const [draft, setDraft] = useState<NormalizedOrderDraft | null>(null);
    const [draftSourceType, setDraftSourceType] = useState<'chat' | 'handwritten' | 'voice' | 'manual'>('manual');
    const [reasoningVi, setReasoningVi] = useState<string>('');
    const [savedOrderResult, setSavedOrderResult] = useState<{
      order: OrderRow;
      vietqrUrl: string | null;
    } | null>(null);
    const [inspectedOrderId, setInspectedOrderId] = useState<string | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const presetLockRef = useRef(false);

    async function runParseOrder(opts?: {
      mode?: 'chat' | 'handwritten' | 'voice';
      textOverride?: string;
      imgOverride?: { imageBase64: string; imageMimeType: string };
    }) {
      const mode = opts?.mode ?? inputMode;
      const text = (opts?.textOverride ?? textInput).trim();
      const img = opts?.imgOverride ?? imagePayload;

      if (mode === 'handwritten' && !img) {
        toast.error('Hãy chọn hoặc dán ảnh giấy ghi tay trước khi phân tích.');
        return;
      }
      if (mode !== 'handwritten' && !text) {
        toast.error('Hãy nhập tin nhắn đặt món hoặc chọn nhanh món từ thực đơn bên dưới.');
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
          throw new Error(data.message || 'Không thể tách đơn hàng.');
        }
        setDraft(data.parsed as NormalizedOrderDraft);
        setDraftSourceType(mode);
        setReasoningVi(data.reasoningVi || '');
        toast.success('Đã tách xong món và tính tiền tự động.');
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
          if (presetLockRef.current) return;
          presetLockRef.current = true;
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
            } finally {
              presetLockRef.current = false;
            }
          })();
        }
      },
      resetView() {
        setInputMode('chat');
        setTextInput('');
        setImagePreviewUrl(null);
        setImagePayload(null);
        setDraft(null);
        setDraftSourceType('manual');
        setReasoningVi('');
        setSavedOrderResult(null);
        setInspectedOrderId(null);
        setMenuCategory('all');
        setMenuQuery('');
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

    function handleQuickAddMenuItem(menuItem: MenuItemRow) {
      setSavedOrderResult(null);
      setReasoningVi('');
      if (!draft) {
        const nextDraft = recalculateDraft({
          tableOrChannel: 'Tại quầy',
          customerName: null,
          items: [
            {
              sku: menuItem.sku,
              menuItemId: menuItem.id,
              matchedItemName: menuItem.name,
              rawText: menuItem.name,
              quantity: 1,
              unitPriceVnd: menuItem.price_vnd,
              modifiers: [],
              paymentSplitTag: 'shared',
              lineTotalVnd: menuItem.price_vnd,
            },
          ],
          subtotalVnd: menuItem.price_vnd,
          discountVnd: 0,
          discountReason: null,
          totalVnd: menuItem.price_vnd,
          cashAmountVnd: 0,
          transferAmountVnd: menuItem.price_vnd,
          paymentMethod: 'vietqr',
          unmatchedNotes: [],
          confidence: 1,
        });
        setDraftSourceType('manual');
        setDraft(nextDraft);
        return;
      }

      const existingIdx = draft.items.findIndex(
        (i) => i.menuItemId === menuItem.id || i.sku === menuItem.sku
      );
      const updatedItems: NormalizedOrderItem[] =
        existingIdx >= 0
          ? draft.items.map((item, idx) =>
              idx === existingIdx
                ? {
                    ...item,
                    quantity: item.quantity + 1,
                    lineTotalVnd: (item.quantity + 1) * item.unitPriceVnd,
                  }
                : item
            )
          : [
              ...draft.items,
              {
                sku: menuItem.sku,
                menuItemId: menuItem.id,
                matchedItemName: menuItem.name,
                rawText: menuItem.name,
                quantity: 1,
                unitPriceVnd: menuItem.price_vnd,
                modifiers: [],
                paymentSplitTag: 'shared',
                lineTotalVnd: menuItem.price_vnd,
              },
            ];

      setDraft(recalculateDraft({ ...draft, items: updatedItems }));
    }

    function updateItemQuantity(index: number, delta: number) {
      if (!draft) return;
      setSavedOrderResult(null);
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
        setDraft(null);
        return;
      }
      setDraft(recalculateDraft({ ...draft, items: updatedItems }));
    }

    function updatePaymentMethod(method: PaymentMethod) {
      if (!draft) return;
      setSavedOrderResult(null);
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
            sourceType: draftSourceType,
            rawInput:
              draftSourceType === 'handwritten'
                ? '[Ảnh giấy ghi tay]'
                : draftSourceType === 'manual'
                  ? '[Chọn món từ thực đơn]'
                  : textInput.trim(),
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Không thể lưu đơn hàng.');
        }
        const savedOrder = data.order as OrderRow;
        setSavedOrderResult({
          order: savedOrder,
          vietqrUrl: (data.vietqrUrl as string | null) ?? null,
        });
        setInspectedOrderId(savedOrder.id);
        toast.success(`Đã tạo đơn ${savedOrder.order_code} thành công.`);
        await onOrderCreated();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi lưu đơn hàng.');
      } finally {
        setIsSaving(false);
      }
    }

    async function handleUploadImage(file: File | undefined) {
      if (!file) return;
      try {
        const loaded = await fileToBase64(file);
        setInputMode('handwritten');
        setImagePreviewUrl(loaded.dataUrl);
        setImagePayload({ imageBase64: loaded.imageBase64, imageMimeType: loaded.imageMimeType });
        toast.success('Đã nạp ảnh đơn hàng.');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Không đọc được file ảnh.');
      }
    }

    function handlePasteEvent(e: ClipboardEvent<HTMLElement>) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          const file = items[i].getAsFile();
          if (file) void handleUploadImage(file);
          return;
        }
      }
    }

    function handleDrop(e: DragEvent<HTMLDivElement>) {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith('image/')) {
        void handleUploadImage(file);
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
        toast.info('Trình duyệt hiện tại chưa hỗ trợ micro trực tiếp. Vui lòng nhập nội dung hoặc dùng Chrome/Edge.');
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
        toast.error('Không thu được âm thanh micro. Hãy thử lại hoặc kiểm tra quyền micro.');
      };
      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      setIsListening(true);
      recognition.start();
    }

    async function handleCopyCode(text: string) {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedCode(true);
        toast.success(`Đã sao chép ${text}`);
        setTimeout(() => setCopiedCode(false), 1800);
      } catch {
        toast.error('Không thể sao chép tự động.');
      }
    }

    const filteredMenu = useMemo(() => {
      const q = menuQuery.trim().toLowerCase();
      return menuItems.filter((m) => {
        if (!m.is_available) return false;
        if (menuCategory !== 'all' && m.category !== menuCategory) return false;
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          m.sku.toLowerCase().includes(q) ||
          m.aliases.some((a) => a.toLowerCase().includes(q))
        );
      });
    }, [menuItems, menuCategory, menuQuery]);

    // Determine which order / draft feeds the Dark Smoked-Glass VietQR Terminal
    const selectedHistoryOrder =
      orders.find((o) => o.id === inspectedOrderId) ??
      orders.find((o) => o.status === 'pending_payment') ??
      orders[0] ??
      null;

    const draftTransferVnd = draft
      ? draft.paymentMethod === 'cash'
        ? 0
        : draft.paymentMethod === 'split'
          ? draft.transferAmountVnd
          : draft.totalVnd
      : 0;

    const activeTerminalOrder = savedOrderResult?.order ?? (draft ? null : selectedHistoryOrder);
    const activeTerminalAmountVnd = savedOrderResult?.order
      ? savedOrderResult.order.transfer_amount_vnd > 0
        ? savedOrderResult.order.transfer_amount_vnd
        : savedOrderResult.order.total_vnd
      : draft
        ? draftTransferVnd
        : selectedHistoryOrder
          ? selectedHistoryOrder.transfer_amount_vnd > 0
            ? selectedHistoryOrder.transfer_amount_vnd
            : selectedHistoryOrder.total_vnd
          : 0;

    const activeTerminalQrUrl = savedOrderResult
      ? savedOrderResult.vietqrUrl
      : draft
        ? draftTransferVnd > 0
          ? buildVietQRUrl({ amount: draftTransferVnd, addInfo: 'TAM TINH DON MOI' })
          : null
        : selectedHistoryOrder
          ? selectedHistoryOrder.vietqr_url ||
            (activeTerminalAmountVnd > 0
              ? buildVietQRUrl({
                  amount: activeTerminalAmountVnd,
                  addInfo: selectedHistoryOrder.order_code,
                })
              : null)
          : null;

    const terminalIsCashOnly = Boolean(draft && !savedOrderResult && draft.paymentMethod === 'cash');

    return (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 7 Columns: Smart Quick Order + Live Interactive Menu */}
        <div className="xl:col-span-7 space-y-5">
          {/* AI Quick-Order Command Bar */}
          <section
            aria-labelledby="quick-order-heading"
            onPaste={handlePasteEvent}
            className="glass-panel rounded-2xl p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="quick-order-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                  Ghi đơn thông minh
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Dán tin nhắn Zalo, dán ảnh giấy ghi tay (Ctrl+V) hoặc đọc món để lên phiếu nhanh.
                </p>
              </div>
            </div>

            {/* Segmented Mode Toggle */}
            <div
              role="tablist"
              aria-label="Cách nhập đơn"
              className="grid grid-cols-3 gap-1 rounded-xl bg-black/[0.045] p-1"
            >
              {(
                [
                  { id: 'chat', label: 'Tin nhắn Zalo/FB', shortLabel: 'Tin nhắn', icon: MessageSquareText },
                  { id: 'handwritten', label: 'Chụp giấy ghi tay', shortLabel: 'Ảnh giấy', icon: Camera },
                  { id: 'voice', label: 'Đọc món', shortLabel: 'Đọc món', icon: Mic },
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
                    className={`min-h-[38px] rounded-lg px-2 py-1.5 flex items-center justify-center gap-1.5 text-xs font-medium transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'bg-white text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon
                      className={`size-3.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`}
                      aria-hidden="true"
                    />
                    <span className="sm:hidden whitespace-nowrap">{tab.shortLabel}</span>
                    <span className="hidden sm:inline whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {inputMode === 'chat' && (
              <Textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                rows={3}
                aria-label="Nội dung tin nhắn đặt món"
                placeholder="Ví dụ: Bàn 4 thêm 2 cf sữa ít đá, 1 trà đào, giảm 10k khách quen..."
                className="bg-white/85 border-white/90 focus-visible:ring-primary text-sm leading-relaxed rounded-xl resize-none shadow-2xs"
              />
            )}

            {inputMode === 'voice' && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={isListening ? 'destructive' : 'outline'}
                    onClick={toggleVoiceRecognition}
                    className="min-h-[40px] rounded-xl bg-white/85 border-border/80 cursor-pointer"
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
                </div>
                <Textarea
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  rows={3}
                  aria-label="Nội dung đọc món"
                  placeholder="Nội dung giọng nói sẽ tự điền tại đây, hoặc gõ nhanh ghi chú gọi món..."
                  className="bg-white/85 border-white/90 focus-visible:ring-primary text-sm leading-relaxed rounded-xl resize-none"
                />
              </div>
            )}

            {inputMode === 'handwritten' && (
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                className={`rounded-xl border transition-colors p-4 ${
                  isDragOver
                    ? 'border-primary bg-primary/[0.04]'
                    : 'border-white/90 bg-white/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => void handleUploadImage(e.target.files?.[0])}
                />

                {imagePreviewUrl ? (
                  <div className="space-y-2.5">
                    <div className="relative rounded-xl border border-border/70 bg-white p-2 flex justify-center">
                      <Image
                        src={imagePreviewUrl}
                        alt="Ảnh giấy ghi tay order"
                        width={460}
                        height={240}
                        unoptimized
                        className="max-h-48 w-auto object-contain rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setImagePreviewUrl(null);
                          setImagePayload(null);
                        }}
                        aria-label="Xóa ảnh giấy ghi tay"
                        className="absolute top-2 right-2 size-7 rounded-lg bg-[#18151F]/75 text-white inline-flex items-center justify-center hover:bg-[#18151F] cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-foreground">
                        Kéo thả ảnh, dán trực tiếp bằng Ctrl+V hoặc chọn từ máy
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Hỗ trợ PNG, JPG chụp giấy order viết tay tại quầy.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[40px] rounded-xl bg-white border-border shrink-0 cursor-pointer"
                    >
                      <ImagePlus className="size-4 text-primary" aria-hidden="true" />
                      <span>Chọn ảnh</span>
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Button
              type="button"
              onClick={() => void runParseOrder()}
              disabled={isParsing}
              className="min-h-[44px] w-full rounded-xl bg-primary text-primary-foreground hover:bg-[#8B0054] font-semibold text-sm transition-colors cursor-pointer shadow-[0_6px_20px_rgba(165,0,100,0.22)]"
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

          {/* Live Interactive Menu Grid (1-tap ordering into the exact same live ticket) */}
          <section aria-labelledby="menu-grid-heading" className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="menu-grid-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                  Thực đơn quán
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Chạm để thêm nhanh vào phiếu đang mở bên phải.
                </p>
              </div>

              <div className="relative w-full sm:w-52">
                <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                <Input
                  value={menuQuery}
                  onChange={(e) => setMenuQuery(e.target.value)}
                  placeholder="Tìm món (vd: bx, cf sữa)"
                  className="h-9 pl-8 rounded-xl bg-white/80 border-white/90 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {MENU_CATEGORY_TABS.map((cat) => {
                const active = menuCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setMenuCategory(cat.id)}
                    className={`min-h-[34px] rounded-lg px-3 py-1 text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#18151F] text-white'
                        : 'bg-white/70 text-muted-foreground hover:bg-white hover:text-foreground border border-white/80'
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredMenu.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-white/90 bg-white/72 hover:bg-white/95 px-3.5 py-3 flex items-center justify-between gap-3 transition-all shadow-2xs"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono tabular-nums font-semibold text-primary">
                        {formatVND(item.price_vnd)}
                      </span>
                      <span>•</span>
                      <span className="tabular-nums">Đã bán {item.daily_sold_count}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleQuickAddMenuItem(item)}
                    className="min-h-[38px] rounded-lg border border-border/80 bg-white px-2.5 py-1.5 inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:border-primary/40 hover:text-primary transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    <span>Thêm</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right 5 Columns: Sticky Live Ticket + Dark Smoked-Glass VietQR Terminal + Recent Orders */}
        <div className="xl:col-span-5 space-y-5 xl:sticky xl:top-5">
          {/* Skeleton during parsing */}
          {isParsing && (
            <section className="glass-panel rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="h-4 w-32 rounded bg-black/10" />
              <div className="h-10 rounded-xl bg-black/5" />
              <div className="h-10 rounded-xl bg-black/5" />
              <div className="h-11 rounded-xl bg-primary/20" />
            </section>
          )}

          {/* Active Draft Ticket (when creating/editing an order) */}
          {!isParsing && draft && (
            <section aria-labelledby="ticket-heading" className="glass-elevated rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 id="ticket-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                    Phiếu đơn đang lập
                  </h3>
                  {reasoningVi && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {reasoningVi}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setSavedOrderResult(null);
                  }}
                  aria-label="Hủy phiếu đang lập"
                  className="size-8 rounded-lg border border-border bg-white/80 text-muted-foreground hover:text-foreground inline-flex items-center justify-center cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="draft-channel" className="text-[11px] font-medium text-muted-foreground">
                    Bàn / Kênh
                  </label>
                  <Input
                    id="draft-channel"
                    value={draft.tableOrChannel}
                    onChange={(e) => {
                      setSavedOrderResult(null);
                      setDraft({ ...draft, tableOrChannel: e.target.value });
                    }}
                    className="mt-1 h-9 bg-white/90 rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="draft-customer" className="text-[11px] font-medium text-muted-foreground">
                    Khách hàng
                  </label>
                  <Input
                    id="draft-customer"
                    value={draft.customerName ?? ''}
                    placeholder="Khách lẻ"
                    onChange={(e) => {
                      setSavedOrderResult(null);
                      setDraft({ ...draft, customerName: e.target.value || null });
                    }}
                    className="mt-1 h-9 bg-white/90 rounded-lg text-xs"
                  />
                </div>
              </div>

              <div className="divide-y divide-border/80 rounded-xl border border-white/90 bg-white/75 px-3">
                {draft.items.map((item, idx) => (
                  <div
                    key={`${item.matchedItemName}-${idx}`}
                    className="flex items-center justify-between gap-2 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-foreground truncate">
                        {item.matchedItemName}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="font-mono tabular-nums">{formatVND(item.unitPriceVnd)}</span>
                        {item.modifiers.map((mod, mIdx) => (
                          <span
                            key={mIdx}
                            className="rounded bg-black/[0.045] px-1.5 py-0.5 text-[10px] text-foreground"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(idx, -1)}
                        aria-label={`Giảm ${item.matchedItemName}`}
                        className="size-7 rounded-md border border-border bg-white inline-flex items-center justify-center hover:bg-black/5 cursor-pointer"
                      >
                        {item.quantity === 1 ? <Trash2 className="size-3" /> : <Minus className="size-3" />}
                      </button>
                      <span className="w-5 text-center font-mono tabular-nums text-xs font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(idx, 1)}
                        aria-label={`Tăng ${item.matchedItemName}`}
                        className="size-7 rounded-md border border-border bg-white inline-flex items-center justify-center hover:bg-black/5 cursor-pointer"
                      >
                        <Plus className="size-3" />
                      </button>
                      <span className="w-20 text-right font-mono tabular-nums text-xs font-bold text-foreground">
                        {formatVND(item.lineTotalVnd)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-1 rounded-xl bg-black/[0.045] p-1">
                {(
                  [
                    { id: 'vietqr', label: 'VietQR' },
                    { id: 'cash', label: 'Tiền mặt' },
                    { id: 'split', label: 'Tách tiền' },
                    { id: 'debt', label: 'Ghi sổ' },
                  ] as const
                ).map((pm) => (
                  <button
                    key={pm.id}
                    type="button"
                    onClick={() => updatePaymentMethod(pm.id)}
                    className={`min-h-[34px] rounded-lg px-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      draft.paymentMethod === pm.id
                        ? 'bg-white text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {pm.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="draft-discount" className="text-[11px] font-medium text-muted-foreground">
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
                    className="mt-1 h-9 bg-white/90 font-mono tabular-nums text-xs"
                  />
                </div>
                {draft.paymentMethod === 'split' && (
                  <div>
                    <label htmlFor="draft-cash" className="text-[11px] font-medium text-muted-foreground">
                      Thu tiền mặt
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
                      className="mt-1 h-9 bg-white/90 font-mono tabular-nums text-xs"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1 border-t border-border/80 pt-3 text-xs">
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
                <div className="flex items-baseline justify-between pt-1 text-sm font-bold text-foreground">
                  <span>Tổng cần thu</span>
                  <span className="font-mono tabular-nums text-lg text-primary">
                    {formatVND(draft.totalVnd)}
                  </span>
                </div>
                {draft.paymentMethod === 'split' && (
                  <div className="flex justify-between text-[11px] text-muted-foreground pt-1">
                    <span>Tiền mặt: <strong className="font-mono tabular-nums text-foreground">{formatVND(draft.cashAmountVnd)}</strong></span>
                    <span>VietQR: <strong className="font-mono tabular-nums text-primary">{formatVND(draft.transferAmountVnd)}</strong></span>
                  </div>
                )}
              </div>

              <Button
                type="button"
                onClick={handleSaveOrder}
                disabled={isSaving}
                className="min-h-[44px] w-full rounded-xl bg-primary text-primary-foreground hover:bg-[#8B0054] font-semibold text-sm cursor-pointer"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Đang lưu phiếu...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="size-4" aria-hidden="true" />
                    <span>Xác nhận & Xuất mã VietQR</span>
                  </>
                )}
              </Button>
            </section>
          )}

          {/* Dark Smoked-Glass Countertop VietQR Terminal (Always meaningful, zero dead box!) */}
          <section
            aria-labelledby="qr-stand-heading"
            className="glass-dark relative overflow-hidden rounded-2xl p-5 space-y-4"
          >
            {/* Subtle top luminous glow */}
            <div
              className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-72 rounded-full blur-[70px]"
              style={{ background: 'radial-gradient(circle, rgba(216, 45, 139, 0.34) 0%, transparent 72%)' }}
              aria-hidden="true"
            />

            <div className="relative flex items-center justify-between gap-2">
              <div>
                <h3 id="qr-stand-heading" className="text-[15px] font-semibold tracking-tight text-white">
                  Mã VietQR quầy
                </h3>
                <p className="text-xs text-white/65 mt-0.5">
                  {MERCHANT_BANK_ID} • {MERCHANT_ACCOUNT_NO} • {MERCHANT_ACCOUNT_NAME}
                </p>
              </div>
              {activeTerminalOrder && (
                <button
                  type="button"
                  onClick={() => void handleCopyCode(activeTerminalOrder.order_code)}
                  className="min-h-[32px] rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-white hover:bg-white/15 transition-colors cursor-pointer"
                >
                  <span>{activeTerminalOrder.order_code}</span>
                  {copiedCode ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3 text-white/70" />}
                </button>
              )}
            </div>

            {terminalIsCashOnly ? (
              <div className="relative rounded-xl border border-white/15 bg-white/10 px-5 py-8 text-center space-y-2">
                <div className="mx-auto size-11 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
                  <Banknote className="size-5" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-white">Thu tiền mặt tại quầy</p>
                <p className="font-mono tabular-nums text-2xl font-bold text-white">
                  {formatVND(draft?.totalVnd ?? 0)}
                </p>
                <p className="text-xs text-white/65">
                  Đơn tiền mặt không cần quét mã chuyển khoản.
                </p>
              </div>
            ) : activeTerminalQrUrl ? (
              <div className="relative flex flex-col items-center space-y-3">
                <div className="rounded-2xl bg-white p-3 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
                  <Image
                    src={activeTerminalQrUrl}
                    alt="Mã VietQR thanh toán"
                    width={216}
                    height={252}
                    unoptimized
                    className="w-52 h-auto min-h-[220px] object-contain"
                  />
                </div>

                <div className="w-full flex items-center justify-between gap-2 rounded-xl border border-white/12 bg-white/[0.07] px-3.5 py-2.5">
                  <div>
                    <p className="text-[11px] text-white/65">
                      {savedOrderResult?.order
                        ? `Đơn ${savedOrderResult.order.order_code} • Chờ quét`
                        : draft
                          ? 'Số tiền dự kiến'
                          : activeTerminalOrder
                            ? `${cleanCustomerDisplay(activeTerminalOrder.customer_name) || cleanCustomerDisplay(activeTerminalOrder.table_or_channel)}`
                            : 'Số tiền cần thu'}
                    </p>
                    <p className="font-mono tabular-nums text-lg font-bold text-white">
                      {formatVND(activeTerminalAmountVnd)}
                    </p>
                  </div>

                  {activeTerminalOrder && (
                    <Button
                      type="button"
                      onClick={() => onProceedToReceiptVerify(activeTerminalOrder)}
                      className="min-h-[38px] rounded-xl bg-white text-[#18151F] hover:bg-white/90 text-xs font-semibold cursor-pointer"
                    >
                      <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
                      <span>Kiểm duyệt CK</span>
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-white/15 bg-white/[0.06] px-4 py-7 text-center text-xs text-white/70">
                Chọn món từ thực đơn hoặc lên đơn để sinh mã VietQR tự động.
              </div>
            )}
          </section>

          {/* Clickable Recent Orders List */}
          <section aria-labelledby="recent-orders-heading" className="glass-panel rounded-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 id="recent-orders-heading" className="text-sm font-semibold text-foreground">
                Đơn gần đây
              </h3>
              <span className="font-mono tabular-nums text-xs text-muted-foreground">
                {orders.length} đơn
              </span>
            </div>

            <div className="divide-y divide-border/75 max-h-[250px] overflow-y-auto pr-1">
              {orders.slice(0, 8).map((order) => {
                const displayCustomer = cleanCustomerDisplay(order.customer_name);
                const displayChannel = cleanCustomerDisplay(order.table_or_channel);
                const isSelected = activeTerminalOrder?.id === order.id && !draft;

                return (
                  <div
                    key={order.id}
                    onClick={() => {
                      setDraft(null);
                      setSavedOrderResult(null);
                      setInspectedOrderId(order.id);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDraft(null);
                        setSavedOrderResult(null);
                        setInspectedOrderId(order.id);
                      }
                    }}
                    className={`py-2.5 px-2 -mx-2 rounded-xl flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                      isSelected ? 'bg-white/90 shadow-2xs' : 'hover:bg-white/50'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground">
                          {order.order_code}
                        </span>
                        <OrderStatusText status={order.status} />
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {displayChannel}
                        {displayCustomer ? ` • ${displayCustomer}` : ''}
                      </p>
                    </div>

                    <div className="text-right shrink-0 flex items-center gap-2">
                      <span className="font-mono tabular-nums text-xs font-bold text-foreground">
                        {formatVND(order.total_vnd)}
                      </span>
                      {order.status === 'pending_payment' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onProceedToReceiptVerify(order);
                          }}
                          className="min-h-[30px] px-2 rounded-lg bg-primary/10 text-[11px] font-semibold text-primary hover:bg-primary/15 cursor-pointer"
                        >
                          Soát bill
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    );
  }
);

function OrderStatusText({ status }: { status: OrderRow['status'] }) {
  if (status === 'paid') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0F766E]">
        <span className="size-1.5 rounded-full bg-[#0F766E]" aria-hidden="true" />
        Đã thu
      </span>
    );
  }
  if (status === 'debt') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#B45309]">
        <span className="size-1.5 rounded-full bg-[#B45309]" aria-hidden="true" />
        Ghi sổ
      </span>
    );
  }
  if (status === 'cancelled') {
    return <span className="text-[11px] font-medium text-muted-foreground">Đã hủy</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
      Chờ chuyển khoản
    </span>
  );
}
