import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      consultationId?: string;
      municipalityId?: string;
      question?: string;
      lang?: string;
    };

    const db = await getDb();
    const municipality = await resolveMunicipality(db, body.municipalityId);
    if (!municipality) {
      return NextResponse.json(
        { error: 'Municipio no encontrado.' },
        { status: 404 }
      );
    }

    let consultationId = (body.consultationId ?? '').trim();

    if (consultationId) {
      const res = await db.execute(
        `UPDATE consultations
         SET escalated_to_human = 1
         WHERE id = $1 AND municipality_id = $2`,
        [consultationId, municipality.id]
      );
      if (res.changes === 0) {
        consultationId = '';
      }
    }

    if (!consultationId) {
      consultationId = `cons-${crypto.randomUUID()}`;
      const question =
        (body.question ?? '').trim() ||
        'Solicitud ciudadana de atención por agente humano';
      await db.execute(
        `INSERT INTO consultations (
           id, municipality_id, question, answer, topic, lang, channel,
           tokens_saved, provider_used, escalated_to_human
         ) VALUES ($1, $2, $3, $4, 'Atención Humana', $5, 'WEB', 1, 'HUMAN_ESCALATION', 1)`,
        [
          consultationId,
          municipality.id,
          question,
          'Derivado a Atención Ciudadana del Ayuntamiento.',
          body.lang || 'es',
        ]
      );
    }

    const mainSquare = municipality.streets[1] || municipality.streets[0] || 'Ayuntamiento';

    return NextResponse.json({
      ok: true,
      consultationId,
      municipalityName: municipality.name,
      message: `Tu consulta ha sido derivada al equipo de Atención Ciudadana de ${municipality.name}. Un técnico municipal te responderá por escrito (también puedes acudir de lunes a viernes de 09:00 a 14:00 en ${mainSquare}).`,
    });
  } catch (error) {
    console.error('Error in POST /api/chat/escalate:', error);
    return NextResponse.json(
      { error: 'No se pudo derivar la consulta.' },
      { status: 500 }
    );
  }
}
