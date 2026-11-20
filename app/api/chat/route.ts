import { NextRequest, NextResponse } from 'next/server';
import { processChatMessage, type ChatChannel } from '@/lib/chat/service';
import type { ChatHistoryMessage } from '@/lib/ai/router';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      municipalityId?: string;
      message?: string;
      history?: ChatHistoryMessage[];
      lang?: string;
      channel?: ChatChannel;
    };

    const message = (body.message ?? '').trim();
    if (!message) {
      return NextResponse.json({ error: 'El mensaje no puede estar vacío.' }, { status: 400 });
    }

    const history = Array.isArray(body.history)
      ? body.history
          .filter(
            (m) =>
              m &&
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.content === 'string'
          )
          .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }))
      : [];

    const result = await processChatMessage({
      municipalityId: body.municipalityId ?? '',
      message,
      history,
      lang: body.lang,
      channel: body.channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB',
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in /api/chat:', error);
    return NextResponse.json({ error: 'No se pudo procesar la consulta.' }, { status: 500 });
  }
}
