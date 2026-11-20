import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface RagDocRow {
  id: string;
  municipality_id: string;
  filename: string;
  doc_type: string;
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
    const rows = await db.query<RagDocRow>(
      `SELECT id, municipality_id, filename, doc_type, source_url,
              COALESCE(status, 'VIGENTE') AS status, valid_until,
              COALESCE(usage_count, 0) AS usage_count,
              char_count, chunk_count, uploaded_by, created_at
       FROM rag_documents
       WHERE municipality_id = $1
       ORDER BY created_at DESC`,
      [auth.session.municipalityId]
    );

    return NextResponse.json({ documents: rows });
  } catch (error) {
    console.error('Error in GET /api/admin/rag:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar los documentos.' },
      { status: 500 }
    );
  }
}
