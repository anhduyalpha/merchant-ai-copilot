-- Merchant AI Copilot - MoMo Tech Contest 2026
-- Strictly synthetic Vietnamese F&B merchant dataset (Zero real PII / bank accounts)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing tables safely for clean re-runs in SQL Editor
DROP TABLE IF EXISTS payment_receipts CASCADE;
DROP TABLE IF EXISTS customer_debts CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;

-- 1. Menu Items (with Vietnamese slang aliases array)
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('coffee', 'tea', 'milk_tea', 'pastry', 'snack')),
  price_vnd INTEGER NOT NULL CHECK (price_vnd >= 0),
  aliases TEXT[] NOT NULL DEFAULT '{}',
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  daily_sold_count INTEGER NOT NULL DEFAULT 0 CHECK (daily_sold_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_menu_items_aliases ON menu_items USING GIN (aliases);

-- 2. Orders
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code TEXT NOT NULL UNIQUE,
  table_or_channel TEXT NOT NULL DEFAULT 'Tại quầy',
  customer_name TEXT,
  source_type TEXT NOT NULL DEFAULT 'chat' CHECK (source_type IN ('chat', 'handwritten', 'voice', 'manual')),
  raw_input TEXT,
  subtotal_vnd INTEGER NOT NULL CHECK (subtotal_vnd >= 0),
  discount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (discount_vnd >= 0),
  total_vnd INTEGER NOT NULL CHECK (total_vnd >= 0),
  cash_amount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (cash_amount_vnd >= 0),
  transfer_amount_vnd INTEGER NOT NULL DEFAULT 0 CHECK (transfer_amount_vnd >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('vietqr', 'cash', 'split', 'debt')),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'paid', 'debt', 'cancelled')),
  vietqr_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);

-- 3. Order Items
CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_vnd INTEGER NOT NULL CHECK (unit_price_vnd >= 0),
  modifiers TEXT[] NOT NULL DEFAULT '{}',
  payment_split_tag TEXT NOT NULL DEFAULT 'shared' CHECK (payment_split_tag IN ('cash', 'transfer', 'shared')),
  line_total_vnd INTEGER NOT NULL CHECK (line_total_vnd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);

-- 4. Payment Receipts (4-Layer Anti-Fraud Verification)
CREATE TABLE payment_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  transaction_ref TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  extracted_amount_vnd INTEGER NOT NULL CHECK (extracted_amount_vnd >= 0),
  expected_amount_vnd INTEGER NOT NULL CHECK (expected_amount_vnd >= 0),
  receipt_timestamp TIMESTAMPTZ,
  transfer_note TEXT,
  image_url TEXT,
  amount_match BOOLEAN NOT NULL DEFAULT FALSE,
  is_duplicate_ref BOOLEAN NOT NULL DEFAULT FALSE,
  timestamp_anomaly BOOLEAN NOT NULL DEFAULT FALSE,
  visual_tampering_flags TEXT[] NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  verdict TEXT NOT NULL DEFAULT 'pending_review' CHECK (verdict IN ('approved', 'rejected', 'pending_review')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Critical Anti-Fraud Index: fast lookup for replayed / duplicate transaction_ref IDs
CREATE INDEX idx_payment_receipts_transaction_ref ON payment_receipts (transaction_ref);

-- 5. Customer Debts (Regular-Customer Tab & VietQR Reminder Tracking)
CREATE TABLE customer_debts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  order_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_alias TEXT,
  channel_handle TEXT NOT NULL,
  amount_due_vnd INTEGER NOT NULL CHECK (amount_due_vnd >= 0),
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'reminded', 'settled')),
  last_reminded_at TIMESTAMPTZ,
  vietqr_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_debts_status ON customer_debts (status);

-- ============================================================================
-- SYNTHETIC SEED DATA (Vietnamese Coffee Shop Demo)
-- ============================================================================

