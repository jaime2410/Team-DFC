import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { classifyIncident, hasImmediateDangerKeywords } from '@/lib/ai/classifier';

export const NEARBY_RADIUS_METERS = 150;
const MAX_IMAGE_CHARS = 1_500_000;

export const INCIDENT_STATUSES = [
  'RECIBIDO',
  'VISTO',
  'ASIGNADO',
  'EN_CURSO',
  'RESUELTO',
] as const;

export type IncidentLifecycleStatus = (typeof INCIDENT_STATUSES)[number];

export interface IncidentHistoryEntry {
  status: string;
  timestamp: string;
  actor: string;
  note?: string;
}

const URGENCY_LADDER = [
  'BAJA',
  'MEDIA',
  'ALTA',
  'URGENTE',
  'EMERGENCIA_112',
] as const;

const SPAM_REGEX =
  /\b(spam|viagra|casino|crypto|estafa|imbecil|idiota|mierda|puto|puta|asdfasdf|prueba falsa)\b/i;

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
  is_quarantined?: number;
  quarantine_reason?: string | null;
  image_description?: string | null;
  photo_matches_text?: boolean;
  detected_risk?: boolean;
  emergency_112_alert?: boolean;
  internal_notes?: string;
  history?: IncidentHistoryEntry[];
}

export class IncidentInputError extends Error {}

export function parseIncidentHistory(raw?: string | null): IncidentHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as IncidentHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function appendIncidentHistory(
  existingJson: string | null | undefined,
  entry: { status: string; actor: string; note?: string; timestamp?: string }
): string {
  const list = parseIncidentHistory(existingJson);
  list.push({
    status: entry.status,
    timestamp: entry.timestamp ?? new Date().toISOString(),
    actor: entry.actor,
    note: entry.note,
  });
  return JSON.stringify(list);
}

export function normalizeIncidentStatus(raw?: string | null): IncidentLifecycleStatus {
  switch (raw) {
    case 'PENDIENTE':
    case 'RECIBIDO':
      return 'RECIBIDO';
    case 'EN_REVISION':
    case 'VISTO':
      return 'VISTO';
    case 'ASIGNADO':
      return 'ASIGNADO';
    case 'EN_CURSO':
      return 'EN_CURSO';
    case 'RESUELTA':
    case 'RESUELTO':
      return 'RESUELTO';
    default:
      return 'RECIBIDO';
  }
}

export function escalateUrgencyByUpvotes(currentUrgency: string, upvotes: number): string {
  if (currentUrgency === 'EMERGENCIA_112') return 'EMERGENCIA_112';
  const normalized = currentUrgency === 'CRITICA' ? 'URGENTE' : currentUrgency;
  const currentIdx = Math.max(
    0,
    URGENCY_LADDER.indexOf(normalized as (typeof URGENCY_LADDER)[number])
  );
  let targetIdx = currentIdx;
  if (upvotes >= 6) {
    targetIdx = Math.max(targetIdx, 3); // URGENTE
  } else if (upvotes >= 4) {
    targetIdx = Math.max(targetIdx, 2); // ALTA
  } else if (upvotes >= 2) {
    targetIdx = Math.max(targetIdx, 1); // MEDIA
  }
  return URGENCY_LADDER[targetIdx];
}

