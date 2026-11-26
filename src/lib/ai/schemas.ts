import { z } from 'zod';

/**
 * Workflow 1: Multimodal Order Intake + Dynamic VietQR
 * Matches Vietnamese slang (cf sữa, bx, trà đào), modifiers, split payment, and regular-customer discounts.
 */
export const ParsedOrderItemSchema = z.object({
  sku: z.string().nullable().default(null),
  matchedItemName: z.string().min(1),
  rawText: z.string().default(''),
  quantity: z.number().int().positive(),
  unitPriceVnd: z.number().int().nonnegative().default(0),
  modifiers: z.array(z.string()).default([]),
  paymentSplitTag: z.enum(['cash', 'transfer', 'shared']).catch('shared').default('shared'),
  lineTotalVnd: z.number().int().nonnegative().default(0),
});

export const ParsedOrderSchema = z.object({
  tableOrChannel: z.string().min(1).default('Tại quầy'),
  customerName: z.string().nullable().default(null),
  items: z.array(ParsedOrderItemSchema).min(1),
  subtotalVnd: z.number().int().nonnegative().default(0),
  discountVnd: z.number().int().nonnegative().default(0),
  discountReason: z.string().nullable().default(null),
  totalVnd: z.number().int().nonnegative().default(0),
  cashAmountVnd: z.number().int().nonnegative().default(0),
  transferAmountVnd: z.number().int().nonnegative().default(0),
  paymentMethod: z.enum(['vietqr', 'cash', 'split', 'debt', 'transfer']).catch('vietqr').default('vietqr'),
  unmatchedNotes: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).catch(0.9).default(0.9),
});

export type ParsedOrderItem = z.infer<typeof ParsedOrderItemSchema>;
export type ParsedOrder = z.infer<typeof ParsedOrderSchema>;

/**
 * Workflow 2: 4-Layer Receipt Verification & Anti-Fraud (Human-in-the-Loop)
 * Extracts banking fields + visual tampering signals from uploaded transfer screenshots.
 */
export const ReceiptExtractionSchema = z.object({
  transactionRef: z.string().min(1),
  bankName: z.string().min(1),
  extractedAmountVnd: z.number().int().nonnegative(),
  receiptTimestampIso: z.string().nullable().default(null),
  transferNote: z.string().nullable().default(null),
  senderName: z.string().nullable().default(null),
  receiverAccountNo: z.string().nullable().default(null),
  visualTamperingFlags: z.array(z.string()).default([]),
  tamperingConfidence: z.number().min(0).max(1).default(0),
  ocrRawSummary: z.string().default(''),
});

export const ReceiptVerificationResultSchema = z.object({
  extraction: ReceiptExtractionSchema,
  checks: z.object({
    exactAmountMatch: z.boolean(),
    duplicateTransactionRef: z.boolean(),
    timestampAnomaly: z.boolean(),
    hasVisualTampering: z.boolean(),
  }),
  riskLevel: z.enum(['low', 'medium', 'high']),
  recommendedVerdict: z.enum(['approved', 'rejected', 'pending_review']),
  reasoningVi: z.array(z.string()),
  requiresHumanConfirmation: z.literal(true),
});

export type ReceiptExtraction = z.infer<typeof ReceiptExtractionSchema>;
export type ReceiptVerificationResult = z.infer<typeof ReceiptVerificationResultSchema>;

/**
 * Workflow 3: Natural-Language Operations Copilot
 * Structured tool-calling + operational response with embedded VietQR debt reminders.
 */
export const CopilotDebtReminderDraftSchema = z.object({
  orderCode: z.string().min(1),
  customerName: z.string().min(1),
  channelHandle: z.string().min(1),
  amountDueVnd: z.number().int().nonnegative(),
  messageVi: z.string().min(1),
  vietqrUrl: z.string().url(),
});

export const CopilotActionSchema = z.object({
  intent: z.enum([
    'daily_revenue_summary',
    'slow_moving_items',
    'draft_debt_reminders',
    'multi_tool_ops',
    'general_answer',
  ]),
  invokedTools: z
    .array(z.enum(['get_daily_revenue', 'get_slow_moving_items', 'get_unpaid_debts']))
    .default([]),
  summaryVi: z.string().min(1),
  highlightsVi: z.array(z.string()).default([]),
  slowMovingItems: z
    .array(
      z.object({
        sku: z.string(),
        name: z.string(),
        dailySoldCount: z.number().int().nonnegative(),
        suggestionVi: z.string(),
      })
    )
    .default([]),
  debtReminders: z.array(CopilotDebtReminderDraftSchema).default([]),
  requiresHumanApproval: z.boolean().default(true),
});

export type CopilotDebtReminderDraft = z.infer<typeof CopilotDebtReminderDraftSchema>;
export type CopilotAction = z.infer<typeof CopilotActionSchema>;
