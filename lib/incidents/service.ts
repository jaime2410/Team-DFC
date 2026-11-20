import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { classifyIncident } from '@/lib/ai/classifier';

export const NEARBY_RADIUS_METERS = 150;
const MAX_IMAGE_CHARS = 1_500_000;

export interface CreateIncidentInput {
  municipalityId: string;
  description: string;
  lat: number;
  lng: number;
  addressLabel?: string | null;
  imageBase64?: string | null;
  userId?: string | null;
  channel?: 'WEB' | 'WHATSAPP';
  categoryHint?: string;
}

export interface CreatedIncident {
  id: string;
  tracking_code: string;
  title: string;
  description: string;
  category: string;
  urgency: string;
  department: string;
  status: string;
  ai_reasoning: string;
  ai_provider_used: string;
  address_label: string | null;
  lat: number;
  lng: number;
  municipality_id: string;
  municipality_name: string;
}

export class IncidentInputError extends Error {}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export async function createIncident(input: CreateIncidentInput): Promise<CreatedIncident> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, input.municipalityId);
  if (!municipality) throw new IncidentInputError('Municipio no encontrado.');

  const description = input.description.trim().slice(0, 1000);
  if (description.length < 5) {
    throw new IncidentInputError('La descripción es demasiado corta.');
  }
  if (!isValidCoordinate(input.lat, input.lng)) {
    throw new IncidentInputError('Ubicación no válida.');
  }

  let photoUrl: string | null = null;
  if (input.imageBase64) {
    if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(input.imageBase64)) {
      throw new IncidentInputError('Formato de imagen no válido.');
    }
    if (input.imageBase64.length > MAX_IMAGE_CHARS) {
      throw new IncidentInputError('La imagen es demasiado grande.');
    }
    photoUrl = input.imageBase64;
  }

  const classification = await classifyIncident({
    municipalityId: municipality.id,
    description,
    imageBase64: photoUrl ?? undefined,
    categoryHint: input.categoryHint,
  });

  const maxRow = await db.queryOne<{ max_code: number | null }>(
    `SELECT COALESCE(MAX(CAST(SUBSTR(tracking_code, 5) AS INTEGER)), 0)::int AS max_code
     FROM incidents WHERE tracking_code ~ '^SOL-[0-9]+$'`
  );
  const trackingCode = `SOL-${(maxRow?.max_code ?? 0) + 1}`;

  const id = `inc-${crypto.randomUUID()}`;
  const channel = input.channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB';
  const addressLabel = input.addressLabel?.trim() ? input.addressLabel.trim().slice(0, 160) : null;

  await db.execute(
    `INSERT INTO incidents (
       id, municipality_id, user_id, tracking_code, title, description, photo_url,
       lat, lng, address_label, category, urgency, department, status,
       ai_reasoning, ai_provider_used, channel, upvotes, internal_notes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDIENTE', $14, $15, $16, 1, '')`,
    [
      id,
      municipality.id,
      input.userId ?? null,
      trackingCode,
      classification.title,
      description,
      photoUrl,
      input.lat,
      input.lng,
      addressLabel,
      classification.category,
      classification.urgency,
      classification.department,
      classification.aiReasoning,
      classification.providerUsed,
      channel,
    ]
  );

  return {
    id,
    tracking_code: trackingCode,
    title: classification.title,
    description,
    category: classification.category,
    urgency: classification.urgency,
    department: classification.department,
    status: 'PENDIENTE',
    ai_reasoning: classification.aiReasoning,
    ai_provider_used: classification.providerUsed,
    address_label: addressLabel,
    lat: input.lat,
    lng: input.lng,
    municipality_id: municipality.id,
    municipality_name: municipality.name,
  };
}
