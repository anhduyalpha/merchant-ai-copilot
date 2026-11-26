import { connection, NextResponse } from 'next/server';
import { getAIProviderStatus } from '@/lib/ai/provider';
import { createSupabaseAdminClient, getSupabaseEnvStatus } from '@/lib/supabase/server';

export async function GET() {
  await connection();
  const ai = getAIProviderStatus();
  const supabaseEnv = getSupabaseEnvStatus();

  let supabaseConnected = false;
  let menuItemCount: number | null = null;
  let latencyMs: number | null = null;
  let supabaseMessage = 'Supabase credentials are still set to placeholders in .env.local.';

  if (supabaseEnv.configured) {
    const startedAt = Date.now();
    try {
      const supabase = createSupabaseAdminClient();
      const { count, error } = await supabase
        .from('menu_items')
        .select('id', { count: 'exact', head: true });

      latencyMs = Date.now() - startedAt;
      if (error) {
        supabaseConnected = false;
        supabaseMessage = `Database query error (${error.code ?? 'UNKNOWN'}): run supabase/schema.sql first.`;
      } else {
        supabaseConnected = true;
        menuItemCount = count ?? 0;
        supabaseMessage = 'Connected to Supabase PostgreSQL.';
      }
    } catch {
      latencyMs = Date.now() - startedAt;
      supabaseConnected = false;
      supabaseMessage = 'Unable to reach Supabase instance.';
    }
  }

  const activeAiReady =
    ai.activeProvider === 'bedrock'
      ? ai.bedrockConfigured
      : ai.activeProvider === 'agnes'
        ? ai.agnesConfigured
        : ai.geminiConfigured;
  const overallStatus = activeAiReady && supabaseConnected ? 'ok' : 'degraded';

  return NextResponse.json(
    {
      status: overallStatus,
      service: 'merchant-ai-copilot',
      timestamp: new Date().toISOString(),
      ai: {
        activeProvider: ai.activeProvider,
        activeProviderReady: activeAiReady,
        geminiConfigured: ai.geminiConfigured,
        geminiModelId: ai.geminiModelId,
        agnesConfigured: ai.agnesConfigured,
        agnesBaseUrl: ai.agnesBaseUrl,
        agnesModelId: ai.agnesModelId,
        bedrockConfigured: ai.bedrockConfigured,
        awsRegion: ai.awsRegion,
        bedrockModelId: ai.bedrockModelId,
        s3BucketConfigured: ai.s3BucketConfigured,
      },
      supabase: {
        configured: supabaseEnv.configured,
        urlConfigured: supabaseEnv.urlConfigured,
        anonKeyConfigured: supabaseEnv.anonKeyConfigured,
        serviceRoleConfigured: supabaseEnv.serviceRoleConfigured,
        connected: supabaseConnected,
        menuItemCount,
        latencyMs,
        message: supabaseMessage,
      },
    },
    { status: 200 }
  );
}
