import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { broadcastStreetAlert } from '@/lib/personalization/matcher';

export const dynamic = 'force-dynamic';

interface StreetAlertRow {
  id: string;
  municipality_id: string;
  title: string;
  message: string;
  affected_streets_json: string;
  start_date: string;
  end_date: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  created_at: string;
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const rows = await db.query<StreetAlertRow>(
      `SELECT id, municipality_id, title, message, affected_streets_json,
              start_date, end_date, severity, created_at
       FROM street_alerts
       WHERE municipality_id = $1
       ORDER BY created_at DESC`,
      [auth.session.municipalityId]
    );

    const alerts = rows.map((r) => {
      let affectedStreets: string[] = [];
      try {
        affectedStreets = JSON.parse(r.affected_streets_json) as string[];
      } catch {
        affectedStreets = [];
      }
      return {
        id: r.id,
        title: r.title,
        message: r.message,
        affectedStreets,
        startDate: r.start_date,
        endDate: r.end_date,
        severity: r.severity,
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({ alerts });
  } catch (error) {
    console.error('Error in GET /api/admin/street-alerts:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar los avisos de calle.' },
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
      message?: string;
      affectedStreets?: string[];
      startDate?: string;
      endDate?: string;
      severity?: 'INFO' | 'WARNING' | 'CRITICAL';
    };

    const title = (body.title ?? '').trim();
    const message = (body.message ?? '').trim();
    const affectedStreets = Array.isArray(body.affectedStreets)
      ? body.affectedStreets.map((s) => s.trim()).filter(Boolean)
      : [];
    const startDate = (body.startDate ?? '').trim() || new Date().toISOString().slice(0, 10);
    const endDate = (body.endDate ?? '').trim() || startDate;
    const severity: 'INFO' | 'WARNING' | 'CRITICAL' = ['INFO', 'WARNING', 'CRITICAL'].includes(
      body.severity ?? ''
    )
      ? (body.severity as 'INFO' | 'WARNING' | 'CRITICAL')
      : 'WARNING';

    if (!title || !message || affectedStreets.length === 0) {
      return NextResponse.json(
        { error: 'Completa el título, mensaje y al menos una calle afectada.' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const alertId = `alert-${crypto.randomUUID()}`;

    await db.execute(
      `INSERT INTO street_alerts (
         id, municipality_id, title, message, affected_streets_json, start_date, end_date, severity
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        alertId,
        auth.session.municipalityId,
        title,
        message,
        JSON.stringify(affectedStreets),
        startDate,
        endDate,
        severity,
      ]
    );

    const { notifiedCount } = await broadcastStreetAlert(
      auth.session.municipalityId,
      alertId
    );

    return NextResponse.json(
      {
        alert: {
          id: alertId,
          title,
          message,
          affectedStreets,
          startDate,
          endDate,
          severity,
        },
        notifiedCount,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error in POST /api/admin/street-alerts:', error);
    return NextResponse.json(
      { error: 'No se pudo publicar el aviso de calle.' },
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
       WHERE municipality_id = $1 AND type = 'STREET_ALERT' AND ref_id = $2`,
      [auth.session.municipalityId, id.trim()]
    );
    await db.execute(
      `DELETE FROM street_alerts WHERE id = $1 AND municipality_id = $2`,
      [id.trim(), auth.session.municipalityId]
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/street-alerts:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar el aviso de calle.' },
      { status: 500 }
    );
  }
}
