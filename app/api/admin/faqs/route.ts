import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { normalizeQuestion } from '@/lib/ai/tokenSaver';

export const dynamic = 'force-dynamic';

interface FaqCacheRow {
  id: string;
  normalized_question: string;
  lang: string;
  answer: string;
  hits: number;
  approved_by_admin: number | null;
  created_at: string;
}

interface ConsultationRow {
  question: string;
  answer: string;
  lang: string;
  topic: string | null;
  escalated_to_human: number | null;
  created_at: string;
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const muniId = auth.session.municipalityId;

    const [activeFaqs, consultations] = await Promise.all([
      db.query<FaqCacheRow>(
        `SELECT id, normalized_question, lang, answer, hits,
                COALESCE(approved_by_admin, 1) AS approved_by_admin, created_at
         FROM faq_cache
         WHERE municipality_id = $1
         ORDER BY hits DESC, created_at DESC`,
        [muniId]
      ),
      db.query<ConsultationRow>(
        `SELECT question, answer, lang, topic,
                COALESCE(escalated_to_human, 0) AS escalated_to_human, created_at
         FROM consultations
         WHERE municipality_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [muniId]
      ),
    ]);

    const approvedSet = new Set(
      activeFaqs
        .filter((f) => Number(f.approved_by_admin ?? 1) === 1)
        .map((f) => `${f.lang}:${f.normalized_question}`)
    );

    const grouped = new Map<
      string,
      {
        normalizedQuestion: string;
        sampleQuestion: string;
        suggestedAnswer: string;
        lang: string;
        count: number;
        escalated: boolean;
      }
    >();

    for (const c of consultations) {
      const norm = normalizeQuestion(c.question);
      if (!norm || norm.length < 6 || /^sol-\d+$/i.test(norm)) continue;
      const key = `${c.lang}:${norm}`;
      if (approvedSet.has(key)) continue;

      const existing = grouped.get(key);
      if (existing) {
        existing.count += 1;
        if (c.escalated_to_human) existing.escalated = true;
      } else {
        grouped.set(key, {
          normalizedQuestion: norm,
          sampleQuestion: c.question,
          suggestedAnswer: c.answer,
          lang: c.lang || 'es',
          count: 1,
          escalated: Boolean(c.escalated_to_human),
        });
      }
    }

    const suggestedFaqs = Array.from(grouped.values())
      .sort((a, b) => Number(b.escalated) - Number(a.escalated) || b.count - a.count)
      .slice(0, 8);

    // Si aún no hay sugerencias por consultas recientes, proponer 2 sugerencias frecuentes del municipio si no están ya en caché
    const defaultSuggestions = [
      {
        question: '¿Cómo solicito la bonificación del 50% del IBI por familia numerosa?',
        answer: `Presenta el certificado de empadronamiento colectivo y el título vigente de familia numerosa en el registro de ${auth.session.municipalityName} (lunes a viernes de 09:00 a 14:00) o en sede electrónica.`,
        lang: 'es',
      },
      {
        question: '¿Qué día recogen muebles y enseres viejos a domicilio?',
        answer: `La recogida gratuita de muebles y enseres en ${auth.session.municipalityName} se realiza todos los jueves previo aviso indicando tu calle.`,
        lang: 'es',
      },
    ];

    for (const def of defaultSuggestions) {
      const norm = normalizeQuestion(def.question);
      const key = `${def.lang}:${norm}`;
      if (!approvedSet.has(key) && !grouped.has(key)) {
        suggestedFaqs.push({
          normalizedQuestion: norm,
          sampleQuestion: def.question,
          suggestedAnswer: def.answer,
          lang: def.lang,
          count: 2,
          escalated: false,
        });
      }
    }

    return NextResponse.json({
      activeFaqs,
      suggestedFaqs,
    });
  } catch (error) {
    console.error('Error in GET /api/admin/faqs:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar las FAQs.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json()) as {
      question?: string;
      answer?: string;
      lang?: string;
    };

    const normalizedQuestion = normalizeQuestion(body.question ?? '');
    const answer = (body.answer ?? '').trim();
    const lang = ['es', 'en', 'fr', 'ar'].includes(body.lang ?? '')
      ? (body.lang as string)
      : 'es';

    if (!normalizedQuestion || !answer) {
      return NextResponse.json(
        { error: 'Indica la pregunta y la respuesta oficial.' },
        { status: 400 }
      );
    }

    const db = await getDb();
    await db.execute(
      `INSERT INTO faq_cache (id, municipality_id, normalized_question, lang, answer, hits, approved_by_admin)
       VALUES ($1, $2, $3, $4, $5, 1, 1)
       ON CONFLICT (municipality_id, normalized_question, lang)
       DO UPDATE SET answer = EXCLUDED.answer, approved_by_admin = 1`,
      [
        `faq-${crypto.randomUUID()}`,
        auth.session.municipalityId,
        normalizedQuestion,
        lang,
        answer,
      ]
    );

    return NextResponse.json({
      ok: true,
      normalizedQuestion,
      lang,
      answer,
    });
  } catch (error) {
    console.error('Error in POST /api/admin/faqs:', error);
    return NextResponse.json(
      { error: 'No se pudo aprobar la FAQ.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const id =
      request.nextUrl.searchParams.get('id') ||
      ((await request.json().catch(() => ({}))) as { id?: string }).id ||
      '';

    if (!id.trim()) {
      return NextResponse.json({ error: 'ID requerido.' }, { status: 400 });
    }

    const db = await getDb();
    await db.execute(
      `DELETE FROM faq_cache WHERE id = $1 AND municipality_id = $2`,
      [id.trim(), auth.session.municipalityId]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/faqs:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar la FAQ.' },
      { status: 500 }
    );
  }
}
