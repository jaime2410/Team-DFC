import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireAdminSession } from '@/lib/auth/session';
import { INCIDENT_DEPARTMENTS, INCIDENT_URGENCIES } from '@/lib/ai/classifier';
import {
  appendIncidentHistory,
  INCIDENT_STATUSES,
  normalizeIncidentStatus,
  parseIncidentHistory,
} from '@/lib/incidents/service';

export const dynamic = 'force-dynamic';

interface ExistingIncidentRow {
  id: string;
  municipality_id: string;
  user_id: string | null;
  tracking_code: string;
  title: string;
  status: string;
  urgency: string;
  department: string;
  internal_notes: string | null;
  resolved_photo_url: string | null;
  reporter_ids_json: string | null;
  is_quarantined: number | null;
  quarantine_reason: string | null;
  viewed_at: string | null;
  resolved_at: string | null;
  history_json: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const incidentId = decodeURIComponent(params.id).trim();
    const body = (await request.json()) as {
      status?: string;
      urgency?: string;
      department?: string;
      internalNotes?: string;
      resolvedPhotoUrl?: string | null;
      isQuarantined?: boolean | number;
      quarantineReason?: string | null;
    };

    const db = await getDb();
    const existing = await db.queryOne<ExistingIncidentRow>(
      `SELECT id, municipality_id, user_id, tracking_code, title, status,
              urgency, department, internal_notes, resolved_photo_url,
              reporter_ids_json, is_quarantined, quarantine_reason,
              viewed_at, resolved_at, history_json
       FROM incidents
       WHERE id = $1 AND municipality_id = $2
       LIMIT 1`,
      [incidentId, auth.session.municipalityId]
    );

    if (!existing) {
      return NextResponse.json(
        { error: 'Incidencia no encontrada en tu municipio.' },
        { status: 404 }
      );
    }

    const nextStatus =
      body.status &&
      (INCIDENT_STATUSES as readonly string[]).includes(
        normalizeIncidentStatus(body.status)
      )
        ? normalizeIncidentStatus(body.status)
        : normalizeIncidentStatus(existing.status);

    const nextUrgency =
      body.urgency &&
      (INCIDENT_URGENCIES as readonly string[]).includes(body.urgency)
        ? body.urgency
        : existing.urgency === 'CRITICA'
        ? 'URGENTE'
        : existing.urgency;

    const nextDepartment =
      body.department &&
      (INCIDENT_DEPARTMENTS as readonly string[]).includes(body.department)
        ? body.department
        : existing.department;

    const nextNotes =
      body.internalNotes !== undefined
        ? body.internalNotes.trim().slice(0, 600)
        : existing.internal_notes ?? '';

    const nextResolvedPhoto =
      body.resolvedPhotoUrl !== undefined
        ? body.resolvedPhotoUrl
        : existing.resolved_photo_url;

    const nextQuarantined =
      body.isQuarantined !== undefined
        ? body.isQuarantined
          ? 1
          : 0
        : Number(existing.is_quarantined ?? 0);

    const nextQuarantineReason =
      nextQuarantined === 1
        ? (body.quarantineReason ?? existing.quarantine_reason ?? 'Marcado en cuarentena por administración').trim()
        : null;

    const nowIso = new Date().toISOString();
    const nextViewedAt =
      existing.viewed_at ||
      (nextStatus !== 'RECIBIDO' ? nowIso : null);
    const nextResolvedAt =
      nextStatus === 'RESUELTO'
        ? existing.resolved_at || nowIso
        : existing.resolved_at;

    const nextHistoryJson = appendIncidentHistory(existing.history_json, {
      status: nextStatus,
      timestamp: nowIso,
      actor: auth.session.name,
      note: nextNotes || `Estado actualizado a ${nextStatus} (${nextDepartment})`,
    });

    await db.execute(
      `UPDATE incidents
       SET status = $1,
           urgency = $2,
           department = $3,
           internal_notes = $4,
           resolved_photo_url = $5,
           is_quarantined = $6,
           quarantine_reason = $7,
           viewed_at = $8,
           resolved_at = $9,
           history_json = $10,
           updated_at = $11
       WHERE id = $12 AND municipality_id = $13`,
      [
        nextStatus,
        nextUrgency,
        nextDepartment,
        nextNotes,
        nextResolvedPhoto,
        nextQuarantined,
        nextQuarantineReason,
        nextViewedAt,
        nextResolvedAt,
        nextHistoryJson,
        nowIso,
        existing.id,
        auth.session.municipalityId,
      ]
    );

    // Notificar a TODOS los reportantes vinculados (autor original + vecinos agrupados <150m)
    const recipientSet = new Set<string>();
    if (existing.user_id) recipientSet.add(existing.user_id);
    try {
      const parsedReporters = JSON.parse(existing.reporter_ids_json || '[]') as string[];
      for (const uid of parsedReporters) {
        if (typeof uid === 'string' && uid.trim()) recipientSet.add(uid.trim());
      }
    } catch {
      // Ignore malformed JSON
    }

    let notifiedReporters = 0;
    if (nextQuarantined === 0 && recipientSet.size > 0) {
      const notifTitle = `Actualización de tu aviso ${existing.tracking_code} (${nextStatus})`;
      const notifBody = `"${existing.title}" — Estado: ${nextStatus} · Departamento: ${nextDepartment}.${
        nextNotes ? ` Nota municipal: ${nextNotes}` : ''
      }`;

      for (const recipientId of Array.from(recipientSet)) {
        const userExists = await db.queryOne<{ id: string }>(
          `SELECT id FROM users WHERE id = $1 AND municipality_id = $2 LIMIT 1`,
          [recipientId, auth.session.municipalityId]
        );
        if (!userExists) continue;

        await db.execute(
          `INSERT INTO user_notifications (id, user_id, municipality_id, type, title, body, ref_id, is_read)
           VALUES ($1, $2, $3, 'INCIDENT_UPDATE', $4, $5, $6, 0)`,
          [
            `notif-${crypto.randomUUID()}`,
            recipientId,
            auth.session.municipalityId,
            notifTitle,
            notifBody,
            existing.id,
          ]
        );
        notifiedReporters++;
      }
    }

    return NextResponse.json({
      ok: true,
      incident: {
        id: existing.id,
        tracking_code: existing.tracking_code,
        status: nextStatus,
        urgency: nextUrgency,
        department: nextDepartment,
        internal_notes: nextNotes,
        resolved_photo_url: nextResolvedPhoto,
        is_quarantined: nextQuarantined,
        quarantine_reason: nextQuarantineReason,
        viewed_at: nextViewedAt,
        resolved_at: nextResolvedAt,
        history: parseIncidentHistory(nextHistoryJson),
      },
      notifiedReporters,
    });
  } catch (error) {
    console.error('Error in PATCH /api/admin/incidents/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo actualizar la incidencia.' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireAdminSession();
  if (!auth.authorized) return auth.response;

  try {
    const incidentId = decodeURIComponent(params.id).trim();
    const db = await getDb();
    const res = await db.execute(
      `DELETE FROM incidents WHERE id = $1 AND municipality_id = $2`,
      [incidentId, auth.session.municipalityId]
    );
    if (res.changes === 0) {
      return NextResponse.json({ error: 'Incidencia no encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Error in DELETE /api/admin/incidents/[id]:', error);
    return NextResponse.json(
      { error: 'No se pudo eliminar la incidencia.' },
      { status: 500 }
    );
  }
}
