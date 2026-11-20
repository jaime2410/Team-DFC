import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';

export type IncomeBracket = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CitizenProfileInput {
  user_id?: string;
  municipality_id?: string;
  street_name?: string | null;
  neighborhood?: string | null;
  household_size?: number;
  has_children?: number | boolean;
  large_family?: number | boolean;
  has_seniors_or_dependents?: number | boolean;
  reduced_mobility?: number | boolean;
  income_bracket?: IncomeBracket;
  interests_json?: string;
  whatsapp_phone?: string | null;
  notifications_opt_in?: number | boolean;
}

export interface AidRequirements {
  min_household?: number;
  large_family?: boolean;
  has_children?: boolean;
  has_seniors_or_dependents?: boolean;
  reduced_mobility?: boolean;
  max_income?: IncomeBracket;
}

export interface MatchedAid {
  id: string;
  municipalityId: string;
  title: string;
  description: string;
  discountLabel: string;
  deadline: string | null;
  applyUrl: string | null;
  requirements: AidRequirements;
  matchReasons: string[];
}

export interface MatchedStreetAlert {
  id: string;
  title: string;
  message: string;
  affectedStreets: string[];
  startDate: string;
  endDate: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

interface AidRow {
  id: string;
  municipality_id: string;
  title: string;
  description: string;
  discount_label: string;
  requirements_json: string;
  deadline: string | null;
  apply_url: string | null;
}

interface StreetAlertRow {
  id: string;
  municipality_id: string;
  title: string;
  message: string;
  affected_streets_json: string;
  start_date: string;
  end_date: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

interface ProfileRow {
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
}

const INCOME_RANK: Record<IncomeBracket, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

export function normalizeStreet(street: string): string {
  return street
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStreetCore(normalized: string): string {
  const stripped = normalized
    .replace(/^(c|calle|avda|avenida|plaza|pza|camino|paseo)\s+/i, '')
    .trim();
  return stripped.length >= 3 ? stripped : normalized;
}

export function streetsMatch(
  citizenStreet?: string | null,
  alertStreet?: string | null
): boolean {
  const normA = normalizeStreet(citizenStreet ?? '');
  const normB = normalizeStreet(alertStreet ?? '');
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const coreA = extractStreetCore(normA);
  const coreB = extractStreetCore(normB);
  if (coreA === coreB) return true;

  if (
    normA.startsWith(`${normB} `) ||
    normB.startsWith(`${normA} `) ||
    coreA.startsWith(`${coreB} `) ||
    coreB.startsWith(`${coreA} `)
  ) {
    return true;
  }

  return false;
}

function evaluateAidAgainstProfile(
  row: AidRow,
  profile: CitizenProfileInput
): MatchedAid | null {
  let reqs: AidRequirements = {};
  try {
    reqs = JSON.parse(row.requirements_json) as AidRequirements;
  } catch {
    reqs = {};
  }

  const reasons: string[] = [];
  const householdSize = Number(profile.household_size ?? 1);
  const isLargeFamily = Boolean(profile.large_family);
  const hasChildren = Boolean(profile.has_children);
  const hasSeniors = Boolean(profile.has_seniors_or_dependents);
  const hasReducedMobility = Boolean(profile.reduced_mobility);
  const income: IncomeBracket =
    profile.income_bracket && profile.income_bracket in INCOME_RANK
      ? profile.income_bracket
      : 'MEDIUM';

  if (reqs.large_family) {
    if (!isLargeFamily) return null;
    reasons.push('Podría encajar contigo por indicar Familia Numerosa en tu encuesta');
  }

  if (typeof reqs.min_household === 'number') {
    if (householdSize < reqs.min_household) return null;
    reasons.push(
      `Podría encajar con tu hogar de ${householdSize} integrantes (orientativo: ${reqs.min_household}+ personas)`
    );
  }

  if (reqs.has_children) {
    if (hasChildren) {
      reasons.push('Podría encajar contigo al indicar menores o estudiantes en casa');
    } else if (isLargeFamily) {
      reasons.push('Podría encajar con tu hogar por condición de Familia Numerosa');
    } else {
      return null;
    }
  }

  if (reqs.has_seniors_or_dependents) {
    if (!hasSeniors) return null;
    reasons.push('Podría encajar con tu hogar al indicar mayores o personas dependientes');
  }

  if (reqs.reduced_mobility) {
    if (!hasReducedMobility) return null;
    reasons.push('Podría encajar contigo como apoyo orientativo para movilidad reducida');
  }

  if (reqs.max_income && reqs.max_income in INCOME_RANK) {
    if (INCOME_RANK[income] > INCOME_RANK[reqs.max_income]) return null;
    const incomeText =
      income === 'LOW'
        ? 'tramo orientativo de renta reducida'
        : 'tramo orientativo de renta media o reducida';
    reasons.push(`Encaja de forma orientativa con tu ${incomeText}`);
  }

  if (reasons.length === 0) {
    reasons.push('Información general disponible para hogares del municipio');
  }

  return {
    id: row.id,
    municipalityId: row.municipality_id,
    title: row.title,
    description: row.description,
    discountLabel: row.discount_label,
    deadline: row.deadline,
    applyUrl: row.apply_url,
    requirements: reqs,
    matchReasons: reasons,
  };
}

export async function matchAidsForProfile(
  municipalityId: string,
  profile: CitizenProfileInput
): Promise<MatchedAid[]> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) return [];

