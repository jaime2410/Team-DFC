import type { DbClient } from './index';

export interface MunicipalityRecord {
  id: string;
  slug: string;
  name: string;
  province: string;
  center_lat: number;
  center_lng: number;
  streets: string[];
  whatsapp_phone_id: string | null;
}

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

function mapRow(row: MunicipalityRow): MunicipalityRecord {
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
}

export function resolveMunicipality(
  db: DbClient,
  municipalityIdOrSlug?: string | null
): MunicipalityRecord | null {
  const trimmed = municipalityIdOrSlug?.trim();
  if (trimmed) {
    const row = db
      .prepare(
        `SELECT id, slug, name, province, center_lat, center_lng, streets_json, whatsapp_phone_id
         FROM municipalities
         WHERE id = ? OR slug = ?
         LIMIT 1`
      )
      .get(trimmed, trimmed) as MunicipalityRow | undefined;
    return row ? mapRow(row) : null;
  }

  const first = db
    .prepare(
      `SELECT id, slug, name, province, center_lat, center_lng, streets_json, whatsapp_phone_id
       FROM municipalities
       ORDER BY name ASC
       LIMIT 1`
    )
    .get() as MunicipalityRow | undefined;

  return first ? mapRow(first) : null;
}