-- 8 Menu Items with Vietnamese slang aliases
INSERT INTO menu_items (id, sku, name, category, price_vnd, aliases, is_available, daily_sold_count) VALUES
  ('11111111-1111-4111-8111-111111111101', 'CF-SUA', 'Cà phê sữa đá', 'coffee', 29000, ARRAY['cf sữa', 'cf sua', 'cà phê sữa', 'nâu đá', 'nau da', 'cafe sua da'], TRUE, 34),
  ('11111111-1111-4111-8111-111111111102', 'CF-DEN', 'Cà phê đen đá', 'coffee', 25000, ARRAY['cf đen', 'cf den', 'đen đá', 'den da', 'cafe den'], TRUE, 22),
  ('11111111-1111-4111-8111-111111111103', 'BAC-XIU', 'Bạc xỉu đá', 'coffee', 32000, ARRAY['bx', 'bạc xỉu', 'bac xiu', 'bạc sỉu', 'cf nhiều sữa'], TRUE, 28),
  ('11111111-1111-4111-8111-111111111104', 'TRA-DAO', 'Trà đào cam sả', 'tea', 35000, ARRAY['trà đào', 'tra dao', 'tdcs', 'đào cam sả', 'tra dao cam sa'], TRUE, 19),
  ('11111111-1111-4111-8111-111111111105', 'TRA-VAI', 'Trà vải hoa hồng', 'tea', 35000, ARRAY['trà vải', 'tra vai', 'vải hồng', 'tra vai hoa hong'], TRUE, 3),
  ('11111111-1111-4111-8111-111111111106', 'MATCHA-LATTE', 'Matcha Latte kem muối', 'milk_tea', 42000, ARRAY['matcha', 'trà xanh sữa', 'matcha kem muối', 'matcha latte'], TRUE, 14),
  ('11111111-1111-4111-8111-111111111107', 'SC-VIET-QUAT', 'Sữa chua việt quất đá xay', 'milk_tea', 39000, ARRAY['sc việt quất', 'sữa chua vq', 'sua chua viet quat'], TRUE, 1),
  ('11111111-1111-4111-8111-111111111108', 'BANH-MI-QUE', 'Bánh mì que pate Hải Phòng', 'pastry', 18000, ARRAY['bmq', 'bánh mì que', 'banh mi que', 'pate que'], TRUE, 11);

-- 3 Synthetic Orders:
-- DH1001: Paid 64,000 VND (1x Cà phê sữa đá 29k + 1x Trà đào cam sả 35k)
-- DH1002: Unpaid regular-customer debt 96,000 VND (3x Bạc xỉu đá 32k)
-- DH1003: Unpaid regular-customer debt 77,000 VND (1x Matcha Latte 42k + 1x Trà đào cam sả 35k)
INSERT INTO orders (
  id, order_code, table_or_channel, customer_name, source_type, raw_input,
  subtotal_vnd, discount_vnd, total_vnd, cash_amount_vnd, transfer_amount_vnd,
  payment_method, status, vietqr_url, notes
) VALUES
  (
    '22222222-2222-4222-8222-222222222201',
    'DH1001',
    'Bàn 1',
    'Khách lẻ Bàn 1 (Demo)',
    'chat',
    'Cho bàn 1 1 cf sữa ít đá với 1 trà đào nha shop',
    64000,
    0,
    64000,
    0,
    64000,
    'vietqr',
    'paid',
    'https://img.vietqr.io/image/MB-0123456789-compact2.png?amount=64000&addInfo=DH1001&accountName=QUAN%20CA%20PHE%20DEMO',
    'Đã đối soát biên lai hợp lệ FT26330998811'
  ),
  (
    '22222222-2222-4222-8222-222222222202',
    'DH1002',
    'Zalo OA',
    'Anh Minh Thiết Kế (Demo)',
    'chat',
    'Em ơi ship sang studio cho anh 3 bx ít ngọt nhé, cuối chiều anh ck gộp luôn',
    96000,
    0,
    96000,
    0,
    0,
    'debt',
    'debt',
    'https://img.vietqr.io/image/MB-0123456789-compact2.png?amount=96000&addInfo=DH1002&accountName=QUAN%20CA%20PHE%20DEMO',
    'Khách quen studio cạnh quán ghi sổ cuối ngày'
  ),
  (
    '22222222-2222-4222-8222-222222222203',
    'DH1003',
    'Facebook Messenger',
    'Chị Lan Tiệm Hoa (Demo)',
    'chat',
    'Cho chị 1 matcha kem muối với 1 trà đào qua tiệm hoa nhé, ghi sổ giúp chị nha',
    77000,
    0,
    77000,
    0,
    0,
    'debt',
    'debt',
    'https://img.vietqr.io/image/MB-0123456789-compact2.png?amount=77000&addInfo=DH1003&accountName=QUAN%20CA%20PHE%20DEMO',
    'Khách quen tiệm hoa đầu hẻm'
  );