  const rows = await db.query<AidRow>(
    `SELECT id, municipality_id, title, description, discount_label, requirements_json, deadline, apply_url
     FROM municipal_aids
     WHERE municipality_id = $1 AND active = 1
     ORDER BY created_at DESC`,
    [municipality.id]
  );

  const matched: MatchedAid[] = [];
  for (const row of rows) {
    const evaluated = evaluateAidAgainstProfile(row, profile);
    if (evaluated) matched.push(evaluated);
  }
  return matched;
}

export async function matchStreetAlertsForProfile(
  municipalityId: string,
  streetName?: string | null
): Promise<MatchedStreetAlert[]> {
  if (!streetName || !streetName.trim()) return [];

  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) return [];

  const rows = await db.query<StreetAlertRow>(
    `SELECT id, municipality_id, title, message, affected_streets_json, start_date, end_date, severity
     FROM street_alerts
     WHERE municipality_id = $1
     ORDER BY created_at DESC`,
    [municipality.id]
  );

  const matching: MatchedStreetAlert[] = [];
  for (const row of rows) {
    let streets: string[] = [];
    try {
      streets = JSON.parse(row.affected_streets_json) as string[];
    } catch {
      streets = [];
    }
    if (streets.some((s) => streetsMatch(streetName, s))) {
      matching.push({
        id: row.id,
        title: row.title,
        message: row.message,
        affectedStreets: streets,
        startDate: row.start_date,
        endDate: row.end_date,
        severity: row.severity,
      });
    }
  }
  return matching;
}

export async function syncNotificationsForCitizen(userId: string): Promise<{
  streetAlertsMatched: number;
  aidsMatched: number;
}> {
  const db = await getDb();
  const profile = await db.queryOne<ProfileRow>(
    `SELECT user_id, municipality_id, street_name, neighborhood, household_size,
            has_children, large_family, has_seniors_or_dependents, reduced_mobility,
            income_bracket, interests_json, whatsapp_phone, notifications_opt_in
     FROM citizen_profiles
     WHERE user_id = $1
     LIMIT 1`,
    [userId]
  );

  if (!profile) {
    return { streetAlertsMatched: 0, aidsMatched: 0 };
  }

  const matchedAlerts = await matchStreetAlertsForProfile(
    profile.municipality_id,
    profile.street_name
  );
  const matchedAids = await matchAidsForProfile(profile.municipality_id, profile);

  const existingRows = await db.query<{
    id: string;
    type: 'STREET_ALERT' | 'AID_MATCH' | 'INCIDENT_UPDATE';
    ref_id: string | null;
  }>(
    `SELECT id, type, ref_id
     FROM user_notifications
     WHERE user_id = $1 AND municipality_id = $2`,
    [userId, profile.municipality_id]
  );

  const validAlertIds = new Set(matchedAlerts.map((a) => a.id));
  const validAidIds = new Set(matchedAids.map((a) => a.id));

  // Eliminar notificaciones de calles o ayudas que ya no apliquen tras cambiar la encuesta
  for (const row of existingRows) {
    if (row.type === 'STREET_ALERT' && row.ref_id && !validAlertIds.has(row.ref_id)) {
      await db.execute(`DELETE FROM user_notifications WHERE id = $1`, [row.id]);
    }
    if (row.type === 'AID_MATCH' && row.ref_id && !validAidIds.has(row.ref_id)) {
      await db.execute(`DELETE FROM user_notifications WHERE id = $1`, [row.id]);
    }
  }

  const existingAlertRefs = new Set(
    existingRows
      .filter((r) => r.type === 'STREET_ALERT' && r.ref_id && validAlertIds.has(r.ref_id))
      .map((r) => r.ref_id as string)
  );
  const existingAidRefs = new Set(
    existingRows
      .filter((r) => r.type === 'AID_MATCH' && r.ref_id && validAidIds.has(r.ref_id))
      .map((r) => r.ref_id as string)
  );

  for (const alert of matchedAlerts) {
    if (existingAlertRefs.has(alert.id)) continue;
    await db.execute(
      `INSERT INTO user_notifications (id, user_id, municipality_id, type, title, body, ref_id, is_read)
       VALUES ($1, $2, $3, 'STREET_ALERT', $4, $5, $6, 0)`,
      [
        `notif-${crypto.randomUUID()}`,
        userId,
        profile.municipality_id,
        `Aviso en tu calle (${profile.street_name}): ${alert.title}`,
        `${alert.message} (${alert.startDate} → ${alert.endDate})`,
        alert.id,
      ]
    );
  }

  for (const aid of matchedAids) {
    if (existingAidRefs.has(aid.id)) continue;
    await db.execute(
      `INSERT INTO user_notifications (id, user_id, municipality_id, type, title, body, ref_id, is_read)
       VALUES ($1, $2, $3, 'AID_MATCH', $4, $5, $6, 0)`,
      [
        `notif-${crypto.randomUUID()}`,
        userId,
        profile.municipality_id,
        `Ayuda para tu hogar: ${aid.title}`,
        `${aid.discountLabel} · ${aid.matchReasons.join(' · ')}`,
        aid.id,
      ]
    );
  }

  return {
    streetAlertsMatched: matchedAlerts.length,
    aidsMatched: matchedAids.length,
  };
}

