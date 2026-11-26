# Merchant AI Copilot

> **MoMo Tech Contest 2026 Entry** — *Imagine the Future Workspace: Human Centered. AI Powered*  
> Combining **Multimodal AI Assistant** & **4-Layer Payment Receipt Anti-Fraud** for Vietnamese F&B & Retail Micro-Merchants.

---

## 1. Overview

Small Vietnamese coffee shops, eateries, and neighborhood stores handle hundreds of daily orders across counter dictation, Zalo, and Facebook Messenger. During peak hours, merchants face three costly operational bottlenecks:
1. **Fragmented Order Intake:** Slang-heavy chat messages (*"2 bx ít ngọt, 1 cf sữa, tách trà đào tính tiền mặt"*), handwritten slips, and noisy counter dictation lead to missed modifiers and manual calculation errors.
2. **Fake Transfer Receipt Scams:** Fraudsters present edited banking screenshots (e.g., altering `6,400 VND` into `64,000 VND`) or replay old valid receipts during rush hour before staff can check bank notifications.
3. **End-of-Day Reconciliation & Debt Tracking:** Cash/transfer splits and regular-customer tabs (*ghi sổ khách quen*) are tracked on paper, causing revenue leakage and awkward manual payment reminders.

**Merchant AI Copilot** reimagines the micro-merchant's counter as an AI-powered, human-centered workspace:
- **Multimodal Order Intake + Dynamic VietQR:** Parses Vietnamese slang chats, handwritten order photos, and voice transcripts into structured SKU line items, calculates discounts/split tenders, and generates an exact-amount dynamic **VietQR** code (`img.vietqr.io`).
- **4-Layer Receipt Verification & Anti-Fraud (Human-in-the-Loop):** Extracts transfer metadata from receipt images and cross-checks exact VND amount, duplicate `transaction_ref` history in PostgreSQL, timestamp anomalies, and visual tampering artifacts — surfacing a transparent risk verdict for **1-click merchant approval**.
- **Natural-Language Operations Copilot:** Queries live store data to summarize daily revenue, highlight slow-moving menu items, and draft polite Vietnamese debt-reminder messages with embedded VietQR payment links.
- **Judge Quick-Demo Mode (<60s, Zero Login):** Built-in Vietnamese slang presets, fraud test scenarios (Valid, Tampered Amount, Reused `FT26330998811`), and a 1-click `POST /api/demo/reset` endpoint so judges can evaluate every workflow immediately.

---

## 2. Tech Stack

- **Frontend & API Runtime:** Next.js 16 (App Router, Route Handlers), React 19, TypeScript 5 (`strict` mode)
- **UI System:** Tailwind CSS v4, Shadcn UI (Neutral palette), Lucide Icons
- **Database:** Supabase PostgreSQL (`@supabase/supabase-js`) with GIN alias indexing & `transaction_ref` anti-fraud indexing
- **Multimodal AI Layer (`src/lib/ai/provider.ts`):**
  - **Google Gemini (`@google/genai`):** `gemini-2.5-flash` structured JSON + vision extraction
  - **AWS Bedrock (`@aws-sdk/client-bedrock-runtime`):** `ConverseCommand` multimodal adapter (Amazon Nova Lite / Claude Haiku/Sonnet, strictly pay-per-use serverless)
- **Schema Validation:** Zod v4 (`src/lib/ai/schemas.ts`)
- **Payment QR Standard:** Dynamic VietQR URL builder (`img.vietqr.io` `compact2.png`)

---

## 3. Setup & Run Instructions

