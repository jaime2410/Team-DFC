import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';

export const dynamic = 'force-dynamic';

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
    const idOrCode = decodeURIComponent(params.id).trim();

    let municipalityId: string | null = null;
    if (municipalityParam) {
      const municipality = resolveMunicipality(db, municipalityParam);
      if (!municipality) {
        return NextResponse.json({ error: 'Municipio no encontrado.' }, { status: 404 });
      }
      municipalityId = municipality.id;
    }

    const where = municipalityId
      ? `(id = ? OR UPPER(tracking_code) = UPPER(?)) AND municipality_id = ?`
      : `(id = ? OR UPPER(tracking_code) = UPPER(?))`;
    const args = municipalityId ? [idOrCode, idOrCode, municipalityId] : [idOrCode, idOrCode];

    const res = db
      .prepare(
        `UPDATE incidents SET upvotes = upvotes + 1, updated_at = datetime('now') WHERE ${where}`
      )
      .run(...args);

    if (res.changes === 0) {
      return NextResponse.json({ error: 'Aviso no encontrado.' }, { status: 404 });
    }

    const row = db
      .prepare(`SELECT id, tracking_code, upvotes FROM incidents WHERE ${where}`)
      .get(...args) as { id: string; tracking_code: string; upvotes: number } | undefined;

    return NextResponse.json({
      ok: true,
      id: row?.id,
      tracking_code: row?.tracking_code,
      upvotes: row?.upvotes,
    });
  } catch (error) {
    console.error('Error upvoting incident:', error);
    return NextResponse.json({ error: 'No se pudo registrar tu confirmación.' }, { status: 500 });
  }
}
