import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import type { AIFeatureKey, AIProvider, BackupEntry } from '@/lib/ai/router';

export const dynamic = 'force-dynamic';

interface ProviderRow {
  id: string;
  provider: AIProvider;
  api_key: string;
  base_url: string;
  enabled: number;
  updated_at: string;
}

interface ConfigRow {
  id: string;
  feature_key: AIFeatureKey;
  primary_provider: AIProvider;
  primary_model: string;
  backups_json: string;
  max_tokens: number;
  temperature: number;
}

function maskApiKey(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 6) return '••••••';
  return `••••••••${trimmed.slice(-4)}`;
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const muniId = auth.session.municipalityId;

    const [providerRows, configRows, statsRow] = await Promise.all([
      db.query<ProviderRow>(
        `SELECT id, provider, api_key, base_url, enabled, updated_at
         FROM ai_provider_keys
         WHERE municipality_id = $1
         ORDER BY provider ASC`,
        [muniId]
      ),
      db.query<ConfigRow>(
        `SELECT id, feature_key, primary_provider, primary_model, backups_json, max_tokens, temperature
         FROM ai_configs
         WHERE municipality_id = $1
         ORDER BY feature_key ASC`,
        [muniId]
      ),
      db.queryOne<{
        total: number;
        saved: number;
        in_tokens: number;
        out_tokens: number;
      }>(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(CASE WHEN tokens_saved = 1 THEN 1 ELSE 0 END), 0)::int AS saved,
                COALESCE(SUM(COALESCE(input_tokens, 0)), 0)::int AS in_tokens,
                COALESCE(SUM(COALESCE(output_tokens, 0)), 0)::int AS out_tokens
         FROM consultations
         WHERE municipality_id = $1`,
        [muniId]
      ),
    ]);

    const providers = providerRows.map((p) => ({
      provider: p.provider,
      maskedKey: maskApiKey(p.api_key),
      hasKey: Boolean(p.api_key && p.api_key.trim().length > 0),
      baseUrl: p.base_url,
      enabled: p.provider === 'LOCAL' ? true : Boolean(p.enabled),
    }));

    const configs = configRows.map((c) => {
      let backups: BackupEntry[] = [];
      try {
        backups = JSON.parse(c.backups_json) as BackupEntry[];
      } catch {
        backups = [];
      }
      return {
        featureKey: c.feature_key,
        primaryProvider: c.primary_provider,
        primaryModel: c.primary_model,
        backups,
        maxTokens: c.max_tokens,
        temperature: c.temperature,
      };
    });

    const total = statsRow?.total ?? 0;
    const saved = statsRow?.saved ?? 0;
    const savingsPercent = total > 0 ? Math.round((saved / total) * 100) : 0;

    return NextResponse.json({
      providers,
      configs,
      tokenStats: {
        totalConsultations: total,
        zeroTokenConsultations: saved,
        savingsPercent,
        totalInputTokens: statsRow?.in_tokens ?? 0,
        totalOutputTokens: statsRow?.out_tokens ?? 0,
        estimatedTokensSaved: saved * 220,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/admin/ai-config:', error);
    return NextResponse.json(
      { error: 'No se pudo cargar la configuración de IA.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json()) as {
      providers?: Array<{
        provider: AIProvider;
        apiKey?: string;
        baseUrl?: string;
        enabled?: boolean;
      }>;
      configs?: Array<{
        featureKey: AIFeatureKey;
        primaryProvider: AIProvider;
        primaryModel: string;
        backups: BackupEntry[];
        maxTokens: number;
        temperature?: number;
      }>;
    };

    const db = await getDb();
    const muniId = auth.session.municipalityId;

    await db.withTransaction(async (tx) => {
      if (Array.isArray(body.providers)) {
        for (const p of body.providers) {
          const existing = await tx.queryOne<{ api_key: string; base_url: string }>(
            `SELECT api_key, base_url
             FROM ai_provider_keys
             WHERE municipality_id = $1 AND provider = $2
             LIMIT 1`,
            [muniId, p.provider]
          );

          const rawInputKey = (p.apiKey ?? '').trim();
          const finalKey =
            rawInputKey.startsWith('••••') || rawInputKey === ''
              ?rawInputKey === '' && p.apiKey !== undefined && !rawInputKey.startsWith('••••')
                ? existing?.api_key ?? ''
                : existing?.api_key ?? ''
              : rawInputKey;

          const enabled = p.provider === 'LOCAL' ? 1 : p.enabled ? 1 : 0;
          const baseUrl = p.baseUrl !== undefined ? p.baseUrl.trim() : existing?.base_url ?? '';

          await tx.execute(
            `UPDATE ai_provider_keys
             SET api_key = $1,
                 base_url = $2,
                 enabled = $3,
                 updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             WHERE municipality_id = $4 AND provider = $5`,
            [finalKey, baseUrl, enabled, muniId, p.provider]
          );
        }
      }

      if (Array.isArray(body.configs)) {
        for (const c of body.configs) {
          const maxTokens = Math.max(50, Math.min(2000, Math.round(Number(c.maxTokens) || 300)));
          const temperature = Number.isFinite(Number(c.temperature))
            ? Number(c.temperature)
            : 0.2;
          const backups = Array.isArray(c.backups) ? c.backups : [];

          await tx.execute(
            `UPDATE ai_configs
             SET primary_provider = $1,
                 primary_model = $2,
                 backups_json = $3,
                 max_tokens = $4,
                 temperature = $5,
                 updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             WHERE municipality_id = $6 AND feature_key = $7`,
            [
              c.primaryProvider,
              c.primaryModel.trim() || 'deterministic-v1',
              JSON.stringify(backups),
              maxTokens,
              temperature,
              muniId,
              c.featureKey,
            ]
          );
        }
      }
    });

    return await GET();
  } catch (error) {
    console.error('Error in PUT /api/admin/ai-config:', error);
    return NextResponse.json(
      { error: 'No se pudo guardar la configuración de IA.' },
      { status: 500 }
    );
  }
}
