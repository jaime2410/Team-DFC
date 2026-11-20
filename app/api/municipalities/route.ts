import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface MunicipalityRow {
  id: string;
  slug: string;
  name: string;
  province: string;
  center_lat: number;
  center_lng: number;
  streets_json: string;
  whatsapp_phone_id: string | null;
}

export async function GET() {
  try {
    const db = await getDb();
    const rows = await db.query<MunicipalityRow>(
      `SELECT id, slug, name, province, center_lat, center_lng, streets_json, whatsapp_phone_id
       FROM municipalities
       ORDER BY name ASC`
    );

    const municipalities = rows.map((row) => {
      let streets: string[] = [];
      try {
        streets = JSON.parse(row.streets_json) as string[];
      } catch {
        streets = [];
      }
      return {
        id: row.id,
        slug: row.slug,
        name: row.name,
        province: row.province,
        center_lat: row.center_lat,
        center_lng: row.center_lng,
        streets,
        whatsapp_phone_id: row.whatsapp_phone_id,
      };
    });

    return NextResponse.json({ municipalities });
  } catch (error) {
    console.error('Error loading municipalities:', error);
    return NextResponse.json(
      { error: 'Failed to load municipalities' },
      { status: 500 }
    );
  }
}
