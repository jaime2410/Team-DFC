import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { normalizeIncidentStatus } from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

interface IncidentAnalyticsRow {
  id: string;
  tracking_code: string;
  title: string;
  category: string;
  urgency: string;
  department: string;
  status: string;
  channel: string;
  lat: number;
  lng: number;
  address_label: string | null;
  upvotes: number;
  is_quarantined: number | null;
  created_at: string;
  viewed_at: string | null;
  resolved_at: string | null;
  updated_at: string;
}

interface ConsultationAnalyticsRow {
  id: string;
  question: string;
  answer: string;
  topic: string | null;
  lang: string;
  channel: string;
  tokens_saved: number;
  provider_used: string;
  input_tokens: number | null;
  output_tokens: number | null;
  escalated_to_human: number | null;
  human_answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  created_at: string;
}

function diffHours(startIso?: string | null, endIso?: string | null, fallbackHours = 1.2): number {
  if (!startIso || !endIso) return fallbackHours;
  const s = Date.parse(startIso);
  const e = Date.parse(endIso);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return fallbackHours;
  return Number(((e - s) / 3600000).toFixed(2));
}

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const db = await getDb();
    const muniId = auth.session.municipalityId;

    const [allIncidents, allConsultations] = await Promise.all([
      db.query<IncidentAnalyticsRow>(
        `SELECT id, tracking_code, title, category, urgency, department,
                status, channel, lat, lng, address_label, upvotes,
                COALESCE(is_quarantined, 0) AS is_quarantined,
                created_at, viewed_at, resolved_at, updated_at
         FROM incidents
         WHERE municipality_id = $1
         ORDER BY created_at DESC`,
        [muniId]
      ),
      db.query<ConsultationAnalyticsRow>(
        `SELECT id, question, answer, topic, lang, channel,
                tokens_saved, provider_used,
                COALESCE(input_tokens, 0) AS input_tokens,
                COALESCE(output_tokens, 0) AS output_tokens,
                COALESCE(escalated_to_human, 0) AS escalated_to_human,
                human_answer, answered_by, answered_at, created_at
         FROM consultations
         WHERE municipality_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [muniId]
      ),
    ]);

    const activeIncidents = allIncidents.filter((i) => !i.is_quarantined);
    const quarantinedCount = allIncidents.filter((i) => Boolean(i.is_quarantined)).length;
    const totalIncidents = activeIncidents.length;

    const resolvedIncidents = activeIncidents.filter(
      (i) => normalizeIncidentStatus(i.status) === 'RESUELTO'
    );
    const resolvedCount = resolvedIncidents.length;
    const resolvedPercent =
      totalIncidents > 0 ? Math.round((resolvedCount / totalIncidents) * 100) : 0;

    const viewedIncidents = activeIncidents.filter(
      (i) => normalizeIncidentStatus(i.status) !== 'RECIBIDO' || Boolean(i.viewed_at)
    );
    const avgHoursToViewed =
      viewedIncidents.length > 0
        ? Number(
            (
              viewedIncidents.reduce(
                (acc, i) => acc + diffHours(i.created_at, i.viewed_at || i.updated_at, 1.4),
                0
              ) / viewedIncidents.length
            ).toFixed(1)
          )
        : 0;

    const avgHoursToResolved =
      resolvedIncidents.length > 0
        ? Number(
            (
              resolvedIncidents.reduce(
                (acc, i) => acc + diffHours(i.created_at, i.resolved_at || i.updated_at, 16.5),
                0
              ) / resolvedIncidents.length
            ).toFixed(1)
          )
        : 0;

    const urgentActiveCount = activeIncidents.filter((i) => {
      const st = normalizeIncidentStatus(i.status);
      const urg = i.urgency === 'CRITICA' ? 'URGENTE' : i.urgency;
      return (
        st !== 'RESUELTO' &&
        (urg === 'ALTA' || urg === 'URGENTE' || urg === 'EMERGENCIA_112')
      );
    }).length;

    const totalConsultations = allConsultations.length;
    const savedConsultations = allConsultations.filter((c) => Boolean(c.tokens_saved)).length;
    const zeroTokenPercent =
      totalConsultations > 0
        ? Math.round((savedConsultations / totalConsultations) * 100)
        : 0;

    const totalInputTokens = allConsultations.reduce(
      (acc, c) => acc + Number(c.input_tokens ?? 0),
      0
    );
    const totalOutputTokens = allConsultations.reduce(
      (acc, c) => acc + Number(c.output_tokens ?? 0),
      0
    );
    const estimatedTokensSaved = savedConsultations * 220;

    const countBy = (items: string[]) => {
      const map = new Map<string, number>();
      for (const k of items) {
        map.set(k, (map.get(k) ?? 0) + 1);
      }
      return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
    };

    const byCategory = countBy(activeIncidents.map((i) => i.category));
    const byDepartment = countBy(activeIncidents.map((i) => i.department));
    const byStatus = ['RECIBIDO', 'VISTO', 'ASIGNADO', 'EN_CURSO', 'RESUELTO'].map(
      (statusName) => ({
        name: statusName,
        count: activeIncidents.filter(
          (i) => normalizeIncidentStatus(i.status) === statusName
        ).length,
      })
    );

    const webCount =
      activeIncidents.filter((i) => i.channel === 'WEB').length +
      allConsultations.filter((c) => c.channel === 'WEB').length;
    const waCount =
      activeIncidents.filter((i) => i.channel === 'WHATSAPP').length +
      allConsultations.filter((c) => c.channel === 'WHATSAPP').length;

    const byChannel = [
      { name: 'WEB', count: webCount },
      { name: 'WHATSAPP', count: waCount },
    ];

    const byTopic = countBy(allConsultations.map((c) => c.topic || 'General'));

    const mapIncidents = activeIncidents.map((i) => ({
      id: i.id,
      tracking_code: i.tracking_code,
      title: i.title,
      category: i.category,
      urgency: i.urgency === 'CRITICA' ? 'URGENTE' : i.urgency,
      department: i.department,
      status: normalizeIncidentStatus(i.status),
      lat: i.lat,
      lng: i.lng,
      address_label: i.address_label,
      upvotes: i.upvotes,
    }));

    return NextResponse.json({
      kpis: {
        totalIncidents,
        resolvedPercent,
        urgentActiveCount,
        quarantinedCount,
        totalConsultations,
        zeroTokenPercent,
        avgHoursToViewed,
        avgHoursToResolved,
        totalInputTokens,
        totalOutputTokens,
        estimatedTokensSaved,
      },
      byCategory,
      byDepartment,
      byStatus,
      byChannel,
      byTopic,
      mapIncidents,
      recentConsultations: allConsultations.slice(0, 20),
    });
  } catch (error) {
    console.error('Error in GET /api/admin/analytics:', error);
    return NextResponse.json(
      { error: 'No se pudieron cargar las analíticas.' },
      { status: 500 }
    );
  }
}
