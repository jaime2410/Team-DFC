import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { testProviderConnection, type AIProvider } from '@/lib/ai/router';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json()) as {
      provider: AIProvider;
      apiKey?: string;
      model?: string;
      baseUrl?: string;
    };

    let apiKey = (body.apiKey ?? '').trim();
    let baseUrl = (body.baseUrl ?? '').trim();

    if ((!apiKey || apiKey.startsWith('••••')) && body.provider !== 'LOCAL') {
      const db = await getDb();
      const stored = await db.queryOne<{ api_key: string; base_url: string }>(
        `SELECT api_key, base_url
         FROM ai_provider_keys
         WHERE municipality_id = $1 AND provider = $2
         LIMIT 1`,
        [auth.session.municipalityId, body.provider]
      );
      if (stored?.api_key) apiKey = stored.api_key;
      if (!baseUrl && stored?.base_url) baseUrl = stored.base_url;
    }

    const result = await testProviderConnection({
      provider: body.provider,
      apiKey,
      model: body.model,
      baseUrl,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in POST /api/admin/ai-config/test:', error);
    return NextResponse.json(
      { ok: false, message: 'No se pudo probar la conexión.' },
      { status: 500 }
    );
  }
}
