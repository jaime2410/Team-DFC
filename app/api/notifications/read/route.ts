import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    let notificationId: string | null = null;
    try {
      const body = (await request.json()) as { notificationId?: string };
      notificationId = body.notificationId?.trim() || null;
    } catch {
      notificationId = null;
    }

    const db = await getDb();
    if (notificationId) {
      await db.execute(
        `UPDATE user_notifications
         SET is_read = 1
         WHERE id = $1 AND user_id = $2 AND municipality_id = $3`,
        [notificationId, session.userId, session.municipalityId]
      );
    } else {
      await db.execute(
        `UPDATE user_notifications
         SET is_read = 1
         WHERE user_id = $1 AND municipality_id = $2`,
        [session.userId, session.municipalityId]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in PATCH /api/notifications/read:', error);
    return NextResponse.json(
      { error: 'No se pudieron actualizar las notificaciones.' },
      { status: 500 }
    );
  }
}
