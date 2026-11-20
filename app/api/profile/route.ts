import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { clearSessionCookie, getSession } from '@/lib/auth/session';
import { normalizeIncidentStatus, parseIncidentHistory } from '@/lib/incidents/service';
import {
  matchAidsForProfile,
  matchStreetAlertsForProfile,
  syncNotificationsForCitizen,
  type IncomeBracket,
} from '@/lib/personalization/matcher';

export const dynamic = 'force-dynamic';

interface CitizenProfileRow {
  user_id: string;
  municipality_id: string;
  street_name: string | null;
  neighborhood: string | null;
  household_size: number;
  has_children: number;
  large_family: number;
  has_seniors_or_dependents: number;
  reduced_mobility: number;
  income_bracket: IncomeBracket;
  interests_json: string;
  whatsapp_phone: string | null;
  notifications_opt_in: number;
  updated_at: string;
}

interface NotificationRow {
  id: string;
  user_id: string;
  municipality_id: string;
  type: 'STREET_ALERT' | 'AID_MATCH' | 'INCIDENT_UPDATE';
  title: string;
  body: string;
  ref_id: string | null;
  is_read: number;
  created_at: string;
}

interface UserIncidentRow {
  id: string;
  tracking_code: string;
  title: string;
  description: string;
  address_label: string | null;
  category: string;
  urgency: string;
  department: string;
  status: string;
  internal_notes: string | null;
  resolved_photo_url: string | null;
  citizen_rating: number | null;
  viewed_at: string | null;
  resolved_at: string | null;
  history_json: string | null;
  created_at: string;
  updated_at: string;
}

