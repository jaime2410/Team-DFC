import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { getSession } from '@/lib/auth/session';
import { escalateUrgencyByUpvotes } from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

interface UpvoteRow {
  id: string;
  tracking_code: string;
  upvotes: number;
  urgency: string;
  reporter_ids_json: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    let municipalityParam: string | null = null;
    try {
      const body = (await request.json()) as { municipalityId?: string };
      municipalityParam = body.municipalityId ?? null;
    } catch {
      municipalityParam = null;
    }

    const db = await getDb();
    const session = await getSession();
    const idOrCode = decodeURIComponent(params.id).trim();

    let municipalityId: string | null = null;
    if (municipalityParam) {
      const municipality = await resolveMunicipality(db, municipalityParam);
      if (!municipality) {
        return NextResponse.json({ error: 'Municipio no encontrado.' }, { status: 404 });
      }
      municipalityId = municipality.id;
    }

    const where = municipalityId
      ? `(id = $1 OR UPPER(tracking_code) = UPPER($2)) AND municipality_id = $3`
      : `(id = $1 OR UPPER(tracking_code) = UPPER($2))`;
    const args = municipalityId ? [idOrCode, idOrCode, municipalityId] : [idOrCode, idOrCode];

    const existing = await db.queryOne<UpvoteRow>(
      `SELECT id, tracking_code, upvotes, urgency, reporter_ids_json
       FROM incidents
       WHERE ${where}
       LIMIT 1`,
      args
    );

    if (!existing) {
      return NextResponse.json({ error: 'Aviso no encontrado.' }, { status: 404 });
    }

    const nextUpvotes = Number(existing.upvotes ?? 1) + 1;
    const nextUrgency = escalateUrgencyByUpvotes(existing.urgency, nextUpvotes);

    let reporterIds: string[] = [];
    try {
      reporterIds = JSON.parse(existing.reporter_ids_json || '[]') as string[];
    } catch {
      reporterIds = [];
    }
    if (session?.userId && !reporterIds.includes(session.userId)) {
      reporterIds.push(session.userId);
    }

    await db.execute(
      `UPDATE incidents
       SET upvotes = $1,
           urgency = $2,
           reporter_ids_json = $3,
           updated_at = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       WHERE id = $4`,
      [nextUpvotes, nextUrgency, JSON.stringify(reporterIds), existing.id]
    );

    return NextResponse.json({
      ok: true,
      id: existing.id,
      tracking_code: existing.tracking_code,
      upvotes: nextUpvotes,
      urgency: nextUrgency,
    });
  } catch (error) {
    console.error('Error upvoting incident:', error);
    return NextResponse.json({ error: 'No se pudo registrar tu confirmación.' }, { status: 500 });
  }
}
