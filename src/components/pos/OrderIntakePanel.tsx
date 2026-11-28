'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from 'react';
import Image from 'next/image';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  FileText,
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
import { LocalVietQRCode } from '@/components/pos/LocalVietQRCode';
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
import {
  formatTransferReminderText,
  formatVND,
  getMerchantBankInfo,
} from '@/lib/vietqr';
import type {
  MenuCategory,
  MenuItemRow,
  OrderItemRow,
  OrderRow,
  PaymentMethod,
} from '@/types/database';

const BANK_INFO = getMerchantBankInfo();
const MERCHANT_BANK_ID = BANK_INFO.bankId;
const MERCHANT_ACCOUNT_NO = BANK_INFO.accountNo;
const MERCHANT_ACCOUNT_NAME = BANK_INFO.accountName;

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
  onInspectOrderDetail: (orderId: string) => void;
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
    { menuItems, orders, onOrderCreated, onProceedToReceiptVerify, onInspectOrderDetail },
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
    const [warningsVi, setWarningsVi] = useState<string[]>([]);
    const [largeOrderConfirmed, setLargeOrderConfirmed] = useState(false);
    const [showDebtQr, setShowDebtQr] = useState(false);
    const [savedOrderResult, setSavedOrderResult] = useState<{
      order: OrderRow;
      vietqrUrl: string | null;
    } | null>(null);
    const [inspectedOrderId, setInspectedOrderId] = useState<string | null>(null);
    const [cashReceivedVnd, setCashReceivedVnd] = useState<number>(0);
    const [copiedCode, setCopiedCode] = useState(false);

    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const presetLockRef = useRef(false);
    const submitLockRef = useRef(false);
    const parseReqIdRef = useRef(0);

    useEffect(() => {
      if (inputMode !== 'voice' && recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore cleanup stop errors
        }
        setIsListening(false);
      }
    }, [inputMode]);

    useEffect(() => {
      return () => {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {
            // ignore unmount stop errors
          }
        }
      };
    }, []);

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

      const reqId = ++parseReqIdRef.current;
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
        if (reqId !== parseReqIdRef.current) return;
        if (!res.ok || !data.ok) {
          throw new Error(data.message || 'Không thể tách đơn hàng.');
        }

        const parsed = data.parsed as NormalizedOrderDraft;
        const nextWarnings: string[] = Array.isArray(data.warnings)
          ? data.warnings
          : Array.isArray(parsed.warnings)
            ? parsed.warnings
            : [];

        if (!parsed.items || parsed.items.length === 0) {
          toast.warning(
            nextWarnings[0] ||
              data.reasoningVi ||
              'Không tìm thấy món nào trong tin nhắn — vui lòng nhập rõ tên món hoặc chọn từ thực đơn.'
          );
          return;
        }

        setDraft(parsed);
        setCashReceivedVnd(0);
        setLargeOrderConfirmed(false);
        setShowDebtQr(false);
        setDraftSourceType(mode);
        setReasoningVi(data.reasoningVi || '');
        setWarningsVi(nextWarnings);
        if (nextWarnings.length > 0) {
          toast.warning('Đã tách đơn xong — lưu ý kiểm tra cảnh báo ghi chú món.');
        } else {
          toast.success('Đã tách xong món và tính tiền tự động.');
        }
      } catch (err) {
        if (reqId !== parseReqIdRef.current) return;
        toast.error(err instanceof Error ? err.message : 'Lỗi phân tích đơn hàng.');
      } finally {
        if (reqId === parseReqIdRef.current) {
          setIsParsing(false);
        }
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
        parseReqIdRef.current += 1;
        setInputMode('chat');
        setTextInput('');
        setImagePreviewUrl(null);
        setImagePayload(null);
        setDraft(null);
        setCashReceivedVnd(0);
        setLargeOrderConfirmed(false);
        setShowDebtQr(false);
        setDraftSourceType('manual');
        setReasoningVi('');
        setWarningsVi([]);
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
      setShowDebtQr(false);
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
              isUnmatched: false,
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
          warnings: [],
          confidence: 1,
        });
        setDraftSourceType('manual');
        setCashReceivedVnd(0);
        setLargeOrderConfirmed(false);
        setWarningsVi([]);
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
                    quantity: Math.min(9999, item.quantity + 1),
                    lineTotalVnd: Math.min(9999, item.quantity + 1) * item.unitPriceVnd,
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
                isUnmatched: false,
              },
            ];

      setLargeOrderConfirmed(false);
      setDraft(recalculateDraft({ ...draft, items: updatedItems }));
    }

    function updateItemQuantity(index: number, delta: number) {
      if (!draft) return;
      setSavedOrderResult(null);
      setLargeOrderConfirmed(false);
      const updatedItems: NormalizedOrderItem[] = draft.items
        .map((item, idx) => {
          if (idx !== index) return item;
          const quantity = Math.min(9999, Math.max(0, item.quantity + delta));
          return {
            ...item,
            quantity,
            lineTotalVnd: quantity * item.unitPriceVnd,
          };
        })
        .filter((item) => item.quantity > 0);

      if (updatedItems.length === 0) {
        setDraft(null);
        setCashReceivedVnd(0);
        setWarningsVi([]);
        return;
      }
      setDraft(recalculateDraft({ ...draft, items: updatedItems }));
    }

    function setDirectItemQuantity(index: number, raw: string) {
      if (!draft) return;
      const digitsOnly = raw.replace(/\D/g, '');
      setSavedOrderResult(null);
      setLargeOrderConfirmed(false);
      const qty = digitsOnly === '' ? 0 : Math.min(9999, Number(digitsOnly));
      const updatedItems = draft.items.map((item, idx) =>
        idx === index
          ? {
              ...item,
              quantity: qty,
              lineTotalVnd: qty * item.unitPriceVnd,
            }
          : item
      );
      setDraft(recalculateDraft({ ...draft, items: updatedItems }));
    }

    function commitItemQuantityOnBlur(index: number) {
      if (!draft) return;
      const target = draft.items[index];
      if (!target || target.quantity > 0) return;
      const remaining = draft.items.filter((_, idx) => idx !== index);
      if (remaining.length === 0) {
        setDraft(null);
        setCashReceivedVnd(0);
        setWarningsVi([]);
        toast.info('Đã xóa hết món khỏi phiếu nháp.');
        return;
      }
      setDraft(recalculateDraft({ ...draft, items: remaining }));
      toast.info(`Đã xóa "${target.matchedItemName}" khỏi phiếu.`);
    }

    function updateItemUnitPrice(index: number, rawPrice: string) {
      if (!draft) return;
      const cleanPrice = Math.max(0, Math.min(99_999_999, Math.round(Number(rawPrice) || 0)));
      setSavedOrderResult(null);
      setLargeOrderConfirmed(false);
      const updatedItems = draft.items.map((item, idx) =>
        idx === index
          ? {
              ...item,
              unitPriceVnd: cleanPrice,
              lineTotalVnd: item.quantity * cleanPrice,
            }
          : item
      );
      setDraft(recalculateDraft({ ...draft, items: updatedItems }));
    }

    function updatePaymentMethod(method: PaymentMethod) {
      if (!draft) return;
      setSavedOrderResult(null);
      setCashReceivedVnd(0);
      setShowDebtQr(false);
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
      if (!draft || submitLockRef.current || isSaving) return;

      const validItems = draft.items.filter((i) => i.quantity > 0);
      if (validItems.length === 0) {
        toast.error('Đơn hàng phải có ít nhất 1 món hợp lệ.');
        return;
      }

      if (draft.paymentMethod === 'debt' && !draft.customerName?.trim()) {
        toast.error('Vui lòng nhập tên khách hàng trước khi ghi sổ nợ.');
        return;
      }

      const needsLargeConfirm =
        validItems.some((i) => i.quantity >= 50) || draft.totalVnd >= 5_000_000;
      if (needsLargeConfirm && !largeOrderConfirmed) {
        toast.warning('Đơn hàng số lượng lớn — hãy tích xác nhận kiểm tra lại số lượng và tổng tiền.');
        return;
      }

      submitLockRef.current = true;
      setIsSaving(true);
      try {
        const res = await fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...draft,
            items: validItems,
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

        // Auto-clear active draft cart & AI inputs immediately to prevent accidental double-billing
        setDraft(null);
        setTextInput('');
        setImagePreviewUrl(null);
        setImagePayload(null);
        setReasoningVi('');
        setWarningsVi([]);
        setCashReceivedVnd(0);
        setLargeOrderConfirmed(false);
        setShowDebtQr(false);

        setSavedOrderResult({
          order: savedOrder,
          vietqrUrl: (data.vietqrUrl as string | null) ?? null,
        });
        setInspectedOrderId(savedOrder.id);

        if (savedOrder.payment_method === 'cash') {
          toast.success(
            `Đã thu tiền mặt ${formatVND(savedOrder.total_vnd)} — Hoàn tất đơn ${savedOrder.order_code}.`
          );
        } else if (savedOrder.payment_method === 'debt') {
          toast.success(`Đã ghi sổ công nợ đơn ${savedOrder.order_code}.`);
        } else if (savedOrder.payment_method === 'split') {
          toast.success(
            `Đã tạo đơn ${savedOrder.order_code} (Tiền mặt ${formatVND(savedOrder.cash_amount_vnd)} + VietQR ${formatVND(savedOrder.transfer_amount_vnd)}).`
          );
        } else {
          toast.success(`Đã tạo đơn ${savedOrder.order_code} và xuất mã VietQR.`);
        }
        await onOrderCreated();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Lỗi lưu đơn hàng.');
      } finally {
        submitLockRef.current = false;
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
      recognition.onerror = (event) => {
        setIsListening(false);
        if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
          toast.error('Trình duyệt chưa được cấp quyền Micro. Hãy bật quyền Micro để đọc món.');
        } else if (event?.error === 'no-speech') {
          toast.info('Chưa nghe thấy giọng nói, hãy bấm lại và đọc gần micro hơn.');
        } else {
          toast.error('Không thu được âm thanh micro. Hãy thử lại hoặc nhập trực tiếp.');
        }
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

    // Determine which order / draft feeds the right-hand Payment Terminal
    const selectedHistoryOrder =
      orders.find((o) => o.id === inspectedOrderId) ??
      orders.find((o) => o.status === 'pending_payment' && o.payment_method !== 'cash') ??
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
    const activePaymentMethod: PaymentMethod = savedOrderResult?.order
      ? savedOrderResult.order.payment_method
      : draft
        ? draft.paymentMethod
        : selectedHistoryOrder
          ? selectedHistoryOrder.payment_method
          : 'vietqr';

    const terminalIsCashOnly = activePaymentMethod === 'cash';

    const activeCashAmountVnd = savedOrderResult?.order
      ? savedOrderResult.order.cash_amount_vnd ||
        (activePaymentMethod === 'cash' ? savedOrderResult.order.total_vnd : 0)
      : draft
        ? draft.paymentMethod === 'cash'
          ? draft.totalVnd
          : draft.paymentMethod === 'split'
            ? draft.cashAmountVnd
            : 0
        : selectedHistoryOrder
          ? selectedHistoryOrder.cash_amount_vnd ||
            (activePaymentMethod === 'cash' ? selectedHistoryOrder.total_vnd : 0)
          : 0;

    const activeTerminalAmountVnd = terminalIsCashOnly
      ? 0
      : savedOrderResult?.order
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

    const activeTerminalHasLocalQr =
      !terminalIsCashOnly &&
      activePaymentMethod !== 'debt' &&
      activeTerminalAmountVnd > 0 &&
      Boolean(savedOrderResult?.order || draft || selectedHistoryOrder);

    const isLargeOrder = Boolean(
      draft && (draft.items.some((i) => i.quantity >= 50) || draft.totalVnd >= 5_000_000)
    );
    const isDebtMissingCustomer = Boolean(
      draft && draft.paymentMethod === 'debt' && !draft.customerName?.trim()
    );

    return (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left 7 Columns: Compact Smart Quick Order + Live Interactive Menu */}
        <div className="xl:col-span-7 space-y-4">
          {/* AI Quick-Order Command Bar */}
          <section
            aria-labelledby="quick-order-heading"
            onPaste={handlePasteEvent}
            className="surface-card rounded-xl p-4 space-y-3"
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
              className="grid grid-cols-3 gap-1 rounded-lg bg-[#F5EEF3] p-1"
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
                    className={`min-h-[36px] rounded-md px-2 py-1.5 flex items-center justify-center gap-1.5 text-xs transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      active
                        ? 'bg-white text-[#A50064] font-semibold shadow-2xs'
                        : 'text-muted-foreground font-medium hover:text-foreground'
                    }`}
                  >
                    <Icon
                      className={`size-3.5 shrink-0 ${active ? 'text-[#A50064]' : 'text-muted-foreground'}`}
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
                rows={2}
                aria-label="Nội dung tin nhắn đặt món"
                placeholder="Ví dụ: Bàn 4 thêm 2 cf sữa ít đá, 1 trà đào, giảm 10k khách quen..."
                className="bg-white border-[#DFD1DB] focus-visible:ring-primary text-sm leading-relaxed rounded-lg resize-none"
              />
            )}

            {inputMode === 'voice' && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={isListening ? 'destructive' : 'outline'}
                    onClick={toggleVoiceRecognition}
                    className="min-h-[38px] rounded-lg bg-white border-[#DFD1DB] cursor-pointer"
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
                  rows={2}
                  aria-label="Nội dung đọc món"
                  placeholder="Nội dung giọng nói sẽ tự điền tại đây, hoặc gõ nhanh ghi chú gọi món..."
                  className="bg-white border-[#DFD1DB] focus-visible:ring-primary text-sm leading-relaxed rounded-lg resize-none"
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
                className={`rounded-lg border border-dashed transition-colors p-3.5 ${
                  isDragOver
                    ? 'border-primary bg-[#FDF2F8]/60'
                    : 'border-[#DFC7D7] bg-[#FBF8FA]'
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
                  <div className="space-y-2">
                    <div className="relative rounded-lg border border-[#EAE0E7] bg-white p-2 flex justify-center">
                      <Image
                        src={imagePreviewUrl}
                        alt="Ảnh giấy ghi tay order"
                        width={460}
                        height={240}
                        unoptimized
                        className="max-h-44 w-auto object-contain rounded-md"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setImagePreviewUrl(null);
                          setImagePayload(null);
                        }}
                        aria-label="Xóa ảnh giấy ghi tay"
                        className="absolute top-2 right-2 size-7 rounded-md bg-white/95 border border-[#EAE0E7] text-foreground inline-flex items-center justify-center hover:bg-[#FDF2F8] hover:text-[#A50064] shadow-xs cursor-pointer"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                    <div className="space-y-0.5">
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
                      className="min-h-[38px] rounded-lg bg-white border-[#EAE0E7] hover:bg-[#FDF2F8] hover:border-[#EAB8D2] shrink-0 cursor-pointer"
                    >
                      <ImagePlus className="size-4 text-primary" aria-hidden="true" />
                      <span>Chọn ảnh</span>
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-0.5">
              <p className="text-[11px] text-muted-foreground">
                Hỗ trợ viết tắt: cf sữa, bx, giảm 10k, ghi sổ...
              </p>
              <Button
                type="button"
                onClick={() => void runParseOrder()}
                disabled={isParsing}
                className="min-h-[40px] w-full sm:w-auto px-5 rounded-lg bg-primary text-primary-foreground hover:bg-[#8B0054] font-semibold text-sm transition-colors cursor-pointer shadow-xs shrink-0"
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
            </div>
          </section>

          {/* Live Interactive Menu Grid (1-tap ordering into the exact same live ticket) */}
          <section aria-labelledby="menu-grid-heading" className="surface-card rounded-xl p-4 space-y-3">
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
                  className="h-9 pl-8 rounded-lg bg-white border-[#DFD1DB] text-xs"
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
                    className={`min-h-[32px] rounded-lg px-3 py-1 text-xs whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#FDF2F8] text-[#A50064] border border-[#EAB8D2] font-semibold'
                        : 'bg-white text-muted-foreground border border-[#EAE0E7] font-medium hover:bg-[#FBF8FA] hover:text-foreground'
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
                  className="rounded-lg border border-[#EAE0E7] bg-white hover:border-[#EAB8D2] hover:bg-[#FFF9FC] px-3 py-2.5 flex items-center justify-between gap-3 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{item.name}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-sans tabular-nums font-semibold text-primary">
                        {formatVND(item.price_vnd)}
                      </span>
                      <span>•</span>
                      <span className="tabular-nums">Đã bán {item.daily_sold_count}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleQuickAddMenuItem(item)}
                    className="min-h-[34px] rounded-lg border border-[#EAE0E7] bg-[#FBF8FA] px-2.5 py-1 inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:bg-[#FDF2F8] hover:border-[#EAB8D2] hover:text-[#A50064] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    <span>Thêm</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right 5 Columns: Sticky Live Ticket + Light Blush VietQR Terminal + Recent Orders */}
        <div className="xl:col-span-5 space-y-4 xl:sticky xl:top-5">
          {/* Skeleton during parsing */}
          {isParsing && (
            <section className="surface-card rounded-xl p-4 space-y-3 animate-pulse">
              <div className="h-4 w-32 rounded bg-[#F0E5EC]" />
              <div className="h-10 rounded-lg bg-[#F5EEF3]" />
              <div className="h-10 rounded-lg bg-[#F5EEF3]" />
              <div className="h-10 rounded-lg bg-primary/15" />
            </section>
          )}

          {/* Active Draft Ticket (when creating/editing an order) */}
          {!isParsing && draft && (
            <section aria-labelledby="ticket-heading" className="surface-elevated rounded-xl p-4 space-y-3.5">
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
                    setCashReceivedVnd(0);
                    setLargeOrderConfirmed(false);
                    setWarningsVi([]);
                    setSavedOrderResult(null);
                  }}
                  aria-label="Hủy phiếu đang lập"
                  className="size-8 rounded-lg border border-[#EAE0E7] bg-white text-muted-foreground hover:text-foreground hover:bg-[#FBF8FA] inline-flex items-center justify-center cursor-pointer"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {warningsVi.length > 0 && (
                <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 space-y-1 text-xs text-[#92400E]">
                  {warningsVi.map((w, idx) => (
                    <div key={idx} className="flex items-start gap-1.5">
                      <AlertTriangle className="size-3.5 shrink-0 mt-0.5 text-[#B45309]" aria-hidden="true" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="draft-channel" className="text-[11px] font-medium text-muted-foreground">
                    Bàn / Kênh
                  </label>
                  <Input
                    id="draft-channel"
                    maxLength={60}
                    value={draft.tableOrChannel}
                    onChange={(e) => {
                      setSavedOrderResult(null);
                      setDraft({ ...draft, tableOrChannel: e.target.value });
                    }}
                    className="mt-1 h-9 bg-white border-[#DFD1DB] rounded-lg text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="draft-customer" className="text-[11px] font-medium text-muted-foreground">
                    Khách hàng {draft.paymentMethod === 'debt' && <span className="text-[#BE123C]">*</span>}
                  </label>
                  <Input
                    id="draft-customer"
                    maxLength={80}
                    value={draft.customerName ?? ''}
                    placeholder={draft.paymentMethod === 'debt' ? 'Bắt buộc nhập tên khách' : 'Khách lẻ'}
                    aria-invalid={isDebtMissingCustomer}
                    onChange={(e) => {
                      setSavedOrderResult(null);
                      setDraft({ ...draft, customerName: e.target.value || null });
                    }}
                    className={`mt-1 h-9 bg-white rounded-lg text-xs ${
                      isDebtMissingCustomer ? 'border-[#BE123C] focus-visible:ring-[#BE123C]' : 'border-[#DFD1DB]'
                    }`}
                  />
                  {isDebtMissingCustomer && (
                    <p className="mt-1 text-[10px] font-medium text-[#BE123C]">
                      Bắt buộc nhập tên khách để ghi sổ nợ.
                    </p>
                  )}
                </div>
              </div>

              <div className="divide-y divide-[#F0E7ED] rounded-lg border border-[#EAE0E7] bg-[#FBF8FA]/60 px-3">
                {draft.items.map((item, idx) => (
                  <div
                    key={`${item.matchedItemName}-${idx}`}
                    className={`flex items-center justify-between gap-2 py-2.5 ${
                      item.isUnmatched ? 'bg-[#FFFBEB]/60 -mx-3 px-3' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-semibold text-foreground truncate">
                          {item.matchedItemName}
                        </p>
                        {item.isUnmatched && (
                          <span className="rounded bg-[#FEF3C7] border border-[#FDE68A] px-1.5 py-0.5 text-[10px] font-semibold text-[#92400E] shrink-0">
                            Ngoài thực đơn
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {item.isUnmatched ? (
                          <Input
                            type="number"
                            min={0}
                            step={1000}
                            aria-label={`Đơn giá ${item.matchedItemName}`}
                            placeholder="Nhập giá"
                            value={item.unitPriceVnd > 0 ? item.unitPriceVnd : ''}
                            onChange={(e) => updateItemUnitPrice(idx, e.target.value)}
                            className="h-6 w-24 bg-white border-[#FDE68A] px-1.5 text-[11px] font-sans tabular-nums rounded"
                          />
                        ) : (
                          <span className="font-sans tabular-nums">{formatVND(item.unitPriceVnd)}</span>
                        )}
                        {item.modifiers.map((mod, mIdx) => (
                          <span
                            key={mIdx}
                            className="rounded bg-[#F5EEF3] px-1.5 py-0.5 text-[10px] text-foreground"
                          >
                            {mod}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(idx, -1)}
                        aria-label={`Giảm ${item.matchedItemName}`}
                        className="size-7 rounded-md border border-[#EAE0E7] bg-white inline-flex items-center justify-center hover:bg-[#FDF2F8] hover:text-[#A50064] cursor-pointer"
                      >
                        {item.quantity <= 1 ? <Trash2 className="size-3" /> : <Minus className="size-3" />}
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        aria-label={`Số lượng ${item.matchedItemName}`}
                        value={item.quantity === 0 ? '' : String(item.quantity)}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setDirectItemQuantity(idx, e.target.value)}
                        onBlur={() => commitItemQuantityOnBlur(idx)}
                        className="h-7 w-11 rounded-md border border-[#DFD1DB] bg-white text-center font-sans tabular-nums text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      />
                      <button
                        type="button"
                        onClick={() => updateItemQuantity(idx, 1)}
                        aria-label={`Tăng ${item.matchedItemName}`}
                        className="size-7 rounded-md border border-[#EAE0E7] bg-white inline-flex items-center justify-center hover:bg-[#FDF2F8] hover:text-[#A50064] cursor-pointer"
                      >
                        <Plus className="size-3" />
                      </button>
                      <span className="w-20 text-right font-sans tabular-nums text-xs font-bold text-foreground">
                        {formatVND(item.lineTotalVnd)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-4 gap-1 rounded-lg bg-[#F5EEF3] p-1">
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
                    className={`min-h-[32px] rounded-md px-1.5 text-xs transition-colors cursor-pointer ${
                      draft.paymentMethod === pm.id
                        ? 'bg-white text-[#A50064] font-semibold shadow-2xs'
                        : 'text-muted-foreground font-medium hover:text-foreground'
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
                    className="mt-1 h-9 bg-white border-[#DFD1DB] font-sans tabular-nums text-xs rounded-lg"
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
                      className="mt-1 h-9 bg-white border-[#DFD1DB] font-sans tabular-nums text-xs rounded-lg"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1 border-t border-[#EAE0E7] pt-3 text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Tạm tính</span>
                  <span className="font-sans tabular-nums">{formatVND(draft.subtotalVnd)}</span>
                </div>
                {draft.discountVnd > 0 && (
                  <div className="flex justify-between text-[#0F766E]">
                    <span>Giảm giá</span>
                    <span className="font-sans tabular-nums">-{formatVND(draft.discountVnd)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between pt-1 text-sm font-bold text-foreground">
                  <span>Tổng cần thu</span>
                  <span className="font-sans tabular-nums text-lg text-primary">
                    {formatVND(draft.totalVnd)}
                  </span>
                </div>
                {draft.paymentMethod === 'split' && (
                  <div className="flex justify-between text-[11px] text-muted-foreground pt-1">
                    <span>Tiền mặt: <strong className="font-sans tabular-nums text-foreground">{formatVND(draft.cashAmountVnd)}</strong></span>
                    <span>VietQR: <strong className="font-sans tabular-nums text-primary">{formatVND(draft.transferAmountVnd)}</strong></span>
                  </div>
                )}
              </div>

              {isLargeOrder && (
                <div className="rounded-lg border border-[#F59E0B] bg-[#FFFBEB] p-3 space-y-2 text-xs text-[#92400E]">
                  <div className="flex items-start gap-2 font-semibold">
                    <AlertTriangle className="size-4 shrink-0 text-[#B45309] mt-0.5" aria-hidden="true" />
                    <span>
                      Đơn hàng số lượng lớn — Kiểm tra lại số lượng và tổng tiền trước khi xác nhận.
                    </span>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none font-medium">
                    <input
                      type="checkbox"
                      checked={largeOrderConfirmed}
                      onChange={(e) => setLargeOrderConfirmed(e.target.checked)}
                      className="size-4 rounded border-[#D97706] accent-[#A50064]"
                    />
                    <span>Tôi đã kiểm tra kỹ số lượng và tổng tiền ({formatVND(draft.totalVnd)})</span>
                  </label>
                </div>
              )}

              <Button
                type="button"
                onClick={handleSaveOrder}
                disabled={isSaving || isDebtMissingCustomer || (isLargeOrder && !largeOrderConfirmed)}
                className={`min-h-[42px] w-full rounded-lg font-semibold text-sm cursor-pointer shadow-xs ${
                  draft.paymentMethod === 'cash'
                    ? 'bg-[#0D7A5F] hover:bg-[#0A644E] text-white'
                    : 'bg-primary text-primary-foreground hover:bg-[#8B0054]'
                }`}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    <span>Đang lưu phiếu...</span>
                  </>
                ) : draft.paymentMethod === 'cash' ? (
                  <>
                    <Banknote className="size-4" aria-hidden="true" />
                    <span>Thu tiền mặt & Hoàn tất đơn</span>
                  </>
                ) : draft.paymentMethod === 'debt' ? (
                  <>
                    <BookOpen className="size-4" aria-hidden="true" />
                    <span>Xác nhận & Ghi sổ công nợ</span>
                  </>
                ) : draft.paymentMethod === 'split' ? (
                  <>
                    <QrCode className="size-4" aria-hidden="true" />
                    <span>Xác nhận tách tiền & Xuất VietQR</span>
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

          {/* Method-Aware Countertop Payment Terminal (Cash Checkout vs VietQR vs Split vs Debt) */}
          <section
            aria-labelledby="qr-stand-heading"
            className="surface-blush relative overflow-hidden rounded-xl"
          >
            <div
              className={`h-1 w-full bg-gradient-to-r ${
                terminalIsCashOnly
                  ? 'from-[#0F766E] via-[#10B981] to-[#34D399]'
                  : 'from-[#A50064] via-[#D82D8B] to-[#F472B6]'
              }`}
              aria-hidden="true"
            />

            <div className="p-4 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 id="qr-stand-heading" className="text-[15px] font-semibold tracking-tight text-foreground">
                    {terminalIsCashOnly
                      ? 'Thu tiền mặt tại quầy'
                      : activePaymentMethod === 'split'
                        ? 'Thanh toán tách tiền'
                        : activePaymentMethod === 'debt'
                          ? 'Ghi sổ công nợ & Mã nhắc nợ'
                          : 'Mã VietQR quầy'}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {terminalIsCashOnly
                      ? 'Thanh toán trực tiếp • Không cần quét mã VietQR'
                      : activePaymentMethod === 'debt'
                        ? 'Khách có thể quét mã VietQR này để thanh toán sau'
                        : `${MERCHANT_BANK_ID} • ${MERCHANT_ACCOUNT_NO} • ${MERCHANT_ACCOUNT_NAME}`}
                  </p>
                </div>
                {activeTerminalOrder && (
                  <button
                    type="button"
                    onClick={() => void handleCopyCode(activeTerminalOrder.order_code)}
                    className={`min-h-[30px] rounded-lg border bg-white px-2.5 py-1 inline-flex items-center gap-1.5 font-mono text-xs font-semibold transition-colors cursor-pointer ${
                      terminalIsCashOnly
                        ? 'border-[#A7F3D0] text-[#065F46] hover:bg-[#ECFDF5]'
                        : 'border-[#EAB8D2] text-[#A50064] hover:bg-[#FDF2F8]'
                    }`}
                  >
                    <span>{activeTerminalOrder.order_code}</span>
                    {copiedCode ? (
                      <Check className="size-3 text-[#0F766E]" />
                    ) : (
                      <Copy
                        className={`size-3 ${terminalIsCashOnly ? 'text-[#065F46]/70' : 'text-[#A50064]/70'}`}
                      />
                    )}
                  </button>
                )}
              </div>

              {terminalIsCashOnly ? (
                draft && !savedOrderResult ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]/85 px-4 py-4 text-center space-y-1.5">
                      <p className="text-xs font-medium text-[#047857]">Cần thu tiền mặt</p>
                      <p className="font-sans tabular-nums text-2xl font-bold text-[#065F46]">
                        {formatVND(activeCashAmountVnd)}
                      </p>
                    </div>

                    <div className="rounded-xl border border-[#EAE0E7] bg-white p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="cash-received-input"
                          className="text-xs font-semibold text-foreground"
                        >
                          Tính tiền thừa (Khách đưa)
                        </label>
                        <button
                          type="button"
                          onClick={() => setCashReceivedVnd(activeCashAmountVnd)}
                          className="rounded-md border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-semibold text-[#065F46] hover:bg-[#D1FAE5] cursor-pointer"
                        >
                          Đủ tiền
                        </button>
                      </div>

                      <div className="grid grid-cols-4 gap-1.5">
                        {[50000, 100000, 200000, 500000].map((denom) => (
                          <button
                            key={denom}
                            type="button"
                            onClick={() => setCashReceivedVnd(denom)}
                            className={`min-h-[32px] rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                              cashReceivedVnd === denom
                                ? 'border-[#0F766E] bg-[#ECFDF5] text-[#065F46]'
                                : 'border-[#EAE0E7] bg-[#FBF8FA] text-foreground hover:bg-[#FDF2F8] hover:border-[#EAB8D2]'
                            }`}
                          >
                            {denom / 1000}k
                          </button>
                        ))}
                      </div>

                      <Input
                        id="cash-received-input"
                        type="number"
                        min={0}
                        step={1000}
                        placeholder="Nhập số tiền khách đưa (VND)"
                        value={cashReceivedVnd > 0 ? cashReceivedVnd : ''}
                        onChange={(e) =>
                          setCashReceivedVnd(Math.max(0, Number(e.target.value) || 0))
                        }
                        className="h-9 bg-white border-[#DFD1DB] font-sans tabular-nums text-xs rounded-lg"
                      />

                      <div className="flex items-center justify-between pt-2 border-t border-[#EAE0E7] text-xs">
                        <span className="text-muted-foreground">Tiền thối lại</span>
                        {cashReceivedVnd === 0 ? (
                          <span className="font-sans tabular-nums text-muted-foreground">
                            {formatVND(0)}
                          </span>
                        ) : cashReceivedVnd >= activeCashAmountVnd ? (
                          <span className="font-sans tabular-nums text-sm font-bold text-[#0F766E]">
                            {formatVND(cashReceivedVnd - activeCashAmountVnd)}
                          </span>
                        ) : (
                          <span className="font-sans tabular-nums text-xs font-semibold text-[#B45309]">
                            Thiếu {formatVND(activeCashAmountVnd - cashReceivedVnd)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5]/90 px-4 py-5 text-center space-y-2.5">
                    <div className="mx-auto size-10 rounded-full bg-white text-[#0F766E] border border-[#A7F3D0] flex items-center justify-center">
                      <CheckCircle2 className="size-5" aria-hidden="true" />
                    </div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-[#047857]">
                      Phiếu thu tiền mặt — Đã thanh toán
                    </p>
                    <p className="font-sans tabular-nums text-2xl font-bold text-[#065F46]">
                      {formatVND(activeCashAmountVnd)}
                    </p>
                    {activeTerminalOrder && (
                      <p className="text-xs text-[#047857]">
                        {cleanCustomerDisplay(activeTerminalOrder.customer_name) ||
                          cleanCustomerDisplay(activeTerminalOrder.table_or_channel)}
                      </p>
                    )}
                    <div className="flex flex-wrap justify-center gap-2 pt-1">
                      {activeTerminalOrder && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onInspectOrderDetail(activeTerminalOrder.id)}
                          className="min-h-[34px] rounded-lg border-[#A7F3D0] bg-white text-[#065F46] hover:bg-[#ECFDF5] text-xs font-semibold cursor-pointer"
                        >
                          <FileText className="size-3.5" aria-hidden="true" />
                          <span>Xem chi tiết đơn</span>
                        </Button>
                      )}
                      {savedOrderResult && (
                        <Button
                          type="button"
                          onClick={() => setSavedOrderResult(null)}
                          className="min-h-[34px] rounded-lg bg-[#0D7A5F] hover:bg-[#0A644E] text-white text-xs font-semibold cursor-pointer"
                        >
                          Tạo đơn mới
                        </Button>
                      )}
                    </div>
                  </div>
                )
              ) : activePaymentMethod === 'debt' ? (
                draft && !savedOrderResult ? (
                  <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-5 text-center space-y-2">
                    <div className="mx-auto size-10 rounded-full bg-white text-[#B45309] border border-[#FDE68A] flex items-center justify-center">
                      <BookOpen className="size-5" aria-hidden="true" />
                    </div>
                    <p className="text-xs font-semibold text-[#92400E]">Sẵn sàng ghi sổ công nợ</p>
                    <p className="font-sans tabular-nums text-2xl font-bold text-[#92400E]">
                      {formatVND(draft.totalVnd)}
                    </p>
                    <p className="text-xs text-[#B45309]">
                      {draft.customerName?.trim()
                        ? `Khách hàng: ${draft.customerName.trim()}`
                        : 'Hãy nhập tên khách hàng bên trái trước khi ghi sổ.'}
                    </p>
                  </div>
                ) : activeTerminalOrder ? (
                  <div className="space-y-3">
                    <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-4 py-5 text-center space-y-2">
                      <div className="mx-auto size-10 rounded-full bg-white text-[#B45309] border border-[#FDE68A] flex items-center justify-center">
                        <BookOpen className="size-5" aria-hidden="true" />
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#92400E]">
                        Đã ghi sổ nợ • {activeTerminalOrder.order_code}
                      </p>
                      <p className="font-sans tabular-nums text-2xl font-bold text-[#92400E]">
                        {formatVND(activeTerminalOrder.total_vnd)}
                      </p>
                      <p className="text-xs text-[#B45309]">
                        {cleanCustomerDisplay(activeTerminalOrder.customer_name) ||
                          cleanCustomerDisplay(activeTerminalOrder.table_or_channel)}
                      </p>

                      <div className="flex flex-wrap justify-center gap-2 pt-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => {
                            const msg = formatTransferReminderText({
                              customerName:
                                cleanCustomerDisplay(activeTerminalOrder.customer_name) || 'anh/chị',
                              orderCode: activeTerminalOrder.order_code,
                              amountVnd: activeTerminalOrder.total_vnd,
                              notes: activeTerminalOrder.notes,
                            });
                            void handleCopyCode(msg);
                          }}
                          className="min-h-[36px] rounded-lg border-[#FDE68A] bg-white text-[#92400E] hover:bg-[#FEF3C7] text-xs font-semibold cursor-pointer"
                        >
                          <Copy className="size-3.5" aria-hidden="true" />
                          <span>Chép tin nhắc nợ Zalo</span>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setShowDebtQr((prev) => !prev)}
                          className="min-h-[36px] rounded-lg border-[#EAE0E7] bg-white text-foreground hover:bg-[#FDF2F8] text-xs font-semibold cursor-pointer"
                        >
                          <QrCode className="size-3.5 text-[#A50064]" aria-hidden="true" />
                          <span>{showDebtQr ? 'Ẩn QR' : 'Xem mã QR nhắc nợ'}</span>
                        </Button>
                      </div>
                    </div>

                    {showDebtQr && (
                      <div className="flex justify-center">
                        <LocalVietQRCode
                          amount={activeTerminalOrder.total_vnd}
                          addInfo={activeTerminalOrder.order_code}
                          orderCode={activeTerminalOrder.order_code}
                          compact
                          showDownload
                        />
                      </div>
                    )}

                    <div className="flex justify-between gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onInspectOrderDetail(activeTerminalOrder.id)}
                        className="min-h-[36px] flex-1 rounded-lg border-[#EAE0E7] bg-white text-xs font-semibold cursor-pointer"
                      >
                        <FileText className="size-3.5" aria-hidden="true" />
                        <span>Xem chi tiết đơn</span>
                      </Button>
                      {savedOrderResult && (
                        <Button
                          type="button"
                          onClick={() => setSavedOrderResult(null)}
                          className="min-h-[36px] flex-1 rounded-lg bg-primary text-white text-xs font-semibold cursor-pointer"
                        >
                          Tạo đơn mới
                        </Button>
                      )}
                    </div>
                  </div>
                ) : null
              ) : activeTerminalHasLocalQr ? (
                <div className="flex flex-col items-center space-y-3">
                  {activePaymentMethod === 'split' && (
                    <div className="w-full grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-3 py-2">
                        <p className="text-[11px] text-[#047857]">Tiền mặt tại quầy</p>
                        <p className="font-sans tabular-nums font-bold text-[#065F46]">
                          {formatVND(activeCashAmountVnd)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-[#EAB8D2] bg-white px-3 py-2">
                        <p className="text-[11px] text-muted-foreground">Quét VietQR</p>
                        <p className="font-sans tabular-nums font-bold text-[#A50064]">
                          {formatVND(activeTerminalAmountVnd)}
                        </p>
                      </div>
                    </div>
                  )}

                  <LocalVietQRCode
                    amount={activeTerminalAmountVnd}
                    addInfo={activeTerminalOrder?.order_code ?? 'TAM TINH DON MOI'}
                    orderCode={activeTerminalOrder?.order_code}
                    showDownload
                  />

                  <div className="w-full flex items-center justify-between gap-2 rounded-lg border border-[#F0D2E2] bg-white/95 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[11px] text-muted-foreground truncate">
                        {savedOrderResult?.order
                          ? `Đơn ${savedOrderResult.order.order_code} • Chờ quét`
                          : draft
                            ? 'Số tiền dự kiến'
                            : activeTerminalOrder
                              ? cleanCustomerDisplay(activeTerminalOrder.customer_name) ||
                                cleanCustomerDisplay(activeTerminalOrder.table_or_channel)
                              : 'Số tiền cần thu'}
                      </p>
                      <p className="font-sans tabular-nums text-lg font-bold text-[#A50064]">
                        {formatVND(activeTerminalAmountVnd)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {activeTerminalOrder && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onInspectOrderDetail(activeTerminalOrder.id)}
                          className="min-h-[36px] rounded-lg border-[#EAE0E7] bg-white text-xs font-semibold cursor-pointer"
                        >
                          Chi tiết
                        </Button>
                      )}
                      {activeTerminalOrder && (
                        <Button
                          type="button"
                          onClick={() => onProceedToReceiptVerify(activeTerminalOrder)}
                          className="min-h-[36px] rounded-lg border border-[#EAB8D2] bg-[#FDF2F8] text-[#A50064] hover:bg-[#FCE7F3] text-xs font-semibold cursor-pointer shadow-none"
                        >
                          <ShieldCheck className="size-3.5 text-[#A50064]" aria-hidden="true" />
                          <span>Kiểm duyệt CK</span>
                        </Button>
                      )}
                    </div>
                  </div>

                  {savedOrderResult && !draft && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSavedOrderResult(null)}
                      className="min-h-[36px] w-full rounded-lg border-[#EAE0E7] bg-white text-xs font-semibold cursor-pointer"
                    >
                      Tạo đơn mới cho khách tiếp theo
                    </Button>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-[#F0D2E2] bg-white/80 px-4 py-6 text-center text-xs text-muted-foreground">
                  Chọn món từ thực đơn hoặc lên đơn để sinh mã VietQR tự động.
                </div>
              )}
            </div>
          </section>

          {/* Clickable Recent Orders List */}
          <section aria-labelledby="recent-orders-heading" className="surface-card rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 id="recent-orders-heading" className="text-sm font-semibold text-foreground">
                Đơn gần đây
              </h3>
              <span className="tabular-nums text-xs text-muted-foreground">
                {orders.length} đơn
              </span>
            </div>

            <div className="divide-y divide-[#F0E7ED] max-h-[250px] overflow-y-auto pr-1">
              {orders.slice(0, 8).map((order) => {
                const displayCustomer = cleanCustomerDisplay(order.customer_name);
                const displayChannel = cleanCustomerDisplay(order.table_or_channel);
                const showCustomerSuffix =
                  Boolean(displayCustomer) &&
                  displayCustomer.trim().toLowerCase() !== displayChannel.trim().toLowerCase();
                const isSelected = activeTerminalOrder?.id === order.id && !draft;
                const methodLabel =
                  order.payment_method === 'cash'
                    ? 'Tiền mặt'
                    : order.payment_method === 'split'
                      ? 'Tách tiền'
                      : order.payment_method === 'debt'
                        ? 'Ghi sổ'
                        : 'VietQR';

                return (
                  <div
                    key={order.id}
                    className={`py-2.5 px-2.5 rounded-lg flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? 'bg-[#FDF2F8] border border-[#F3D0E2]'
                        : 'hover:bg-[#FBF8FA] border border-transparent'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(null);
                        setCashReceivedVnd(0);
                        setSavedOrderResult(null);
                        setInspectedOrderId(order.id);
                      }}
                      className="min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground">
                          {order.order_code}
                        </span>
                        <OrderStatusText status={order.status} />
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {displayChannel}
                        {showCustomerSuffix ? ` • ${displayCustomer}` : ''}
                        {` • ${methodLabel}`}
                      </p>
                    </button>

                    <div className="text-right shrink-0 flex items-center gap-1.5">
                      <span className="font-sans tabular-nums text-xs font-bold text-foreground">
                        {formatVND(order.total_vnd)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onInspectOrderDetail(order.id)}
                        className="min-h-[28px] px-2 rounded-md border border-[#EAE0E7] bg-white text-[11px] font-medium text-muted-foreground hover:text-[#A50064] hover:border-[#EAB8D2] cursor-pointer"
                      >
                        Chi tiết
                      </button>
                      {order.status === 'pending_payment' && order.payment_method !== 'cash' && (
                        <button
                          type="button"
                          onClick={() => onProceedToReceiptVerify(order)}
                          className="min-h-[28px] px-2 rounded-md border border-[#EAB8D2] bg-[#FDF2F8] text-[11px] font-semibold text-primary hover:bg-[#FCE7F3] cursor-pointer"
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
