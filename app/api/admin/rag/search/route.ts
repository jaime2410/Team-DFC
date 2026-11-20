import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSession } from '@/lib/auth/session';
import { retrieveContext } from '@/lib/rag/fts';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json()) as { query?: string };
    const query = (body.query ?? '').trim();
    if (!query) {
      return NextResponse.json({ chunks: [] });
    }

    const chunks = await retrieveContext({
      municipalityId: auth.session.municipalityId,
      query,
      topK: 3,
      maxChars: 1800,
      trackUsage: false,
    });

    return NextResponse.json({ chunks });
  } catch (error) {
    console.error('Error in POST /api/admin/rag/search:', error);
    return NextResponse.json(
      { error: 'No se pudo ejecutar la búsqueda RAG.' },
      { status: 500 }
    );
  }
}
