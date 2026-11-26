export type MenuCategory = 'coffee' | 'tea' | 'milk_tea' | 'pastry' | 'snack';

export type OrderSourceType = 'chat' | 'handwritten' | 'voice' | 'manual';
export type PaymentMethod = 'vietqr' | 'cash' | 'split' | 'debt';
export type OrderStatus = 'pending_payment' | 'paid' | 'debt' | 'cancelled';
export type PaymentSplitTag = 'cash' | 'transfer' | 'shared';

export type RiskLevel = 'low' | 'medium' | 'high';
export type ReceiptVerdict = 'approved' | 'rejected' | 'pending_review';
export type DebtStatus = 'unpaid' | 'reminded' | 'settled';

export type MenuItemRow = {
  id: string;
  sku: string;
  name: string;
  category: MenuCategory;
  price_vnd: number;
  aliases: string[];
  is_available: boolean;
  daily_sold_count: number;
  created_at: string;
};

export type OrderRow = {
  id: string;
  order_code: string;
  table_or_channel: string;
  customer_name: string | null;
  source_type: OrderSourceType;
  raw_input: string | null;
  subtotal_vnd: number;
  discount_vnd: number;
  total_vnd: number;
  cash_amount_vnd: number;
  transfer_amount_vnd: number;
  payment_method: PaymentMethod;
  status: OrderStatus;
  vietqr_url: string | null;
  notes: string | null;
  created_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  menu_item_id: string | null;
  item_name: string;
  quantity: number;
  unit_price_vnd: number;
  modifiers: string[];
  payment_split_tag: PaymentSplitTag;
  line_total_vnd: number;
  created_at: string;
};

export type PaymentReceiptRow = {
  id: string;
  order_id: string | null;
  transaction_ref: string;
  bank_name: string;
  extracted_amount_vnd: number;
  expected_amount_vnd: number;
  receipt_timestamp: string | null;
  transfer_note: string | null;
  image_url: string | null;
  amount_match: boolean;
  is_duplicate_ref: boolean;
  timestamp_anomaly: boolean;
  visual_tampering_flags: string[];
  risk_level: RiskLevel;
  verdict: ReceiptVerdict;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type CustomerDebtRow = {
  id: string;
  order_id: string | null;
  order_code: string;
  customer_name: string;
  customer_alias: string | null;
  channel_handle: string;
  amount_due_vnd: number;
  due_date: string | null;
  status: DebtStatus;
  last_reminded_at: string | null;
  vietqr_url: string | null;
  notes: string | null;
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      menu_items: {
        Row: MenuItemRow;
        Insert: {
          id?: string;
          sku: string;
          name: string;
          category: MenuCategory;
          price_vnd: number;
          aliases?: string[];
          is_available?: boolean;
          daily_sold_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          sku?: string;
          name?: string;
          category?: MenuCategory;
          price_vnd?: number;
          aliases?: string[];
          is_available?: boolean;
          daily_sold_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      orders: {
        Row: OrderRow;
        Insert: {
          id?: string;
          order_code: string;
          table_or_channel?: string;
          customer_name?: string | null;
          source_type?: OrderSourceType;
          raw_input?: string | null;
          subtotal_vnd: number;
          discount_vnd?: number;
          total_vnd: number;
          cash_amount_vnd?: number;
          transfer_amount_vnd?: number;
          payment_method: PaymentMethod;
          status?: OrderStatus;
          vietqr_url?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_code?: string;
          table_or_channel?: string;
          customer_name?: string | null;
          source_type?: OrderSourceType;
          raw_input?: string | null;
          subtotal_vnd?: number;
          discount_vnd?: number;
          total_vnd?: number;
          cash_amount_vnd?: number;
          transfer_amount_vnd?: number;
          payment_method?: PaymentMethod;
          status?: OrderStatus;
          vietqr_url?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      order_items: {
        Row: OrderItemRow;
        Insert: {
          id?: string;
          order_id: string;
          menu_item_id?: string | null;
          item_name: string;
          quantity: number;
          unit_price_vnd: number;
          modifiers?: string[];
          payment_split_tag?: PaymentSplitTag;
          line_total_vnd: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string;
          menu_item_id?: string | null;
          item_name?: string;
          quantity?: number;
          unit_price_vnd?: number;
          modifiers?: string[];
          payment_split_tag?: PaymentSplitTag;
          line_total_vnd?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      payment_receipts: {
        Row: PaymentReceiptRow;
        Insert: {
          id?: string;
          order_id?: string | null;
          transaction_ref: string;
          bank_name: string;
          extracted_amount_vnd: number;
          expected_amount_vnd: number;
          receipt_timestamp?: string | null;
          transfer_note?: string | null;
          image_url?: string | null;
          amount_match?: boolean;
          is_duplicate_ref?: boolean;
          timestamp_anomaly?: boolean;
          visual_tampering_flags?: string[];
          risk_level: RiskLevel;
          verdict?: ReceiptVerdict;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string | null;
          transaction_ref?: string;
          bank_name?: string;
          extracted_amount_vnd?: number;
          expected_amount_vnd?: number;
          receipt_timestamp?: string | null;
          transfer_note?: string | null;
          image_url?: string | null;
          amount_match?: boolean;
          is_duplicate_ref?: boolean;
          timestamp_anomaly?: boolean;
          visual_tampering_flags?: string[];
          risk_level?: RiskLevel;
          verdict?: ReceiptVerdict;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      customer_debts: {
        Row: CustomerDebtRow;
        Insert: {
          id?: string;
          order_id?: string | null;
          order_code: string;
          customer_name: string;
          customer_alias?: string | null;
          channel_handle: string;
          amount_due_vnd: number;
          due_date?: string | null;
          status?: DebtStatus;
          last_reminded_at?: string | null;
          vietqr_url?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          order_id?: string | null;
          order_code?: string;
          customer_name?: string;
          customer_alias?: string | null;
          channel_handle?: string;
          amount_due_vnd?: number;
          due_date?: string | null;
          status?: DebtStatus;
          last_reminded_at?: string | null;
          vietqr_url?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
