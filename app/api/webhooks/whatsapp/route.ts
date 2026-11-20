import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality, type MunicipalityRecord } from '@/lib/db/municipalities';
import { processChatMessage } from '@/lib/chat/service';
import { createIncident, type CreatedIncident } from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

interface WhatsAppMessage {
  from: string;
  id?: string;
  type: 'text' | 'location' | 'image' | string;
  text?: { body?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  image?: { id?: string; caption?: string };
}

interface WhatsAppPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: WhatsAppMessage[];
      };
    }>;
  }>;
}

interface IncidentDraft {
  description?: string;
  lat?: number;
  lng?: number;
  placeName?: string;
  hasImage: boolean;
  imageDataUrl?: string;
  updatedAt: number;
}

const DRAFT_TTL_MS = 30 * 60 * 1000;
const MAX_MEDIA_BYTES = 1_000_000;

// Borradores de incidencia por conversación (memoria del proceso; TTL 30 min).
function getDrafts(): Map<string, IncidentDraft> {
  const g = globalThis as unknown as { __waDrafts?: Map<string, IncidentDraft> };
  if (!g.__waDrafts) g.__waDrafts = new Map();
  return g.__waDrafts;
}

function loadDraft(key: string): IncidentDraft | undefined {
  const drafts = getDrafts();
  const draft = drafts.get(key);
  if (draft && Date.now() - draft.updatedAt > DRAFT_TTL_MS) {
    drafts.delete(key);
    return undefined;
  }
  return draft;
}