export function detectQuarantineSpam(description: string): string | null {
  if (SPAM_REGEX.test(description)) {
    return 'Detectado automáticamente por filtro anti-spam / lenguaje inapropiado.';
  }
  return null;
}

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

  const maxRow = await db.queryOne<{ max_code: number | null }>(
    `SELECT COALESCE(MAX(CAST(SUBSTR(tracking_code, 5) AS INTEGER)), 0)::int AS max_code
     FROM incidents WHERE tracking_code ~ '^SOL-[0-9]+$'`
  );
  const trackingCode = `SOL-${(maxRow?.max_code ?? 0) + 1}`;

  const id = `inc-${crypto.randomUUID()}`;
  const channel = input.channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB';
  const addressLabel = input.addressLabel?.trim() ? input.addressLabel.trim().slice(0, 160) : null;
  const reporterIds = input.userId ? [input.userId] : [];
  const spamReason = detectQuarantineSpam(description);
  const isQuarantined = spamReason ? 1 : 0;
  const nowIso = new Date().toISOString();

  const initialDanger = hasImmediateDangerKeywords(description);
  let title = description.replace(/\s+/g, ' ').slice(0, 72);
  let category = input.categoryHint || 'Otros';
  let urgency = initialDanger ? 'EMERGENCIA_112' : 'MEDIA';
  let department = initialDanger ? 'Policía Local' : 'Atención Ciudadana';
  let aiReasoning = 'Registrado inicialmente en estado RECIBIDO.';
  let providerUsed = 'LOCAL';
  let internalNotes = '';
  let imageDescription: string | null = null;
  let photoMatchesText = true;
  let detectedRisk = initialDanger;

  const initialHistoryJson = appendIncidentHistory(null, {
    status: 'RECIBIDO',
    timestamp: nowIso,
    actor: channel === 'WHATSAPP' ? 'Vecino (WhatsApp)' : 'Vecino (Web)',
    note: 'Aviso recibido y guardado de forma segura en PostgreSQL.',
  });

  // 1. PERSISTENCIA SEGURA ANTES DE INVOCAR A LA IA (nunca se pierde el aviso)
  await db.execute(
    `INSERT INTO incidents (
       id, municipality_id, user_id, tracking_code, title, description, photo_url,
       lat, lng, address_label, category, urgency, department, status,
       ai_reasoning, ai_provider_used, channel, upvotes, internal_notes,
       reporter_ids_json, is_quarantined, quarantine_reason, history_json, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'RECIBIDO', $14, $15, $16, 1, '', $17, $18, $19, $20, $21, $21)`,
    [
      id,
      municipality.id,
      input.userId ?? null,
      trackingCode,
      title,
      description,
      photoUrl,
      input.lat,
      input.lng,
      addressLabel,
      category,
      urgency,
      department,
      aiReasoning,
      providerUsed,
      channel,
      JSON.stringify(reporterIds),
      isQuarantined,
      spamReason,
      initialHistoryJson,
      nowIso,
    ]
  );

  // 2. CLASIFICACIÓN IA POSTERIOR CON ACTUALIZACIÓN DEL REGISTRO
  try {
    const classification = await classifyIncident({
      municipalityId: municipality.id,
      description,
      imageBase64: photoUrl ?? undefined,
      categoryHint: input.categoryHint,
    });

    title = classification.title;
    category = classification.category;
    urgency = classification.urgency;
    department = classification.department;
    aiReasoning = classification.aiReasoning;
    providerUsed = classification.providerUsed;
    imageDescription = classification.imageDescription;
    photoMatchesText = classification.photoMatchesText;
    detectedRisk = classification.detectedRisk;

    if (photoUrl && !photoMatchesText) {
      internalNotes =
        'Aviso de visión: la foto adjunta podría no coincidir con el texto. Conviene confirmar con el vecino o solicitar nueva imagen.';
    }

    await db.execute(
      `UPDATE incidents
       SET title = $1,
           category = $2,
           urgency = $3,
           department = $4,
           ai_reasoning = $5,
           ai_provider_used = $6,
           internal_notes = $7,
           updated_at = $8
       WHERE id = $9`,
      [
        title,
        category,
        urgency,
        department,
        aiReasoning,
        providerUsed,
        internalNotes,
        new Date().toISOString(),
        id,
      ]
    );
  } catch (err) {
    console.warn('Classification fallback after safe DB insert:', err);
  }

  const emergency112Alert =
    urgency === 'EMERGENCIA_112' || hasImmediateDangerKeywords(description);

  return {
    id,
    tracking_code: trackingCode,
    title,
    description,
    category,
    urgency,
    department,
    status: 'RECIBIDO',
    ai_reasoning: aiReasoning,
    ai_provider_used: providerUsed,
    address_label: addressLabel,
    lat: input.lat,
    lng: input.lng,
    municipality_id: municipality.id,
    municipality_name: municipality.name,
    is_quarantined: isQuarantined,
    quarantine_reason: spamReason,
    image_description: imageDescription,
    photo_matches_text: photoMatchesText,
    detected_risk: detectedRisk,
    emergency_112_alert: emergency112Alert,
    internal_notes: internalNotes,
    history: parseIncidentHistory(initialHistoryJson),
  };
}
