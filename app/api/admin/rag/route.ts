import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { GEMINI_EMBEDDING_MODEL } from '@/lib/rag/fts';

export const dynamic = 'force-dynamic';

interface RagDocRow {
  id: string;
  municipality_id: string;
  filename: string;
  doc_type: string;
  category: string | null;
  source_url: string | null;
  status: 'VIGENTE' | 'DEROGADA' | null;
  valid_until: string | null;
  usage_count: number | null;
  char_count: number;
  chunk_count: number;
  uploaded_by: string | null;
  created_at: string;
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const [rows, vectorStats] = await Promise.all([
      db.query<RagDocRow>(
        `SELECT id, municipality_id, filename, doc_type, category, source_url,
                COALESCE(status, 'VIGENTE') AS status, valid_until,
                COALESCE(usage_count, 0) AS usage_count,
                char_count, chunk_count, uploaded_by, created_at
         FROM rag_documents
         WHERE municipality_id = $1
         ORDER BY created_at DESC`,
        [auth.session.municipalityId]
      ),
      db.queryOne<{
        total_chunks: number;
        vectorized_chunks: number;
      }>(
        `SELECT COUNT(*)::int AS total_chunks,
                COUNT(*) FILTER (
                  WHERE embedding IS NOT NULL AND COALESCE(embedding_model, $2) = $2
                )::int AS vectorized_chunks
         FROM rag_chunks
         WHERE municipality_id = $1`,
        [auth.session.municipalityId, GEMINI_EMBEDDING_MODEL]
      ),
    ]);

    return NextResponse.json({
      documents: rows,
      vectorStats: {
        totalChunks: vectorStats?.total_chunks ?? 0,
        vectorizedChunks: vectorStats?.vectorized_chunks ?? 0,
        embeddingModel: GEMINI_EMBEDDING_MODEL,
      },
    });
  } catch (error) {
    console.error('Error in GET /api/admin/rag:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar los documentos.' },
      { status: 500 }
    );
  }
}
