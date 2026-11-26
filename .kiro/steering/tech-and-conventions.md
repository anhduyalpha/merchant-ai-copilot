# Merchant AI Copilot — Kiro Engineering & Competition Steering

## 1. Mission & Product Context
- **Competition:** MoMo Tech Contest 2026 (*Imagine the Future Workspace — Human Centered. AI Powered*).
- **Pillars:** **AI Assistant** (Multimodal POS Intake + Natural-Language Operations Copilot) + **Anti-Fraud** (4-Layer Transfer Receipt Verification with Human-in-the-Loop approval).
- **Primary Persona:** Vietnamese small F&B and retail merchants (coffee shops, eateries, local stores) taking orders at the counter and via Zalo/Facebook.

## 2. Core Architecture Rules
- **Framework:** Next.js App Router (`src/app`), React 19, TypeScript (`strict: true`), Tailwind CSS v4, Shadcn UI (Neutral base).
- **Database:** Supabase PostgreSQL (`supabase/schema.sql`) accessed in Route Handlers exclusively via `createSupabaseAdminClient()` (`src/lib/supabase/server.ts`).
- **Unified Multimodal AI Layer:** Always call `generateStructuredJSON<T>()` (`src/lib/ai/provider.ts`) with a Zod schema from `src/lib/ai/schemas.ts`. Never couple route handlers or UI components directly to `@google/genai` or `@aws-sdk/client-bedrock-runtime`.
- **Provider Portability:** Keep both `AI_PROVIDER=gemini` and `AI_PROVIDER=bedrock` (`ConverseCommand`) working interchangeably via `.env.local`.

## 3. AWS $20 Sandbox Hard Budget Guardrail (Valid Until Dec 11, 2026)
- **STRICTLY FORBIDDEN:** EC2, RDS, Aurora, NAT Gateway, Elastic IP, ECS/EKS, OpenSearch, SageMaker Hosted Endpoints, or Bedrock Provisioned Throughput.
- **PERMITTED ONLY:** Pay-per-use serverless invocations — Amazon Bedrock On-Demand (`ConverseCommand`) and Amazon S3 standard private bucket (`merchant-ai-copilot-td26-076`) with short-lived demo receipt uploads.

## 4. Vietnamese F&B Domain Conventions
- **Currency Representation:** Store and compute all monetary values as **non-negative integers in VND** (`price_vnd`, `total_vnd`, `amount_due_vnd`). Never use floating-point decimals for money. Display values exclusively via `formatVND()` (`src/lib/vietqr.ts`).
- **Vietnamese Slang Resolution:** Always pass `menu_items` (`sku`, `name`, `price_vnd`, `aliases`) into order-parsing prompts so abbreviations like `cf sữa`, `nâu đá`, `bx`, `tdcs`, `bmq`, `sc việt quất` map deterministically to canonical SKUs.
- **Split Payment & Customer Tabs:** Support mixed tenders (`payment_method = 'split'` with `cash_amount_vnd` + `transfer_amount_vnd`) and regular-customer tabs (`payment_method = 'debt'` creating a `customer_debts` record).
- **Dynamic VietQR:** Generate QR image URLs exclusively with `buildVietQRUrl({ amount, addInfo })` (`compact2.png` on `img.vietqr.io`) using `transfer_amount_vnd` (for split orders) or `total_vnd` (for full VietQR orders) and `order_code` as `addInfo`.

## 5. Anti-Fraud & Human-in-the-Loop Invariants
Every receipt verification (`POST /api/receipts/verify`) must execute all **4 checks** before presenting a verdict:
1. **Exact Amount Match:** `extracted_amount_vnd === expected_amount_vnd`.
2. **Duplicate Transaction Reference Check:** Query `payment_receipts` indexed on `transaction_ref` (e.g., seeded `FT26330998811` on `DH1001`) to block replay attacks.
3. **Timestamp Anomaly Check:** Flag stale receipts older than the order creation time or implausibly skewed timestamps.
4. **Visual Tampering Signals:** Surface font baseline shifts, kerning anomalies, or localized JPEG recompression artifacts from multimodal vision analysis.
- **Human Centered Rule:** AI recommends `approved | rejected | pending_review` with transparent Vietnamese reasoning, but finalizing high-risk or disputed orders always requires explicit **1-click merchant confirmation**.

## 6. Security & MoMo Tech Contest Compliance (Điều 12, 28, 29, 31)
- **Zero Real PII / Banking Data:** Commit and seed **100% synthetic data only** (`QUAN CA PHE DEMO`, `0123456789`, fictional names/handles). Never upload real personal bank statements, CCCD, phone numbers, or customer receipts.
- **Secret Hygiene:** Never expose `SUPABASE_SERVICE_ROLE_KEY`, `AWS_SECRET_ACCESS_KEY`, `GEMINI_API_KEY`, or sandbox passwords in client components (`'use client'`), `NEXT_PUBLIC_*` vars, Git commits, or markdown docs.
- **Judge Zero-Friction UX:** Keep Judge Quick-Demo presets (`src/lib/demo-presets.ts`) and `POST /api/demo/reset` working without login walls through Demo Day (**Dec 11, 2026**), and freeze production deployments prior to the submission deadline (**23:59:59 Dec 3, 2026**, per Điều 10.5 & Điều 31.4).

## 7. Git Rollback & Secret-Filtered Commit Protocol
- **Commit per Verified Milestone:** After completing and verifying each feature slice or configuration step, create a clean local Git commit using Conventional Commits (`feat`, `fix`, `refactor`, `chore`, `docs`) so rollback (`git revert` / `git reset`) stays simple and granular.
- **Mandatory Secret & Hygiene Audit Before Every Commit:**
  1. Inspect `git status --porcelain` and verify zero `.env`, `.env.*` (except `.env.example`), `*.pem`, `*.key`, `.tmp/`, or build artifacts (`node_modules/`, `.next/`) are staged.
  2. Scan `git diff --cached` against secret patterns (`sb_secret_`, `sb_publishable_`, `AQ.`, `sk-`, `AIza`, `AKIA`, `PRIVATE KEY`, sandbox credentials/account IDs) and abort immediately if any match appears.
  3. Stage explicitly vetted file paths instead of blind `git add -A`.
