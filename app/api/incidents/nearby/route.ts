import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { distanceMeters, isValidCoordinate, NEARBY_RADIUS_METERS } from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

interface OpenIncidentRow {
  id: string;
  tracking_code: string;
  title: string;
  category: string;
  status: string;
  upvotes: number;
  address_label: string | null;
  lat: number;
  lng: number;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const lat = Number(params.get('lat'));
    const lng = Number(params.get('lng'));
    const category = params.get('category')?.trim() ?? '';

    if (!isValidCoordinate(lat, lng)) {
      return NextResponse.json({ error: 'Coordenadas no válidas.' }, { status: 400 });
    }

    const db = await getDb();
    const municipality = resolveMunicipality(db, params.get('municipalityId'));
    if (!municipality) {
      return NextResponse.json({ error: 'Municipio no encontrado.' }, { status: 404 });
    }

    const rows = db
      .prepare(
        `SELECT id, tracking_code, title, category, status, upvotes, address_label, lat, lng
         FROM incidents
         WHERE municipality_id = ? AND status != 'RESUELTA'`
      )
      .all(municipality.id) as OpenIncidentRow[];

    const incidents = rows
      .filter((row) => !category || row.category === category)
      .map((row) => ({
        id: row.id,
        tracking_code: row.tracking_code,
        title: row.title,
        category: row.category,
        status: row.status,
        upvotes: row.upvotes,
        address_label: row.address_label,
        distance_m: Math.round(distanceMeters(lat, lng, row.lat, row.lng)),
      }))
      .filter((row) => row.distance_m < NEARBY_RADIUS_METERS)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 5);

    return NextResponse.json({ incidents, radius_m: NEARBY_RADIUS_METERS });
  } catch (error) {
    console.error('Error loading nearby incidents:', error);
    return NextResponse.json({ error: 'No se pudo consultar avisos cercanos.' }, { status: 500 });
  }
}
