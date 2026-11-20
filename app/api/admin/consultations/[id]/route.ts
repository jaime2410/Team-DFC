import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { normalizeQuestion } from '@/lib/ai/tokenSaver';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const consultationId = decodeURIComponent(params.id).trim();
    const body = (await request.json()) as {
      humanAnswer?: string;
      approveAsFaq?: boolean;
    };

    const humanAnswer = (body.humanAnswer ?? '').trim();
    if (!humanAnswer) {
      return NextResponse.json(
        { error: 'Escribe la respuesta municipal para el vecino.' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const existing = await db.queryOne<{
      id: string;
      question: string;
      lang: string;
    }>(
      `SELECT id, question, lang
       FROM consultations
       WHERE id = $1 AND municipality_id = $2
       LIMIT 1`,
      [consultationId, auth.session.municipalityId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Consulta no encontrada en tu municipio.' },
        { status: 404 }
      );
    }

    const nowIso = new Date().toISOString();
    await db.execute(
      `UPDATE consultations
       SET human_answer = $1,
           answer = $1,
           answered_by = $2,
           answered_at = $3
       WHERE id = $4 AND municipality_id = $5`,
      [
        humanAnswer,
        auth.session.name,
        nowIso,
        existing.id,
        auth.session.municipalityId,
      ]
    );

    let faqApproved = false;
    if (body.approveAsFaq) {
      const normalized = normalizeQuestion(existing.question);
      if (normalized) {
        await db.execute(
          `INSERT INTO faq_cache (id, municipality_id, normalized_question, lang, answer, hits, approved_by_admin)
           VALUES ($1, $2, $3, $4, $5, 1, 1)
           ON CONFLICT (municipality_id, normalized_question, lang)
           DO UPDATE SET answer = EXCLUDED.answer, approved_by_admin = 1`,
          [
            `faq-${crypto.randomUUID()}`,
            auth.session.municipalityId,
            normalized,
            existing.lang || 'es',
            humanAnswer,
          ]
        );
        faqApproved = true;
      }
    }

    return NextResponse.json({
      ok: true,
      id: existing.id,
      humanAnswer,
      answeredBy: auth.session.name,
      answeredAt: nowIso,
      faqApproved,
    });
  } catch (error) {
    console.error('Error in PATCH /api/admin/consultations/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo guardar la respuesta municipal.' },
      { status: 500 }
    );
  }
}
