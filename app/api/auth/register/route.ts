import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { setSessionCookie, type SessionUser } from '@/lib/auth/session';
import { syncNotificationsForCitizen } from '@/lib/personalization/matcher';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      municipalityId?: string;
      preferredLang?: string;
    };

    const name = (body.name ?? '').trim();
    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';

    if (name.length < 2) {
      return NextResponse.json(
        { error: 'Por favor, indica tu nombre (mínimo 2 letras).' },
        { status: 400 }
      );
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'Introduce un correo electrónico válido.' },
        { status: 400 }
      );
    }
    if (password.length < 4) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 4 caracteres.' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const municipality = await resolveMunicipality(db, body.municipalityId);
    if (!municipality) {
      return NextResponse.json(
        { error: 'Municipio no encontrado.' },
        { status: 404 }
      );
    }

    const existing = await db.queryOne<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email]
    );
    if (existing) {
      return NextResponse.json(
        { error: 'Ya existe una cuenta registrada con ese correo.' },
        { status: 409 }
      );
    }

    const userId = `user-${crypto.randomUUID()}`;
    const passwordHash = bcrypt.hashSync(password, 10);
    const preferredLang = ['es', 'en', 'fr', 'ar'].includes(body.preferredLang ?? '')
      ? (body.preferredLang as string)
      : 'es';
    const defaultStreet = municipality.streets[0] ?? '';

    await db.withTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO users (id, municipality_id, email, password_hash, name, role, department_name, preferred_lang)
         VALUES ($1, $2, $3, $4, $5, 'CITIZEN', NULL, $6)`,
        [userId, municipality.id, email, passwordHash, name, preferredLang]
      );

      await tx.execute(
        `INSERT INTO citizen_profiles (
           user_id, municipality_id, street_name, neighborhood, household_size,
           has_children, large_family, has_seniors_or_dependents, reduced_mobility,
           income_bracket, interests_json, whatsapp_phone, notifications_opt_in
         ) VALUES ($1, $2, $3, 'Centro', 1, 0, 0, 0, 0, 'MEDIUM', '[]', NULL, 1)`,
        [userId, municipality.id, defaultStreet]
      );
    });

    await syncNotificationsForCitizen(userId);

    const sessionUser: SessionUser = {
      userId,
      email,
      name,
      role: 'CITIZEN',
      municipalityId: municipality.id,
      municipalitySlug: municipality.slug,
      municipalityName: municipality.name,
      departmentName: null,
      preferredLang,
    };

    await setSessionCookie(sessionUser);
    return NextResponse.json({ user: sessionUser }, { status: 201 });
  } catch (error) {
    console.error('Error in /api/auth/register:', error);
    return NextResponse.json(
      { error: 'No se pudo completar el registro.' },
      { status: 500 }
    );
  }
}