function getOrCreateDraft(key: string): IncidentDraft {
  const existing = loadDraft(key);
  if (existing) {
    existing.updatedAt = Date.now();
    return existing;
  }
  const draft: IncidentDraft = { hasImage: false, updatedAt: Date.now() };
  getDrafts().set(key, draft);
  return draft;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  const expected = process.env.WHATSAPP_VERIFY_TOKEN || 'almeriacerca_verify_token';

  if (mode === 'subscribe' && token === expected) {
    return new NextResponse(challenge ?? '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

function detectLang(text: string): 'es' | 'ar' {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'es';
}

const MESSAGES = {
  askLocation: {
    es: 'Para registrar el aviso, envíame tu ubicación 📍 (clip → Ubicación).',
    ar: 'لتسجيل البلاغ أرسل لي موقعك 📍 (المرفقات ← الموقع).',
  },
  askDescription: {
    es: 'Cuéntame en un mensaje qué ocurre (por ejemplo: farola apagada en Calle Real).',
    ar: 'أخبرني برسالة ماذا يحدث (مثلاً: عمود إنارة مطفأ في الشارع الرئيسي).',
  },
  failed: {
    es: 'No he podido registrar el aviso ahora mismo. Inténtalo de nuevo en unos minutos.',
    ar: 'تعذر تسجيل البلاغ الآن. حاول مرة أخرى بعد قليل.',
  },
};

function incidentReply(incident: CreatedIncident, lang: 'es' | 'ar'): string {
  if (lang === 'ar') {
    return `✅ تم تسجيل البلاغ في ${incident.municipality_name}.\nالرمز: ${incident.tracking_code}\nالنوع: ${incident.category} · الأولوية: ${incident.urgency}\nالقسم: ${incident.department}\nيمكنك متابعته بكتابة ${incident.tracking_code}.`;
  }
  return `✅ Aviso registrado en ${incident.municipality_name}.\nCódigo: ${incident.tracking_code}\nTipo: ${incident.category} · Urgencia: ${incident.urgency}\nDepartamento: ${incident.department}\nPuedes consultar su estado escribiendo ${incident.tracking_code}.`;
}

async function downloadWhatsAppImage(mediaId: string, accessToken: string): Promise<string | undefined> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!metaRes.ok) return undefined;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return undefined;

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!fileRes.ok) return undefined;
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) return undefined;
    const mime = meta.mime_type && meta.mime_type.startsWith('image/') ? meta.mime_type : 'image/jpeg';
    return `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    return undefined;
  }
}

async function tryCompleteIncident(
  key: string,
  draft: IncidentDraft,
  municipality: MunicipalityRecord
): Promise<CreatedIncident | null> {
  if (!draft.description || draft.lat === undefined || draft.lng === undefined) return null;
  const incident = await createIncident({
    municipalityId: municipality.id,
    description: draft.description,
    lat: draft.lat,
    lng: draft.lng,
    addressLabel: draft.placeName ?? null,
    imageBase64: draft.imageDataUrl ?? null,
    channel: 'WHATSAPP',
    userId: null,
  });
  getDrafts().delete(key);
  return incident;
}

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as WhatsAppPayload;
    const value = payload.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const phoneNumberId = value?.metadata?.phone_number_id;

    if (!message) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'no_messages' });
    }

    const db = await getDb();
    let municipality: MunicipalityRecord | null = null;
    if (phoneNumberId) {
      const row = await db.queryOne<{ id: string }>(
        `SELECT id FROM municipalities WHERE whatsapp_phone_id = $1 LIMIT 1`,
        [phoneNumberId]
      );
      if (row) municipality = await resolveMunicipality(db, row.id);
    }
    if (!municipality) municipality = await resolveMunicipality(db, null);
    if (!municipality) {
      return NextResponse.json({ ok: false, error: 'Municipality not found' });
    }

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const draftKey = `${municipality.id}:${message.from}`;

    let reply = '';
    let providerUsed = 'WHATSAPP_INCIDENT_FLOW';
    let tokensSaved = true;
    let suggestIncident = false;
    let createdIncident: CreatedIncident | null = null;
    let lang: 'es' | 'ar' = 'es';

    try {
      if (message.type === 'text') {
        const body = (message.text?.body ?? '').trim();
        if (!body) {
          return NextResponse.json({ ok: true, ignored: true, reason: 'empty_text' });
        }
        lang = detectLang(body);
        const pending = loadDraft(draftKey);

        if (pending && !pending.description && (pending.lat !== undefined || pending.hasImage)) {
          // Había foto/ubicación esperando la descripción del problema
          pending.description = body;
          pending.updatedAt = Date.now();
          createdIncident = await tryCompleteIncident(draftKey, pending, municipality);
          reply = createdIncident ? incidentReply(createdIncident, lang) : MESSAGES.askLocation[lang];
        } else {
          const result = await processChatMessage({
            municipalityId: municipality.id,
            message: body,
            history: [],
            lang,
            channel: 'WHATSAPP',
          });
          reply = result.answer;
          providerUsed = result.providerUsed;
          tokensSaved = result.tokensSaved;
          suggestIncident = result.suggestIncident;

          if (result.suggestIncident) {
            const draft = getOrCreateDraft(draftKey);
            draft.description = body;
            createdIncident = await tryCompleteIncident(draftKey, draft, municipality);
            reply = createdIncident
              ? incidentReply(createdIncident, lang)
              : `${reply}\n\n${MESSAGES.askLocation[lang]}`;
          }
        }
      } else if (message.type === 'location') {
        const lat = message.location?.latitude;
        const lng = message.location?.longitude;
        if (typeof lat !== 'number' || typeof lng !== 'number') {
          return NextResponse.json({ ok: true, ignored: true, reason: 'invalid_location' });
        }
        const draft = getOrCreateDraft(draftKey);
        draft.lat = lat;
        draft.lng = lng;
        draft.placeName = message.location?.name || message.location?.address || undefined;
        createdIncident = await tryCompleteIncident(draftKey, draft, municipality);
        reply = createdIncident ? incidentReply(createdIncident, lang) : MESSAGES.askDescription[lang];
      } else if (message.type === 'image') {
        const draft = getOrCreateDraft(draftKey);
        draft.hasImage = true;
        if (accessToken && message.image?.id) {
          draft.imageDataUrl = await downloadWhatsAppImage(message.image.id, accessToken);
        }
        const caption = (message.image?.caption ?? '').trim();
        if (caption) {
          draft.description = caption;
          lang = detectLang(caption);
        }
        createdIncident = await tryCompleteIncident(draftKey, draft, municipality);
        if (createdIncident) {
          reply = incidentReply(createdIncident, lang);
        } else if (!draft.description) {
          reply = MESSAGES.askDescription[lang];
        } else {
          reply = MESSAGES.askLocation[lang];
        }
      } else {
        return NextResponse.json({
          ok: true,
          ignored: true,
          reason: `unsupported_type_${message.type}`,
        });
      }
    } catch (err) {
      console.error('WhatsApp flow error:', err);
      reply = MESSAGES.failed[lang];
      providerUsed = 'ERROR';
    }

    // Envío real vía Meta Cloud API (solo si hay credenciales)
    const delivery: { attempted: boolean; status?: number; error?: string } = { attempted: false };
    if (accessToken && phoneNumberId) {
      delivery.attempted = true;
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: message.from,
            type: 'text',
            text: { body: reply },
          }),
        });
        delivery.status = res.status;
      } catch (err) {
        delivery.error = err instanceof Error ? err.message : 'send_failed';
      }
    }

    return NextResponse.json({
      ok: true,
      municipality: { id: municipality.id, slug: municipality.slug, name: municipality.name },
      from: message.from,
      messageType: message.type,
      reply,
      providerUsed,
      tokensSaved,
      suggestIncident,
      incident: createdIncident
        ? {
            id: createdIncident.id,
            tracking_code: createdIncident.tracking_code,
            category: createdIncident.category,
            urgency: createdIncident.urgency,
            department: createdIncident.department,
            status: createdIncident.status,
          }
        : null,
      delivery,
    });
  } catch (error) {
    console.error('Error in WhatsApp webhook:', error);
    return NextResponse.json({ ok: false, error: 'webhook_error' });
  }
}
