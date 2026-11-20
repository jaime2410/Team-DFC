import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';

export const dynamic = 'force-dynamic';

interface StreetAlertRow {
  id: string;
  title: string;
  message: string;
  affected_streets_json: string;
  start_date: string;
  end_date: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  created_at: string;
}

interface AidRow {
  id: string;
  title: string;
  description: string;
  discount_label: string;
  requirements_json: string;
  deadline: string | null;
  apply_url: string | null;
}

interface ResolvedIncidentRow {
  id: string;
  tracking_code: string;
  title: string;
  description: string;
  address_label: string | null;
  category: string;
  department: string;
  status: string;
  upvotes: number;
  internal_notes: string | null;
  resolved_photo_url: string | null;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  try {
    const municipalityParam = request.nextUrl.searchParams.get('municipalityId');
    const db = await getDb();
    const municipality = await resolveMunicipality(db, municipalityParam);

    if (!municipality) {
      return NextResponse.json(
        { error: 'Municipality not found' },
        { status: 404 }
      );
    }

    const alertRows = await db.query<StreetAlertRow>(
      `SELECT id, title, message, affected_streets_json, start_date, end_date, severity, created_at
       FROM street_alerts
       WHERE municipality_id = $1
       ORDER BY created_at DESC`,
      [municipality.id]
    );

    const streetAlerts = alertRows.map((row) => {
      let affectedStreets: string[] = [];
      try {
        affectedStreets = JSON.parse(row.affected_streets_json) as string[];
      } catch {
        affectedStreets = [];
      }
      return {
        id: row.id,
        title: row.title,
        message: row.message,
        affectedStreets,
        startDate: row.start_date,
        endDate: row.end_date,
        severity: row.severity,
      };
    });

    const aidRows = await db.query<AidRow>(
      `SELECT id, title, description, discount_label, requirements_json, deadline, apply_url
       FROM municipal_aids
       WHERE municipality_id = $1 AND active = 1
       ORDER BY created_at DESC`,
      [municipality.id]
    );

    const municipalAids = aidRows.map((row) => {
      let requirements: Record<string, unknown> = {};
      try {
        requirements = JSON.parse(row.requirements_json) as Record<string, unknown>;
      } catch {
        requirements = {};
      }
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        discountLabel: row.discount_label,
        requirements,
        deadline: row.deadline,
        applyUrl: row.apply_url,
      };
    });

    const resolvedRows = await db.query<ResolvedIncidentRow>(
      `SELECT id, tracking_code, title, description, address_label, category, department,
              status, upvotes, internal_notes, resolved_photo_url, updated_at
       FROM incidents
       WHERE municipality_id = $1
         AND status IN ('RESUELTO', 'RESUELTA')
         AND COALESCE(is_quarantined, 0) = 0
       ORDER BY updated_at DESC
       LIMIT 8`,
      [municipality.id]
    );

    const resolvedIncidents = resolvedRows.map((row) => ({
      id: row.id,
      trackingCode: row.tracking_code,
      title: row.title,
      description: row.description,
      addressLabel: row.address_label,
      category: row.category,
      department: row.department,
      upvotes: row.upvotes,
      internalNotes: row.internal_notes,
      resolvedPhotoUrl: row.resolved_photo_url,
      updatedAt: row.updated_at,
    }));

    const sampleRows = await db.query<{ tracking_code: string }>(
      `SELECT tracking_code
       FROM incidents
       WHERE municipality_id = $1
       ORDER BY tracking_code ASC
       LIMIT 3`,
      [municipality.id]
    );

    const mainSquare = municipality.streets[1] || municipality.streets[0] || 'Ayuntamiento';

    const infoCards = [
      {
        id: `info-${municipality.slug}-1`,
        title: `Horarios y Empadronamiento en ${municipality.name}`,
        summary: `Atención presencial de lunes a viernes (09:00 a 14:00) en ${mainSquare}. Certificado de empadronamiento en el acto con DNI o NIE.`,
        tag: 'Atención Vecinal',
        details: `Para mayores de 65 años no hace falta cita previa. También puedes consultar trámites y certificados digitales desde el asistente de ${municipality.name}.`,
      },
      {
        id: `info-${municipality.slug}-2`,
        title: 'Recogida Gratuita de Muebles y Enseres',
        summary: 'Servicio municipal todos los jueves sin coste. Basura orgánica diaria de 20:00 a 23:00.',
        tag: 'Limpieza y Punto Limpio',
        details: `Si necesitas retirar un colchón, mueble o electrodoméstico en ${municipality.name}, avisa antes del miércoles indicando tu calle para que pasen a recogerlo.`,
      },
      {
        id: `info-${municipality.slug}-3`,
        title: 'Pago Fácil de IBI y Tasas Municipales',
        summary: 'Periodo voluntario del 1 de mayo al 5 de julio con opción de fraccionar en 3 cuotas sin intereses.',
        tag: 'Calendario Fiscal',
        details: `Las familias numerosas empadronadas en ${municipality.name} disponen de bonificación directa del 50% en el IBI y tasa de basuras.`,
      },
    ];

    return NextResponse.json({
      municipality: {
        id: municipality.id,
        slug: municipality.slug,
        name: municipality.name,
        province: municipality.province,
      },
      streetAlerts,
      municipalAids,
      resolvedIncidents,
      infoCards,
      sampleCodes: sampleRows.map((r) => r.tracking_code),
    });
  } catch (error) {
    console.error('Error loading public board:', error);
    return NextResponse.json(
      { error: 'Failed to load public board' },
      { status: 500 }
    );
  }
}