-- Order Items for DH1001, DH1002, DH1003
INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price_vnd, modifiers, payment_split_tag, line_total_vnd) VALUES
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111101', 'Cà phê sữa đá', 1, 29000, ARRAY['ít đá'], 'transfer', 29000),
  ('22222222-2222-4222-8222-222222222201', '11111111-1111-4111-8111-111111111104', 'Trà đào cam sả', 1, 35000, ARRAY[]::TEXT[], 'transfer', 35000),
  ('22222222-2222-4222-8222-222222222202', '11111111-1111-4111-8111-111111111103', 'Bạc xỉu đá', 3, 32000, ARRAY['ít ngọt'], 'shared', 96000),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111106', 'Matcha Latte kem muối', 1, 42000, ARRAY[]::TEXT[], 'shared', 42000),
  ('22222222-2222-4222-8222-222222222203', '11111111-1111-4111-8111-111111111104', 'Trà đào cam sả', 1, 35000, ARRAY[]::TEXT[], 'shared', 35000);

-- 1 Approved Payment Receipt on DH1001 (FT26330998811 - anchors duplicate-receipt anti-fraud check)
INSERT INTO payment_receipts (
  id, order_id, transaction_ref, bank_name, extracted_amount_vnd, expected_amount_vnd,
  receipt_timestamp, transfer_note, image_url, amount_match, is_duplicate_ref,
  timestamp_anomaly, visual_tampering_flags, risk_level, verdict, reviewed_by, reviewed_at
) VALUES (
  '33333333-3333-4333-8333-333333333301',
  '22222222-2222-4222-8222-222222222201',
  'FT26330998811',
  'MB Bank (Synthetic Demo)',
  64000,
  64000,
  NOW() - INTERVAL '2 hours',
  'DH1001',
  '/demo-assets/receipt-dh1001-valid.png',
  TRUE,
  FALSE,
  FALSE,
  ARRAY[]::TEXT[],
  'low',
  'approved',
  'Chủ quán (Demo)',
  NOW() - INTERVAL '119 minutes'
);

-- 2 Unpaid Regular-Customer Debt Records (DH1002, DH1003)
INSERT INTO customer_debts (
  id, order_id, order_code, customer_name, customer_alias, channel_handle,
  amount_due_vnd, due_date, status, vietqr_url, notes
) VALUES
  (
    '44444444-4444-4444-8444-444444444401',
    '22222222-2222-4222-8222-222222222202',
    'DH1002',
    'Anh Minh Thiết Kế (Demo)',
    'Anh Minh Studio',
    'Zalo: 0900-000-102 (Synthetic)',
    96000,
    CURRENT_DATE,
    'unpaid',
    'https://img.vietqr.io/image/MB-0123456789-compact2.png?amount=96000&addInfo=DH1002&accountName=QUAN%20CA%20PHE%20DEMO',
    '3 Bạc xỉu đá ít ngọt buổi chiều'
  ),
  (
    '44444444-4444-4444-8444-444444444402',
    '22222222-2222-4222-8222-222222222203',
    'DH1003',
    'Chị Lan Tiệm Hoa (Demo)',
    'Chị Lan Hoa Tươi',
    'Messenger: @lan.tiemhoa.demo',
    77000,
    CURRENT_DATE,
    'unpaid',
    'https://img.vietqr.io/image/MB-0123456789-compact2.png?amount=77000&addInfo=DH1003&accountName=QUAN%20CA%20PHE%20DEMO',
    '1 Matcha Latte kem muối + 1 Trà đào cam sả'
  );

-- Ensure server-side service_role has full privileges on all application tables
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON TABLE menu_items, orders, order_items, payment_receipts, customer_debts TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
