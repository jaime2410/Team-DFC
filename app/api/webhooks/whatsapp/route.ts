import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { processChatMessage } from '@/lib/chat/service';

export const dynamic = 'force-dynamic';

interface WhatsAppMessage {
  from: string;
  id?: string;
  type: 'text' | 'location' | 'image' | string;
  text?: { body?: string };
  location?: { latitude?: number; longitude?: number; name?: string };
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

function detectLang(text: string): string {
  return /[\u0600-\u06FF]/.test(text) ? 'ar' : 'es';
}

function mediaReply(kind: 'location' | 'image', municipalityName: string, lang: string): string {
  const messages: Record<string, Record<string, string>> = {
    location: {
      es: `Hemos recibido tu ubicación en ${municipalityName}. Para completar el aviso, descríbenos el problema por mensaje o usa "Avisar de un problema" en la web.`,
      ar: `استلمنا موقعك في ${municipalityName}. لإكمال البلاغ صف لنا المشكلة برسالة أو استخدم "الإبلاغ عن مشكلة" في الموقع.`,
    },
    image: {
      es: `Hemos recibido tu foto en ${municipalityName}. Cuéntanos qué ocurre y dónde (calle o ubicación) para registrar el aviso.`,
      ar: `استلمنا صورتك في ${municipalityName}. أخبرنا بما حدث وأين (الشارع أو الموقع) لتسجيل البلاغ.`,
    },
  };
  return messages[kind][lang] ?? messages[kind].es;
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
    let municipality = null as ReturnType<typeof resolveMunicipality>;
    if (phoneNumberId) {
      const row = db
        .prepare(`SELECT id FROM municipalities WHERE whatsapp_phone_id = ? LIMIT 1`)
        .get(phoneNumberId) as { id: string } | undefined;
      if (row) municipality = resolveMunicipality(db, row.id);
    }
    if (!municipality) municipality = resolveMunicipality(db, null);
    if (!municipality) {
      return NextResponse.json({ ok: false, error: 'Municipality not found' });
    }

    let reply = '';
    let providerUsed = 'WHATSAPP_MEDIA';
    let tokensSaved = true;
    let suggestIncident = false;

    if (message.type === 'text') {
      const body = (message.text?.body ?? '').trim();
      if (!body) {
        return NextResponse.json({ ok: true, ignored: true, reason: 'empty_text' });
      }
      const result = await processChatMessage({
        municipalityId: municipality.id,
        message: body,
        history: [],
        lang: detectLang(body),
        channel: 'WHATSAPP',
      });
      reply = result.answer;
      providerUsed = result.providerUsed;
      tokensSaved = result.tokensSaved;
      suggestIncident = result.suggestIncident;
    } else if (message.type === 'location' || message.type === 'image') {
      reply = mediaReply(message.type, municipality.name, 'es');
    } else {
      return NextResponse.json({
        ok: true,
        ignored: true,
        reason: `unsupported_type_${message.type}`,
      });
    }

    // Envío real vía Meta Cloud API (solo si hay credenciales)
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const delivery: { attempted: boolean; status?: number; error?: string } = {
      attempted: false,
    };
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
      delivery,
    });
  } catch (error) {
    console.error('Error in WhatsApp webhook:', error);
    return NextResponse.json({ ok: false, error: 'webhook_error' });
  }
}
