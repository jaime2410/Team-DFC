import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';

export const dynamic = 'force-dynamic';

interface IncidentTrackRow {
  id: string;
  municipality_id: string;
  tracking_code: string;
  title: string;
  description: string;
  address_label: string | null;
  category: string;
  urgency: string;
  department: string;
  status: 'PENDIENTE' | 'EN_REVISION' | 'EN_CURSO' | 'RESUELTA';
  upvotes: number;
  internal_notes: string | null;
  resolved_photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const rawCode = request.nextUrl.searchParams.get('code') ?? '';
    const code = rawCode.trim().toUpperCase();
    const municipalityParam = request.nextUrl.searchParams.get('municipalityId');

    if (!code) {
      return NextResponse.json(
        { found: false, error: 'Introduce un código de aviso (ej. SOL-101).' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const municipality = await resolveMunicipality(db, municipalityParam);

    if (!municipality) {
      return NextResponse.json(
        { found: false, error: 'Municipio no encontrado.' },
        { status: 404 }
      );
    }

    const incident = await db.queryOne<IncidentTrackRow>(
      `SELECT id, municipality_id, tracking_code, title, description, address_label,
              category, urgency, department, status, upvotes, internal_notes,
              resolved_photo_url, created_at, updated_at
       FROM incidents
       WHERE UPPER(tracking_code) = $1 AND municipality_id = $2
       LIMIT 1`,
      [code, municipality.id]
    );

    if (!incident) {
      return NextResponse.json(
        {
          found: false,
          error: `No encontramos ningún aviso con el código ${code} en ${municipality.name}.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      found: true,
      municipalityName: municipality.name,
      incident,
    });
  } catch (error) {
    console.error('Error tracking incident:', error);
    return NextResponse.json(
      { found: false, error: 'Error al consultar el aviso.' },
      { status: 500 }
    );
  }
}
