import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { normalizeIncidentStatus, parseIncidentHistory } from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

interface AdminIncidentRow {
  id: string;
  municipality_id: string;
  user_id: string | null;
  tracking_code: string;
  title: string;
  description: string;
  photo_url: string | null;
  resolved_photo_url: string | null;
  lat: number;
  lng: number;
  address_label: string | null;
  category: string;
  urgency: string;
  department: string;
  status: string;
  ai_reasoning: string | null;
  ai_provider_used: string | null;
  channel: string;
  upvotes: number;
  internal_notes: string | null;
  reporter_ids_json: string | null;
  citizen_rating: number | null;
  citizen_feedback: string | null;
  reopened_count: number | null;
  is_quarantined: number | null;
  quarantine_reason: string | null;
  viewed_at: string | null;
  resolved_at: string | null;
  history_json: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const rows = await db.query<AdminIncidentRow>(
      `SELECT id, municipality_id, user_id, tracking_code, title, description,
              photo_url, resolved_photo_url, lat, lng, address_label,
              category, urgency, department, status, ai_reasoning, ai_provider_used,
              channel, upvotes, internal_notes, reporter_ids_json,
              citizen_rating, citizen_feedback, COALESCE(reopened_count, 0) AS reopened_count,
              COALESCE(is_quarantined, 0) AS is_quarantined, quarantine_reason,
              viewed_at, resolved_at, history_json,
              created_at, updated_at
       FROM incidents
       WHERE municipality_id = $1
       ORDER BY created_at DESC`,
      [auth.session.municipalityId]
    );

    const incidents = rows.map((row) => {
      let reporterIds: string[] = [];
      try {
        reporterIds = JSON.parse(row.reporter_ids_json || '[]') as string[];
      } catch {
        reporterIds = [];
      }
      return {
        ...row,
        status: normalizeIncidentStatus(row.status),
        urgency: row.urgency === 'CRITICA' ? 'URGENTE' : row.urgency,
        reporterIds,
        history: parseIncidentHistory(row.history_json),
      };
    });

    return NextResponse.json({ incidents });
  } catch (error) {
    console.error('Error in GET /api/admin/incidents:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar las incidencias.' },
      { status: 500 }
    );
  }
}
