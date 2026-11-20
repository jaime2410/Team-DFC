import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { appendIncidentHistory, parseIncidentHistory } from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

interface IncidentFeedbackRow {
  id: string;
  municipality_id: string;
  tracking_code: string;
  status: string;
  urgency: string;
  internal_notes: string | null;
  reopened_count: number;
  history_json: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = (await request.json()) as {
      action?: 'RATE' | 'REOPEN';
      rating?: number;
      feedback?: string;
      municipalityId?: string;
    };

    const idOrCode = decodeURIComponent(params.id).trim();
    const db = await getDb();

    let municipalityId: string | null = null;
    if (body.municipalityId) {
      const municipality = await resolveMunicipality(db, body.municipalityId);
      if (!municipality) {
        return NextResponse.json({ error: 'Municipio no encontrado.' }, { status: 404 });
      }
      municipalityId = municipality.id;
    }

    const where = municipalityId
      ? `(id = $1 OR UPPER(tracking_code) = UPPER($2)) AND municipality_id = $3`
      : `(id = $1 OR UPPER(tracking_code) = UPPER($2))`;
    const args = municipalityId ? [idOrCode, idOrCode, municipalityId] : [idOrCode, idOrCode];

    const row = await db.queryOne<IncidentFeedbackRow>(
      `SELECT id, municipality_id, tracking_code, status, urgency, internal_notes,
              COALESCE(reopened_count, 0) AS reopened_count, history_json
       FROM incidents
       WHERE ${where}
       LIMIT 1`,
      args
    );

    if (!row) {
      return NextResponse.json({ error: 'Aviso no encontrado.' }, { status: 404 });
    }

    if (body.action === 'REOPEN') {
      const reason = (body.feedback ?? '').trim().slice(0, 240);
      const reopenNote = reason
        ? `[Reabierto por ciudadano: ${reason}]`
        : '[Reabierto por ciudadano: Sigue sin funcionar]';
      const updatedNotes = row.internal_notes
        ? `${row.internal_notes} ${reopenNote}`
        : reopenNote;
      const nextReopened = Number(row.reopened_count ?? 0) + 1;
      const nextUrgency =
        row.urgency === 'EMERGENCIA_112' ? 'EMERGENCIA_112' : 'URGENTE';
      const nowIso = new Date().toISOString();
      const nextHistoryJson = appendIncidentHistory(row.history_json, {
        status: 'EN_CURSO',
        timestamp: nowIso,
        actor: 'Vecino (Reapertura)',
        note: reason || 'Sigue sin funcionar',
      });

      await db.execute(
        `UPDATE incidents
         SET status = 'EN_CURSO',
             urgency = $1,
             reopened_count = $2,
             internal_notes = $3,
             history_json = $4,
             updated_at = $5
         WHERE id = $6`,
        [nextUrgency, nextReopened, updatedNotes, nextHistoryJson, nowIso, row.id]
      );

      return NextResponse.json({
        ok: true,
        action: 'REOPEN',
        id: row.id,
        tracking_code: row.tracking_code,
        status: 'EN_CURSO',
        urgency: nextUrgency,
        reopened_count: nextReopened,
        history: parseIncidentHistory(nextHistoryJson),
      });
    }

    const rating = Math.max(1, Math.min(5, Math.round(Number(body.rating) || 5)));
    const feedback = (body.feedback ?? '').trim().slice(0, 300) || null;

    await db.execute(
      `UPDATE incidents
       SET citizen_rating = $1,
           citizen_feedback = $2,
           updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = $3`,
      [rating, feedback, row.id]
    );

    return NextResponse.json({
      ok: true,
      action: 'RATE',
      id: row.id,
      tracking_code: row.tracking_code,
      citizen_rating: rating,
      citizen_feedback: feedback,
    });
  } catch (error) {
    console.error('Error in POST /api/incidents/[id]/feedback:', error);
    return NextResponse.json(
      { error: 'No se pudo procesar tu valoración.' },
      { status: 500 }
    );
  }
}
