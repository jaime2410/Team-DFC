import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { broadcastNewAid, type AidRequirements } from '@/lib/personalization/matcher';

export const dynamic = 'force-dynamic';

interface AidRow {
  id: string;
  municipality_id: string;
  title: string;
  description: string;
  discount_label: string;
  requirements_json: string;
  deadline: string | null;
  apply_url: string | null;
  active: number;
  created_at: string;
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const rows = await db.query<AidRow>(
      `SELECT id, municipality_id, title, description, discount_label,
              requirements_json, deadline, apply_url, active, created_at
       FROM municipal_aids
       WHERE municipality_id = $1
       ORDER BY created_at DESC`,
      [auth.session.municipalityId]
    );

    const aids = rows.map((r) => {
      let requirements: AidRequirements = {};
      try {
        requirements = JSON.parse(r.requirements_json) as AidRequirements;
      } catch {
        requirements = {};
      }
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        discountLabel: r.discount_label,
        requirements,
        deadline: r.deadline,
        applyUrl: r.apply_url,
        active: Boolean(r.active),
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({ aids });
  } catch (error) {
    console.error('Error in GET /api/admin/aids:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar las ayudas.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json()) as {
      title?: string;
      description?: string;
      discountLabel?: string;
      requirements?: AidRequirements;
      deadline?: string;
    };

    const title = (body.title ?? '').trim();
    const description = (body.description ?? '').trim();
    const discountLabel = (body.discountLabel ?? '').trim();
    const deadline = (body.deadline ?? '').trim() || 'Abierta todo el año';
    const requirements: AidRequirements = body.requirements ?? {};

    if (!title || !description || !discountLabel) {
      return NextResponse.json(
        { error: 'Completa el título, descripción y etiqueta del descuento.' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const aidId = `aid-${crypto.randomUUID()}`;
    const applyUrl = `/asistente?q=${encodeURIComponent(`Cómo solicitar ${title}`)}`;

    await db.execute(
      `INSERT INTO municipal_aids (
         id, municipality_id, title, description, discount_label,
         requirements_json, deadline, apply_url, active
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)`,
      [
        aidId,
        auth.session.municipalityId,
        title,
        description,
        discountLabel,
        JSON.stringify(requirements),
        deadline,
        applyUrl,
      ]
    );

    const { matchedCount } = await broadcastNewAid(
      auth.session.municipalityId,
      aidId
    );

    return NextResponse.json(
      {
        aid: {
          id: aidId,
          title,
          description,
          discountLabel,
          requirements,
          deadline,
          applyUrl,
        },
        matchedCount,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/admin/aids:', error);
    return NextResponse.json(
      { error: 'No se pudo publicar la ayuda.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const id =
      request.nextUrl.searchParams.get('id') ||
      ((await request.json().catch(() => ({}))) as { id?: string }).id ||
      '';

    if (!id.trim()) {
      return NextResponse.json({ error: 'ID requerido.' }, { status: 400 });
    }

    const db = await getDb();
    await db.execute(
      `DELETE FROM user_notifications
       WHERE municipality_id = $1 AND type = 'AID_MATCH' AND ref_id = $2`,
      [auth.session.municipalityId, id.trim()]
    );
    await db.execute(
      `DELETE FROM municipal_aids WHERE id = $1 AND municipality_id = $2`,
      [id.trim(), auth.session.municipalityId]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/aids:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar la ayuda.' },
      { status: 500 }
    );
  }
}
