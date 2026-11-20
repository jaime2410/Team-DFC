import { NextRequest, NextResponse } from 'next/server';
import { createIncident, IncidentInputError } from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      municipalityId?: string;
      description?: string;
      lat?: number;
      lng?: number;
      addressLabel?: string;
      imageBase64?: string;
      categoryHint?: string;
    };

    // user_id se asociará a la sesión activa cuando exista autenticación (FASE 5).
    const incident = await createIncident({
      municipalityId: body.municipalityId ?? '',
      description: body.description ?? '',
      lat: Number(body.lat),
      lng: Number(body.lng),
      addressLabel: body.addressLabel,
      imageBase64: body.imageBase64,
      categoryHint: body.categoryHint,
      userId: null,
      channel: 'WEB',
    });

    return NextResponse.json({ incident }, { status: 201 });
  } catch (error) {
    if (error instanceof IncidentInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error creating incident:', error);
    return NextResponse.json({ error: 'No se pudo crear el aviso.' }, { status: 500 });
  }
}