### Prerequisites
- Node.js `>= 20.x` and `pnpm` (`>= 10.x`)
- A Supabase project (Free tier)
- Either a Google Gemini API Key (`GEMINI_API_KEY`) or AWS Bedrock programmatic credentials (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`)

### Step-by-Step Local Setup

1. **Install dependencies:**
   ```bash
   cd merchant-ai-copilot
   pnpm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and your active AI provider credentials (`GEMINI_API_KEY` or AWS Bedrock keys) in `.env.local`.

3. **Initialize Supabase schema & synthetic seed data:**
   Open your Supabase Dashboard → **SQL Editor**, paste the contents of [`supabase/schema.sql`](./supabase/schema.sql), and click **Run**.

4. **Start the development server:**
   ```bash
   pnpm dev
   ```
   - Application: `http://localhost:3000`
   - Health & Diagnostics API: `GET http://localhost:3000/api/health`
   - Reset Synthetic Demo Data API: `POST http://localhost:3000/api/demo/reset`

5. **Type-check & Production Build:**
   ```bash
   pnpm exec tsc --noEmit
   pnpm build
   ```

---

## 4. Environment Variables Reference

| Variable | Scope | Required | Description |
| :--- | :---: | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Yes | Supabase project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Yes | Supabase anonymous public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-Only** | Yes | Supabase service role key used exclusively in `src/lib/supabase/server.ts` |
| `AI_PROVIDER` | Server-Only | Yes | Active multimodal model provider: `gemini` or `bedrock` |
| `GEMINI_API_KEY` | **Server-Only** | When `AI_PROVIDER=gemini` | Google AI Studio API key for `@google/genai` |
| `GEMINI_MODEL_ID` | Server-Only | Optional | Defaults to `gemini-2.5-flash` |
| `AWS_REGION` | Server-Only | When `AI_PROVIDER=bedrock` | AWS region (default `ap-southeast-1`) |
| `AWS_ACCESS_KEY_ID` | **Server-Only** | When `AI_PROVIDER=bedrock` | IAM programmatic access key ID |
| `AWS_SECRET_ACCESS_KEY` | **Server-Only** | When `AI_PROVIDER=bedrock` | IAM programmatic secret access key |
| `BEDROCK_MODEL_ID` | Server-Only | Optional | Bedrock model / inference profile ID (default `apac.amazon.nova-lite-v1:0`) |
| `AWS_S3_BUCKET` | Server-Only | Optional | Private S3 bucket name for temporary receipt uploads |
| `NEXT_PUBLIC_VIETQR_BANK_ID` | Public | Optional | Synthetic demo bank code (default `MB`) |
| `NEXT_PUBLIC_VIETQR_ACCOUNT_NO` | Public | Optional | Synthetic demo account number (default `0123456789`) |
| `NEXT_PUBLIC_VIETQR_ACCOUNT_NAME` | Public | Optional | Synthetic demo merchant name (default `QUAN CA PHE DEMO`) |

---

## 5. Pre-existing Assets & Open-Source Libraries Declaration
*(Khai báo Tài sản có sẵn & Mã nguồn mở theo Điều 12.5, Điều 28.1 & Điều 28.3 Thể lệ MoMo Tech Contest)*

No proprietary pre-competition product code was reused. All application business logic, database schemas, prompts, anti-fraud verification rules, and UI workflows were built specifically during the MoMo Tech Contest 2026 competition window.

Open-source packages and public standards used under their respective permissive licenses:
- **Next.js & React** (`next`, `react`, `react-dom`) — MIT License
- **Tailwind CSS & Shadcn UI / Radix Primitives** (`tailwindcss`, `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `sonner`, `lucide-react`) — MIT / ISC Licenses
- **Supabase JS SDK** (`@supabase/supabase-js`) — MIT License
- **Google Gen AI SDK** (`@google/genai`) — Apache-2.0 License
- **AWS SDK for JavaScript v3** (`@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-s3`) — Apache-2.0 License
- **Zod Schema Validation** (`zod`) — MIT License
- **VietQR Image Link Utility** (`https://img.vietqr.io`) — Public QR rendering endpoint configured strictly with fictional demo parameters

---

## 6. AI Tools & Models Declaration
*(Khai báo Công cụ & Mô hình AI sử dụng theo Điều 28.4 Thể lệ MoMo Tech Contest)*

1. **Runtime AI Models in Product:**
   - **Google Gemini (`gemini-2.5-flash` via `@google/genai`):** Multimodal order parsing, receipt OCR/visual tampering inspection, and natural-language operations copilot responses.
   - **Amazon Bedrock (`ConverseCommand` via `@aws-sdk/client-bedrock-runtime`):** Cloud-portable multimodal provider supporting Amazon Nova Lite (`apac.amazon.nova-lite-v1:0`) and Anthropic Claude models under serverless pay-per-use billing.
2. **Development & Engineering Assistance:**
   - AI-assisted coding and architectural scaffolding tools (Antigravity / Kiro steering specs) were used by the team during development; all generated code, schemas, and security rules were reviewed, type-checked, and verified by the team.

---

## 7. Synthetic Data & Privacy Compliance Note
*(Tuân thủ Bảo vệ Dữ liệu Cá nhân & Dữ liệu Giả lập theo Điều 12.4 & Điều 29 Thể lệ MoMo Tech Contest)*

- **100% Synthetic Dataset:** Every menu item, order (`DH1001`–`DH1003`), bank reference (`FT26330998811`), merchant account (`MB - 0123456789 - QUAN CA PHE DEMO`), and customer profile (`Anh Minh Thiết Kế (Demo)`, `Chị Lan Tiệm Hoa (Demo)`) in this repository is **entirely fictional and computer-generated** for demonstration purposes.
- **Zero Real PII:** No real personal data, citizen IDs, phone numbers, real bank account numbers, or genuine customer banking receipts are stored, processed, or committed in this repository.
