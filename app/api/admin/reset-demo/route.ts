import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resetDatabase } from '@/lib/db/seed';
import { requireAdminSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    await resetDatabase(db);
    return NextResponse.json({
      ok: true,
      message: 'Datos de demostración restaurados correctamente.',
    });
  } catch (error) {
    console.error('Error in POST /api/admin/reset-demo:', error);
    return NextResponse.json(
      { error: 'No se pudieron reiniciar los datos de demo.' },
      { status: 500 }
    );
  }
}
