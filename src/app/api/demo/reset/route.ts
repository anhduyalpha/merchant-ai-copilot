import { NextResponse } from 'next/server';
import { buildSyntheticSeedDataset } from '@/lib/demo-presets';
import { invalidateStoreCache, setCachedMenuItems } from '@/lib/store-cache';
import { createSupabaseAdminClient, getSupabaseEnvStatus } from '@/lib/supabase/server';
import type { MenuItemRow } from '@/types/database';

const MAX_BODY_BYTES = 4096;

interface SeedCounts {
  menuItems: number;
  orders: number;
  orderItems: number;
  paymentReceipts: number;
  customerDebts: number;
}

interface ResetResult {
  ok: boolean;
  status: number;
  code: string;
  message: string;
  seededCounts: SeedCounts;
  resetAt: string;
}

let activeResetPromise: Promise<ResetResult> | null = null;

async function executeAtomicDemoReset(): Promise<ResetResult> {
  const dataset = buildSyntheticSeedDataset();
  const seededCounts: SeedCounts = {
    menuItems: dataset.menuItems.length,
    orders: dataset.orders.length,
    orderItems: dataset.orderItems.length,
    paymentReceipts: dataset.paymentReceipts.length,
    customerDebts: dataset.customerDebts.length,
  };

  if (!getSupabaseEnvStatus().configured) {
    return {
      ok: false,
      status: 503,
      code: 'SUPABASE_NOT_CONFIGURED',
      message:
        'Supabase admin credentials are not configured yet. Populate NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local and run supabase/schema.sql.',
      seededCounts,
      resetAt: new Date().toISOString(),
    };
  }

  const supabase = createSupabaseAdminClient();

  // Delete in foreign-key-safe order before re-inserting deterministic synthetic seed data
  const tablesInDeleteOrder = [
    'payment_receipts',
    'customer_debts',
    'order_items',
    'orders',
    'menu_items',
  ] as const;

  for (const table of tablesInDeleteOrder) {
    const { error } = await supabase.from(table).delete().not('id', 'is', null);
    if (error) {
      return {
        ok: false,
        status: 500,
        code: 'DB_CLEAR_FAILED',
        message: `Failed clearing table "${table}": ${error.message}`,
        seededCounts,
        resetAt: new Date().toISOString(),
      };
    }
  }

  const { data: insertedMenu, error: menuError } = await supabase
    .from('menu_items')
    .insert(dataset.menuItems)
    .select('*');
  if (menuError) {
    return {
      ok: false,
      status: 500,
      code: 'SEED_MENU_FAILED',
      message: `Failed seeding menu_items: ${menuError.message}`,
      seededCounts,
      resetAt: new Date().toISOString(),
    };
  }
  invalidateStoreCache(1000);
  if (insertedMenu) {
    setCachedMenuItems(insertedMenu as MenuItemRow[]);
  }

  if (dataset.orders.length > 0) {
    const { error: ordersError } = await supabase.from('orders').insert(dataset.orders);
    if (ordersError) {
      return {
        ok: false,
        status: 500,
        code: 'SEED_ORDERS_FAILED',
        message: `Failed seeding orders: ${ordersError.message}`,
        seededCounts,
        resetAt: new Date().toISOString(),
      };
    }
  }

  if (dataset.orderItems.length > 0) {
    const { error: itemsError } = await supabase.from('order_items').insert(dataset.orderItems);
    if (itemsError) {
      return {
        ok: false,
        status: 500,
        code: 'SEED_ORDER_ITEMS_FAILED',
        message: `Failed seeding order_items: ${itemsError.message}`,
        seededCounts,
        resetAt: new Date().toISOString(),
      };
    }
  }

  if (dataset.paymentReceipts.length > 0) {
    const { error: receiptsError } = await supabase
      .from('payment_receipts')
      .insert(dataset.paymentReceipts);
    if (receiptsError) {
      return {
        ok: false,
        status: 500,
        code: 'SEED_RECEIPTS_FAILED',
        message: `Failed seeding payment_receipts: ${receiptsError.message}`,
        seededCounts,
        resetAt: new Date().toISOString(),
      };
    }
  }

  if (dataset.customerDebts.length > 0) {
    const { error: debtsError } = await supabase
      .from('customer_debts')
      .insert(dataset.customerDebts);
    if (debtsError) {
      return {
        ok: false,
        status: 500,
        code: 'SEED_DEBTS_FAILED',
        message: `Failed seeding customer_debts: ${debtsError.message}`,
        seededCounts,
        resetAt: new Date().toISOString(),
      };
    }
  }

  return {
    ok: true,
    status: 200,
    code: 'DEMO_RESET_COMPLETED',
    message: 'Cleared transactional data and initialized clean menu catalog.',
    seededCounts,
    resetAt: new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
      },
      { status: 413 }
    );
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        code: 'PAYLOAD_TOO_LARGE',
        message: `Request body exceeds ${MAX_BODY_BYTES} bytes.`,
      },
      { status: 413 }
    );
  }

  let dryRun = false;
  const trimmedBody = rawBody.trim();
  if (trimmedBody.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedBody);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: 'INVALID_JSON_BODY',
          message: 'Request body must be empty or a valid JSON object.',
        },
        { status: 400 }
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'INVALID_BODY_SHAPE',
          message: 'Request body must be a JSON object (e.g. {} or {"dryRun": true}).',
        },
        { status: 400 }
      );
    }

    const record = parsed as Record<string, unknown>;
    if ('dryRun' in record) {
      if (typeof record.dryRun !== 'boolean') {
        return NextResponse.json(
          {
            ok: false,
            code: 'INVALID_FIELD_TYPE',
            message: 'Field "dryRun" must be a boolean.',
          },
          { status: 400 }
        );
      }
      dryRun = record.dryRun;
    }
  }

  if (dryRun) {
    const dataset = buildSyntheticSeedDataset();
    return NextResponse.json(
      {
        ok: true,
        code: 'DRY_RUN_OK',
        message: 'Validated synthetic demo dataset without mutating database.',
        seededCounts: {
          menuItems: dataset.menuItems.length,
          orders: dataset.orders.length,
          orderItems: dataset.orderItems.length,
          paymentReceipts: dataset.paymentReceipts.length,
          customerDebts: dataset.customerDebts.length,
        },
        resetAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  const coalesced = activeResetPromise !== null;
  if (!activeResetPromise) {
    activeResetPromise = executeAtomicDemoReset().finally(() => {
      activeResetPromise = null;
    });
  }

  const outcome = await activeResetPromise;
  return NextResponse.json(
    {
      ok: outcome.ok,
      code: outcome.code,
      message: outcome.message,
      seededCounts: outcome.seededCounts,
      coalescedConcurrentRequest: coalesced,
      resetAt: outcome.resetAt,
    },
    { status: outcome.status }
  );
}
