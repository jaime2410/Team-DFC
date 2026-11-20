import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { setSessionCookie, type SessionUser, type UserRole } from '@/lib/auth/session';
import { syncNotificationsForCitizen } from '@/lib/personalization/matcher';

export const dynamic = 'force-dynamic';

interface UserLoginRow {
  id: string;
  municipality_id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  department_name: string | null;
  preferred_lang: string;
  municipality_slug: string;
  municipality_name: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      password?: string;
      municipalityId?: string;
      mode?: 'CITIZEN' | 'ADMIN';
      strictMunicipality?: boolean;
    };

    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Introduce tu correo y contraseña.' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const row = await db.queryOne<UserLoginRow>(
      `SELECT u.id, u.municipality_id, u.email, u.password_hash, u.name, u.role,
              u.department_name, u.preferred_lang,
              m.slug AS municipality_slug, m.name AS municipality_name
       FROM users u
       JOIN municipalities m ON m.id = u.municipality_id
       WHERE LOWER(u.email) = $1
       LIMIT 1`,
      [email]
    );

    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return NextResponse.json(
        { error: 'Correo o contraseña incorrectos.' },
        { status: 401 }
      );
    }

    if (body.mode === 'ADMIN' && row.role === 'CITIZEN') {
      return NextResponse.json(
        { error: 'Esta cuenta es de vecino y no tiene acceso al panel municipal.' },
        { status: 403 }
      );
    }

    if ((row.role === 'ADMIN' || row.role === 'DEPARTMENT') && body.municipalityId && body.strictMunicipality) {
      const requestedMuni = await resolveMunicipality(db, body.municipalityId);
      if (requestedMuni && requestedMuni.id !== row.municipality_id) {
        return NextResponse.json(
          {
            error: `Tu cuenta de administrador pertenece a ${row.municipality_name}, no a ${requestedMuni.name}.`,
          },
          { status: 403 }
        );
      }
    }

    if (row.role === 'CITIZEN') {
      await syncNotificationsForCitizen(row.id);
    }

    const sessionUser: SessionUser = {
      userId: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      municipalityId: row.municipality_id,
      municipalitySlug: row.municipality_slug,
      municipalityName: row.municipality_name,
      departmentName: row.department_name,
      preferredLang: row.preferred_lang,
    };

    await setSessionCookie(sessionUser);
    return NextResponse.json({ user: sessionUser });
  } catch (error) {
    console.error('Error in /api/auth/login:', error);
    return NextResponse.json(
      { error: 'No se pudo iniciar sesión.' },
      { status: 500 }
    );
  }
}