export async function broadcastStreetAlert(
  municipalityId: string,
  alertId: string
): Promise<{ notifiedCount: number }> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) return { notifiedCount: 0 };

  const alert = await db.queryOne<StreetAlertRow>(
    `SELECT id, municipality_id, title, message, affected_streets_json, start_date, end_date, severity
     FROM street_alerts
     WHERE id = $1 AND municipality_id = $2
     LIMIT 1`,
    [alertId, municipality.id]
  );
  if (!alert) return { notifiedCount: 0 };

  let affectedStreets: string[] = [];
  try {
    affectedStreets = JSON.parse(alert.affected_streets_json) as string[];
  } catch {
    affectedStreets = [];
  }

  const profiles = await db.query<ProfileRow>(
    `SELECT user_id, municipality_id, street_name, neighborhood, household_size,
            has_children, large_family, has_seniors_or_dependents, reduced_mobility,
            income_bracket, interests_json, whatsapp_phone, notifications_opt_in
     FROM citizen_profiles
     WHERE municipality_id = $1`,
    [municipality.id]
  );

  let notifiedCount = 0;
  for (const profile of profiles) {
    if (!profile.street_name) continue;
    const isAffected = affectedStreets.some((s) => streetsMatch(profile.street_name, s));
    if (!isAffected) continue;

    const existing = await db.queryOne<{ id: string }>(
      `SELECT id FROM user_notifications
       WHERE user_id = $1 AND municipality_id = $2 AND type = 'STREET_ALERT' AND ref_id = $3
       LIMIT 1`,
      [profile.user_id, municipality.id, alert.id]
    );

    if (!existing) {
      await db.execute(
        `INSERT INTO user_notifications (id, user_id, municipality_id, type, title, body, ref_id, is_read)
         VALUES ($1, $2, $3, 'STREET_ALERT', $4, $5, $6, 0)`,
        [
          `notif-${crypto.randomUUID()}`,
          profile.user_id,
          municipality.id,
          `Aviso en tu calle (${profile.street_name}): ${alert.title}`,
          `${alert.message} (${alert.start_date} → ${alert.end_date})`,
          alert.id,
        ]
      );
    }
    notifiedCount++;
  }

  return { notifiedCount };
}

export async function broadcastNewAid(
  municipalityId: string,
  aidId: string
): Promise<{ matchedCount: number }> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) return { matchedCount: 0 };

  const aidRow = await db.queryOne<AidRow>(
    `SELECT id, municipality_id, title, description, discount_label, requirements_json, deadline, apply_url
     FROM municipal_aids
     WHERE id = $1 AND municipality_id = $2 AND active = 1
     LIMIT 1`,
    [aidId, municipality.id]
  );
  if (!aidRow) return { matchedCount: 0 };

  const profiles = await db.query<ProfileRow>(
    `SELECT user_id, municipality_id, street_name, neighborhood, household_size,
            has_children, large_family, has_seniors_or_dependents, reduced_mobility,
            income_bracket, interests_json, whatsapp_phone, notifications_opt_in
     FROM citizen_profiles
     WHERE municipality_id = $1`,
    [municipality.id]
  );

  let matchedCount = 0;
  for (const profile of profiles) {
    const evaluated = evaluateAidAgainstProfile(aidRow, profile);
    if (!evaluated) continue;

    const existing = await db.queryOne<{ id: string }>(
      `SELECT id FROM user_notifications
       WHERE user_id = $1 AND municipality_id = $2 AND type = 'AID_MATCH' AND ref_id = $3
       LIMIT 1`,
      [profile.user_id, municipality.id, aidRow.id]
    );

    if (!existing) {
      await db.execute(
        `INSERT INTO user_notifications (id, user_id, municipality_id, type, title, body, ref_id, is_read)
         VALUES ($1, $2, $3, 'AID_MATCH', $4, $5, $6, 0)`,
        [
          `notif-${crypto.randomUUID()}`,
          profile.user_id,
          municipality.id,
          `Ayuda para tu hogar: ${evaluated.title}`,
          `${evaluated.discountLabel} · ${evaluated.matchReasons.join(' · ')}`,
          evaluated.id,
        ]
      );
    }
    matchedCount++;
  }

  return { matchedCount };
}