async function buildProfilePayload(userId: string, municipalityId: string) {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) {
    throw new Error('Municipio no encontrado.');
  }

  let profile = await db.queryOne<CitizenProfileRow>(
    `SELECT user_id, municipality_id, street_name, neighborhood, household_size,
            has_children, large_family, has_seniors_or_dependents, reduced_mobility,
            income_bracket, interests_json, whatsapp_phone, notifications_opt_in, updated_at
     FROM citizen_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (!profile) {
    const defaultStreet = municipality.streets[0] ?? '';
    await db.execute(
      `INSERT INTO citizen_profiles (
         user_id, municipality_id, street_name, neighborhood, household_size,
         has_children, large_family, has_seniors_or_dependents, reduced_mobility,
         income_bracket, interests_json, whatsapp_phone, notifications_opt_in
       ) VALUES ($1, $2, $3, 'Centro', 1, 0, 0, 0, 0, 'MEDIUM', '[]', NULL, 1)`,
      [userId, municipality.id, defaultStreet]
    );
    profile = await db.queryOne<CitizenProfileRow>(
      `SELECT user_id, municipality_id, street_name, neighborhood, household_size,
              has_children, large_family, has_seniors_or_dependents, reduced_mobility,
              income_bracket, interests_json, whatsapp_phone, notifications_opt_in, updated_at
       FROM citizen_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId]
    );
  }

  if (!profile) {
    throw new Error('No se pudo cargar el perfil ciudadano.');
  }

  await syncNotificationsForCitizen(userId);

  const [matchedAids, matchingStreetAlerts, notifications, myIncidents] = await Promise.all([
    matchAidsForProfile(municipality.id, profile),
    matchStreetAlertsForProfile(municipality.id, profile.street_name),
    db.query<NotificationRow>(
      `SELECT id, user_id, municipality_id, type, title, body, ref_id, is_read, created_at
       FROM user_notifications
       WHERE user_id = $1 AND municipality_id = $2
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId, municipality.id]
    ),
    db.query<UserIncidentRow>(
      `SELECT id, tracking_code, title, description, address_label, category,
              urgency, department, status, internal_notes, resolved_photo_url,
              citizen_rating, viewed_at, resolved_at, history_json, created_at, updated_at
       FROM incidents
       WHERE user_id = $1 AND municipality_id = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId, municipality.id]
    ),
  ]);

  const formattedIncidents = myIncidents.map((inc) => ({
    ...inc,
    status: normalizeIncidentStatus(inc.status),
    history: parseIncidentHistory(inc.history_json),
  }));

  return {
    municipality: {
      id: municipality.id,
      slug: municipality.slug,
      name: municipality.name,
      province: municipality.province,
      streets: municipality.streets,
    },
    profile: {
      streetName: profile.street_name ?? '',
      neighborhood: profile.neighborhood ?? '',
      householdSize: profile.household_size,
      hasChildren: Boolean(profile.has_children),
      largeFamily: Boolean(profile.large_family),
      hasSeniorsOrDependents: Boolean(profile.has_seniors_or_dependents),
      reducedMobility: Boolean(profile.reduced_mobility),
      incomeBracket: profile.income_bracket,
      whatsappPhone: profile.whatsapp_phone ?? '',
      notificationsOptIn: Boolean(profile.notifications_opt_in),
      updatedAt: profile.updated_at,
    },
    matchedAids,
    matchingStreetAlerts,
    notifications,
    myIncidents: formattedIncidents,
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const payload = await buildProfilePayload(session.userId, session.municipalityId);
    return NextResponse.json({
      authenticated: true,
      user: session,
      ...payload,
    });
  } catch (error) {
    console.error('Error in GET /api/profile:', error);
    return NextResponse.json(
      { error: 'No se pudo cargar tu perfil.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const body = (await request.json()) as {
      streetName?: string;
      neighborhood?: string;
      householdSize?: number;
      hasChildren?: boolean;
      largeFamily?: boolean;
      hasSeniorsOrDependents?: boolean;
      reducedMobility?: boolean;
      incomeBracket?: IncomeBracket;
      whatsappPhone?: string;
      notificationsOptIn?: boolean;
    };

    const streetName = (body.streetName ?? '').trim().slice(0, 140);
    const neighborhood = (body.neighborhood ?? 'Centro').trim().slice(0, 100);
    const householdSize = Math.max(1, Math.min(20, Math.round(Number(body.householdSize) || 1)));
    const hasChildren = body.hasChildren ? 1 : 0;
    const largeFamily = body.largeFamily ? 1 : 0;
    const hasSeniorsOrDependents = body.hasSeniorsOrDependents ? 1 : 0;
    const reducedMobility = body.reducedMobility ? 1 : 0;
    const incomeBracket: IncomeBracket = ['LOW', 'MEDIUM', 'HIGH'].includes(
      body.incomeBracket ?? ''
    )
      ? (body.incomeBracket as IncomeBracket)
      : 'MEDIUM';
    const whatsappPhone = (body.whatsappPhone ?? '').trim().slice(0, 30) || null;
    const notificationsOptIn = body.notificationsOptIn === false ? 0 : 1;

    const db = await getDb();
    await db.execute(
      `INSERT INTO citizen_profiles (
         user_id, municipality_id, street_name, neighborhood, household_size,
         has_children, large_family, has_seniors_or_dependents, reduced_mobility,
         income_bracket, interests_json, whatsapp_phone, notifications_opt_in, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '[]', $11, $12,
         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       )
       ON CONFLICT (user_id) DO UPDATE SET
         municipality_id = EXCLUDED.municipality_id,
         street_name = EXCLUDED.street_name,
         neighborhood = EXCLUDED.neighborhood,
         household_size = EXCLUDED.household_size,
         has_children = EXCLUDED.has_children,
         large_family = EXCLUDED.large_family,
         has_seniors_or_dependents = EXCLUDED.has_seniors_or_dependents,
         reduced_mobility = EXCLUDED.reduced_mobility,
         income_bracket = EXCLUDED.income_bracket,
         whatsapp_phone = EXCLUDED.whatsapp_phone,
         notifications_opt_in = EXCLUDED.notifications_opt_in,
         updated_at = EXCLUDED.updated_at`,
      [
        session.userId,
        session.municipalityId,
        streetName,
        neighborhood,
        householdSize,
        hasChildren,
        largeFamily,
        hasSeniorsOrDependents,
        reducedMobility,
        incomeBracket,
        whatsappPhone,
        notificationsOptIn,
      ]
    );

    const payload = await buildProfilePayload(session.userId, session.municipalityId);
    return NextResponse.json({
      authenticated: true,
      user: session,
      ...payload,
    });
  } catch (error) {
    console.error('Error in PUT /api/profile:', error);
    return NextResponse.json(
      { error: 'No se pudo guardar tu perfil.' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'No autenticado.' }, { status: 401 });
    }

    const db = await getDb();
    await db.withTransaction(async (tx) => {
      await tx.execute(`DELETE FROM user_notifications WHERE user_id = $1`, [
        session.userId,
      ]);
      await tx.execute(`DELETE FROM citizen_profiles WHERE user_id = $1`, [
        session.userId,
      ]);
      await tx.execute(`UPDATE incidents SET user_id = NULL WHERE user_id = $1`, [
        session.userId,
      ]);
      await tx.execute(`DELETE FROM users WHERE id = $1`, [session.userId]);
    });

    clearSessionCookie();

    return NextResponse.json({
      ok: true,
      message: 'Tus datos personales, perfil y notificaciones han sido eliminados conforme al RGPD.',
    });
  } catch (error) {
    console.error('Error in DELETE /api/profile:', error);
    return NextResponse.json(
      { error: 'No se pudieron borrar tus datos.' },
      { status: 500 }
    );
  }
}
