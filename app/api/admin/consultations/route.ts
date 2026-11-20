import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

interface AdminConsultationRow {
  id: string;
  question: string;
  answer: string;
  topic: string | null;
  lang: string;
  channel: string;
  tokens_saved: number;
  provider_used: string;
  escalated_to_human: number | null;
  human_answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const rows = await db.query<AdminConsultationRow>(
      `SELECT id, question, answer, topic, lang, channel, tokens_saved, provider_used,
              COALESCE(escalated_to_human, 0) AS escalated_to_human,
              human_answer, answered_by, answered_at,
              COALESCE(input_tokens, 0) AS input_tokens,
              COALESCE(output_tokens, 0) AS output_tokens,
              created_at
       FROM consultations
       WHERE municipality_id = $1
       ORDER BY COALESCE(escalated_to_human, 0) DESC, created_at DESC
       LIMIT 100`,
      [auth.session.municipalityId]
    );

    return NextResponse.json({ consultations: rows });
  } catch (error) {
    console.error('Error in GET /api/admin/consultations:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar las consultas.' },
      { status: 500 }
    );
  }
}
