import bcrypt from 'bcryptjs';
import type { DbClient } from './index';

interface MunicipalitySeed {
  id: string;
  slug: string;
  name: string;
  province: string;
  centerLat: number;
  centerLng: number;
  streets: string[];
  whatsappPhoneId: string;
  codePrefix: number;
}

const MUNICIPALITIES: MunicipalitySeed[] = [
  {
    id: 'muni-lucainena',
    slug: 'lucainena',
    name: 'Lucainena de las Torres',
    province: 'Almería',
    centerLat: 37.0408,
    centerLng: -2.1995,
    streets: [
      'Calle Real',
      'Plaza del Ayuntamiento',
      'Calle Eras',
      'Calle Horno',
      'Avenida Vía Verde',
    ],
    whatsappPhoneId: '1001001001',
    codePrefix: 100,
  },
  {
    id: 'muni-nijar',
    slug: 'nijar',
    name: 'Níjar',
    province: 'Almería',
    centerLat: 36.9667,
    centerLng: -2.2063,
    streets: [
      'Avenida Federico García Lorca',
      'Plaza de la Glorieta',
      'Calle Carrera',
      'Calle Alfareros',
      'Camino de las Eras',
    ],
    whatsappPhoneId: '2002002002',
    codePrefix: 200,
  },
];

function splitWordsIntoChunks(text: string, wordsPerChunk = 350, overlap = 40): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= wordsPerChunk) {
    return [text.trim()];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + wordsPerChunk, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

async function populateDatabase(db: DbClient): Promise<void> {
  const passwordHash = bcrypt.hashSync('1234', 10);

  for (const m of MUNICIPALITIES) {
    await db.execute(
      `INSERT INTO municipalities (id, slug, name, province, center_lat, center_lng, streets_json, whatsapp_phone_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        m.id,
        m.slug,
        m.name,
        m.province,
        m.centerLat,
        m.centerLng,
        JSON.stringify(m.streets),
        m.whatsappPhoneId,
      ]
    );

    const adminId = `user-admin-${m.slug}`;
    const citizenId = `user-vecino-${m.slug}`;

    await db.execute(
      `INSERT INTO users (id, municipality_id, email, password_hash, name, role, department_name, preferred_lang)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        adminId,
        m.id,
        `admin@${m.slug}.es`,
        passwordHash,
        `Ayuntamiento de ${m.name}`,
        'ADMIN',
        'Alcaldía y Gestión Municipal',
        'es',
      ]
    );

    await db.execute(
      `INSERT INTO users (id, municipality_id, email, password_hash, name, role, department_name, preferred_lang)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        citizenId,
        m.id,
        `vecino@${m.slug}.es`,
        passwordHash,
        m.slug === 'lucainena' ? 'María López García' : 'Antonio Ruiz Martín',
        'CITIZEN',
        null,
        'es',
      ]
    );

    await db.execute(
      `INSERT INTO citizen_profiles (
         user_id, municipality_id, street_name, neighborhood, household_size,
         has_children, large_family, has_seniors_or_dependents, reduced_mobility,
         income_bracket, interests_json, whatsapp_phone, notifications_opt_in
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        citizenId,
        m.id,
        m.streets[2],
        'Centro',
        2,
        0,
        0,
        0,
        0,
        'MEDIUM',
        JSON.stringify(['ayudas', 'cultura', 'obras']),
        m.slug === 'lucainena' ? '+34600112233' : '+34600445566',
        1,
      ]
    );

    const incidentTemplates = [
      {
        title: `Farola apagada en ${m.streets[0]}`,
        description: `Hay dos farolas sin luz junto al número 14 de ${m.streets[0]} desde ayer por la noche.`,
        street: m.streets[0],
        latOff: 0.0007,
        lngOff: -0.0006,
        category: 'Alumbrado',
        urgency: 'ALTA',
        department: 'Electricidad',
        status: 'EN_CURSO',
        reasoning: 'Fallo de alumbrado en vía principal con riesgo nocturno para peatones.',
        upvotes: 5,
        notes: 'Brigada eléctrica asignada para sustitución de luminaria LED.',
        daysAgo: 2,
      },
      {
        title: `Bache profundo en ${m.streets[1]}`,
        description: `Socavón en el firme de ${m.streets[1]} cerca del paso de peatones que dificulta el paso de carritos.`,
        street: m.streets[1],
        latOff: -0.0005,
        lngOff: 0.0008,
        category: 'Baches y Vía Pública',
        urgency: 'URGENTE',
        department: 'Obras y Urbanismo',
        status: 'VISTO',
        reasoning: 'Riesgo de tropiezo y daños en vehículos en zona muy transitada.',
        upvotes: 8,
        notes: 'Señalizado provisionalmente; pendiente de asfaltado en frío.',
        daysAgo: 1,
      },
      {
        title: `Contenedor desbordado en ${m.streets[2]}`,
        description: `El contenedor de envases y cartón en ${m.streets[2]} lleva dos días lleno y hay bolsas fuera.`,
        street: m.streets[2],
        latOff: 0.0011,
        lngOff: 0.0004,
        category: 'Limpieza y Basura',
        urgency: 'MEDIA',
        department: 'Limpieza Viaria',
        status: 'RESUELTO',
        reasoning: 'Acumulación de residuos urbanos que requiere recogida extraordinaria.',
        upvotes: 4,
        notes: 'Vaciado y baldeo realizado por el servicio de limpieza.',
        daysAgo: 5,
      },
      {
        title: `Fuga de agua en fuente de ${m.streets[3]}`,
        description: `Pierde agua continuamente la llave de paso de la fuente situada en ${m.streets[3]}.`,
        street: m.streets[3],
        latOff: -0.0009,
        lngOff: -0.0007,
        category: 'Agua y Averías',
        urgency: 'ALTA',
        department: 'Aguas y Mantenimiento',
        status: 'RECIBIDO',
        reasoning: 'Pérdida continua de agua potable en vía pública.',
        upvotes: 6,
        notes: '',
        daysAgo: 0,
      },
      {
        title: `Ramas bajas en ${m.streets[4]}`,
        description: `Varias ramas de olivo y adelfa invaden la acera en ${m.streets[4]} e impiden el paso cómodo.`,
        street: m.streets[4],
        latOff: 0.0014,
        lngOff: -0.0011,
        category: 'Parques y Jardines',
        urgency: 'BAJA',
        department: 'Medio Ambiente',
        status: 'RESUELTO',
        reasoning: 'Mantenimiento ordinario de arbolado urbano sin peligro inmediato.',
        upvotes: 2,
        notes: 'Poda completada y restos retirados al punto verde.',
        daysAgo: 7,
      },
      {
        title: `Banco deteriorado en ${m.streets[1]}`,
        description: `Uno de los bancos de madera en ${m.streets[1]} tiene una tabla suelta con tornillos visibles.`,
        street: m.streets[1],
        latOff: -0.0003,
        lngOff: 0.0003,
        category: 'Parques y Jardines',
        urgency: 'MEDIA',
        department: 'Obras y Urbanismo',
        status: 'RESUELTO',
        reasoning: 'Mobiliario urbano dañado en zona de descanso vecinal.',
        upvotes: 3,
        notes: 'Tabla sustituida y barnizada por carpintería municipal.',
        daysAgo: 9,
      },
      {
        title: `Señal de tráfico torcida en ${m.streets[0]}`,
        description: `La señal de velocidad reducida en la entrada de ${m.streets[0]} está girada por el viento.`,
        street: m.streets[0],
        latOff: 0.0004,
        lngOff: 0.0012,
        category: 'Baches y Vía Pública',
        urgency: 'MEDIA',
        department: 'Obras y Urbanismo',
        status: 'ASIGNADO',
        reasoning: 'Señalización vial poco visible para conductores.',
        upvotes: 3,
        notes: 'Operarios asignados para revisar anclaje de poste.',
        daysAgo: 3,
      },
      {
        title: `Solicitud de horario ampliado en oficina de ${m.name}`,
        description: `Consulta sobre colocación de rampa portátil para acceso al salón cultural municipal.`,
        street: m.streets[1],
        latOff: -0.0008,
        lngOff: 0.0009,
        category: 'Otros',
        urgency: 'BAJA',
        department: 'Atención Ciudadana',
        status: 'RECIBIDO',
        reasoning: 'Sugerencia ciudadana de accesibilidad en edificio público.',
        upvotes: 2,
        notes: '',
        daysAgo: 1,
      },
    ];

    for (let idx = 0; idx < incidentTemplates.length; idx++) {
      const inc = incidentTemplates[idx];
      const code = `SOL-${m.codePrefix + idx + 1}`;
      const createdAt = new Date(Date.now() - inc.daysAgo * 86400000).toISOString();
      await db.execute(
        `INSERT INTO incidents (
           id, municipality_id, user_id, tracking_code, title, description,
           lat, lng, address_label, category, urgency, department, status,
           ai_reasoning, ai_provider_used, channel, upvotes, internal_notes, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          `inc-${m.slug}-${idx + 1}`,
          m.id,
          idx < 2 ? citizenId : null,
          code,
          inc.title,
          inc.description,
          Number((m.centerLat + inc.latOff).toFixed(6)),
          Number((m.centerLng + inc.lngOff).toFixed(6)),
          inc.street,
          inc.category,
          inc.urgency,
          inc.department,
          inc.status,
          inc.reasoning,
          'LOCAL',
          idx % 4 === 3 ? 'WHATSAPP' : 'WEB',
          inc.upvotes,
          inc.notes,
          createdAt,
          createdAt,
        ]
      );
    }

    const aids = [
      {
        title: 'Bonificación Familia Numerosa (IBI y Tasas)',
        description:
          'Descuento directo en el Impuesto de Bienes Inmuebles (IBI) y en la tasa municipal de basuras para hogares con título de familia numerosa.',
        discount: '50% descuento IBI',
        reqs: { large_family: true, min_household: 4 },
        deadline: '31/12/2026',
      },
      {
        title: 'Bono Transporte Joven y Estudiantes',
        description:
          'Tarjeta subvencionada para desplazamientos interurbanos hacia institutos, FP y Universidad de Almería para familias con menores o estudiantes.',
        discount: '60% en abono bus',
        reqs: { has_children: true, max_income: 'MEDIUM' },
        deadline: '15/10/2026',
      },
      {
        title: 'Descuento Piscina Municipal y Escuelas Deportivas',
        description:
          'Tarifa reducida en bonos de verano de la piscina municipal y actividades deportivas infantiles y familiares.',
        discount: '40% tarifa reducida',
        reqs: { has_children: true },
        deadline: 'Abierta todo el año',
      },
      {
        title: 'Ayuda Municipal al Comedor Escolar',
        description:
          'Beca complementaria del Ayuntamiento para cubrir el coste del comedor y material escolar básico en colegios del municipio.',
        discount: 'Hasta 100% becado',
        reqs: { has_children: true, max_income: 'LOW' },
        deadline: '30/09/2026',
      },
      {
        title: 'Bono Mayores, Teleasistencia y Dependencia',
        description:
          'Servicio gratuito de acompañamiento, prioridad en teleasistencia domiciliaria y descuento en tasa de agua para hogares con mayores o dependientes.',
        discount: 'Gratis + 35% agua',
        reqs: { has_seniors_or_dependents: true },
        deadline: 'Convocatoria permanente',
      },
      {
        title: 'Subvención Accesibilidad y Adaptación de Vivienda',
        description:
          'Ayuda económica para instalación de rampas, barras de apoyo, platos de ducha adaptados y eliminación de barreras arquitectónicas.',
        discount: 'Hasta 1.800 €',
        reqs: { reduced_mobility: true },
        deadline: '15/11/2026',
      },
    ];

    for (let idx = 0; idx < aids.length; idx++) {
      const aid = aids[idx];
      await db.execute(
        `INSERT INTO municipal_aids (
           id, municipality_id, title, description, discount_label, requirements_json, deadline, apply_url, active
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)`,
        [
          `aid-${m.slug}-${idx + 1}`,
          m.id,
          aid.title,
          aid.description,
          aid.discount,
          JSON.stringify(aid.reqs),
          aid.deadline,
          `/asistente?q=${encodeURIComponent(`Cómo solicitar ${aid.title}`)}`,
        ]
      );
    }

    const featuredAlertStreet = m.slug === 'nijar' ? m.streets[2] : m.streets[0];
    const alerts = [
      {
        title: `Corte temporal por mejoras en ${featuredAlertStreet}`,
        message: `Renovación de tubería y pavimentación en ${featuredAlertStreet} de 08:30 a 14:30. Acceso garantizado a residentes a pie y urgencias.`,
        streets: [featuredAlertStreet],
        start: '2026-11-20',
        end: '2026-11-27',
        severity: 'CRITICAL',
      },
      {
        title: `Mercadillo y corte parcial en ${m.streets[1]}`,
        message: `Con motivo del mercadillo semanal y actividades vecinales, ${m.streets[1]} permanecerá peatonal de 08:00 a 15:00 los miércoles y sábados.`,
        streets: [m.streets[1], m.streets[3]],
        start: '2026-11-18',
        end: '2026-12-30',
        severity: 'WARNING',
      },
      {
        title: `Mantenimiento de alumbrado en ${m.streets[4]}`,
        message: `Sustitución de farolas por luminarias LED de bajo consumo en ${m.streets[4]}. Posibles cortes breves de tráfico en un carril.`,
        streets: [m.streets[4]],
        start: '2026-11-19',
        end: '2026-11-29',
        severity: 'INFO',
      },
    ];

    for (let idx = 0; idx < alerts.length; idx++) {
      const alert = alerts[idx];
      await db.execute(
        `INSERT INTO street_alerts (
           id, municipality_id, title, message, affected_streets_json, start_date, end_date, severity
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `alert-${m.slug}-${idx + 1}`,
          m.id,
          alert.title,
          alert.message,
          JSON.stringify(alert.streets),
          alert.start,
          alert.end,
          alert.severity,
        ]
      );
    }

    const docs = [
      {
        filename: `Horarios_y_Tramites_${m.slug}.txt`,
        docType: 'TXT',
        content: `AYUNTAMIENTO DE ${m.name.toUpperCase()} (${m.province}) - GUÍA OFICIAL DE HORARIOS Y TRÁMITES.
Horario de atención ciudadana presencial: lunes a viernes de 09:00 a 14:00 horas en ${m.streets[1]}.
Registro municipal y certificado de empadronamiento: se tramita en el acto presentando DNI o NIE en ventanilla, sin necesidad de cita previa para personas mayores de 65 años. También disponible mediante certificado digital o Cl@ve en la sede electrónica municipal.
Ventanilla única para incidencias urbanas: los vecinos pueden avisar de averías en alumbrado, agua, baches o limpieza mediante AlmeríaCerca web, WhatsApp municipal o teléfono de atención vecinal. El plazo medio de primera revisión es de 24 horas hábiles y las incidencias críticas se atienden en el mismo día.
Calendario fiscal y pagos: el periodo voluntario de IBI urbana y tasa de recogida de residuos se abre del 1 de mayo al 5 de julio, permitiendo fraccionamiento sin intereses en 3 plazos previa solicitud antes del 15 de abril.`,
      },
      {
        filename: `Normativa_Ayudas_y_Residuos_${m.slug}.txt`,
        docType: 'TXT',
        content: `ORDENANZA DE AYUDAS SOCIALES, BONIFICACIONES Y RECOGIDA DE RESIDUOS DE ${m.name.toUpperCase()}.
1. Ayudas y descuentos municipales:
- Bonificación del 50% en el IBI y tasa de basuras para Familias Numerosas empadronadas en ${m.name} con 4 o más integrantes o título vigente. Requisitos: certificado de empadronamiento colectivo y título de familia numerosa.
- Bono Transporte Joven y Estudiantes (60% de descuento): dirigido a menores y estudiantes hasta 26 años de familias con renta baja o media.
- Ayuda al Comedor Escolar (hasta 100%): para hogares con menores escolarizados y tramo de renta reducida.
- Bono Mayores y Dependencia: descuento del 35% en recibo del agua y teleasistencia prioritaria gratuita para mayores de 65 años o personas dependientes.
- Subvención de Accesibilidad en Vivienda (hasta 1.800 euros): destinada a personas con movilidad reducida para adaptar baños o accesos.
2. Recogida de residuos y enseres voluminosos:
La basura orgánica debe depositarse entre las 20:00 y las 23:00 horas en los contenedores más cercanos. La recogida gratuita de muebles y enseres a domicilio se realiza todos los jueves previo aviso en el Ayuntamiento o mediante mensaje en AlmeríaCerca indicando la calle.`,
      },
    ];

    for (let idx = 0; idx < docs.length; idx++) {
      const doc = docs[idx];
      const docId = `doc-${m.slug}-${idx + 1}`;
      const chunks = splitWordsIntoChunks(doc.content, 350, 40);
      await db.execute(
        `INSERT INTO rag_documents (id, municipality_id, filename, doc_type, char_count, chunk_count, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [docId, m.id, doc.filename, doc.docType, doc.content.length, chunks.length, adminId]
      );
      for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
        const chunkId = `${docId}-c${cIdx + 1}`;
        const chunkText = chunks[cIdx];
        await db.execute(
          `INSERT INTO rag_chunks (chunk_id, document_id, municipality_id, filename, content)
           VALUES ($1, $2, $3, $4, $5)`,
          [chunkId, docId, m.id, doc.filename, chunkText]
        );
        await db.execute(
          `INSERT INTO rag_chunks_fts (chunk_id, document_id, municipality_id, filename, content)
           VALUES ($1, $2, $3, $4, $5)`,
          [chunkId, docId, m.id, doc.filename, chunkText]
        );
      }
    }

    const providers = [
      { provider: 'LOCAL', baseUrl: '', enabled: 1 },
      { provider: 'GEMINI', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', enabled: 0 },
      { provider: 'GROQ', baseUrl: 'https://api.groq.com/openai/v1', enabled: 0 },
      { provider: 'OPENAI', baseUrl: 'https://api.openai.com/v1', enabled: 0 },
      { provider: 'OPENROUTER', baseUrl: 'https://openrouter.ai/api/v1', enabled: 0 },
    ];

    for (const p of providers) {
      await db.execute(
        `INSERT INTO ai_provider_keys (id, municipality_id, provider, api_key, base_url, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [`key-${m.slug}-${p.provider.toLowerCase()}`, m.id, p.provider, '', p.baseUrl, p.enabled]
      );
    }

    const aiFeatureDefaults = [
      {
        feature: 'CHAT',
        primaryProvider: 'GEMINI',
        primaryModel: 'gemini-2.0-flash',
        backups: [
          { provider: 'GROQ', model: 'llama-3.3-70b-versatile' },
          { provider: 'LOCAL', model: 'deterministic-v1' },
        ],
        maxTokens: 300,
        temperature: 0.3,
      },
      {
        feature: 'CLASSIFY',
        primaryProvider: 'GEMINI',
        primaryModel: 'gemini-2.0-flash',
        backups: [
          { provider: 'GROQ', model: 'llama-3.3-70b-versatile' },
          { provider: 'LOCAL', model: 'deterministic-v1' },
        ],
        maxTokens: 180,
        temperature: 0.1,
      },
      {
        feature: 'VISION',
        primaryProvider: 'GEMINI',
        primaryModel: 'gemini-2.0-flash',
        backups: [
          { provider: 'OPENAI', model: 'gpt-4o-mini' },
          { provider: 'LOCAL', model: 'deterministic-v1' },
        ],
        maxTokens: 180,
        temperature: 0.1,
      },
    ];

    for (const cfg of aiFeatureDefaults) {
      await db.execute(
        `INSERT INTO ai_configs (id, municipality_id, feature_key, primary_provider, primary_model, backups_json, max_tokens, temperature)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `cfg-${m.slug}-${cfg.feature.toLowerCase()}`,
          m.id,
          cfg.feature,
          cfg.primaryProvider,
          cfg.primaryModel,
          JSON.stringify(cfg.backups),
          cfg.maxTokens,
          cfg.temperature,
        ]
      );
    }
  }
}

export async function seedDatabase(db: DbClient): Promise<void> {
  const existing = await db.queryOne<{ cnt: number }>(
    'SELECT COUNT(*)::int AS cnt FROM municipalities'
  );
  if ((existing?.cnt ?? 0) > 0) {
    return;
  }
  await db.withTransaction(async (tx) => {
    const insideCheck = await tx.queryOne<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM municipalities'
    );
    if ((insideCheck?.cnt ?? 0) > 0) return;
    await populateDatabase(tx);
  });
}

export async function resetDatabase(db: DbClient): Promise<void> {
  await db.withTransaction(async (tx) => {
    await tx.execute('DELETE FROM faq_cache');
    await tx.execute('DELETE FROM user_notifications');
    await tx.execute('DELETE FROM street_alerts');
    await tx.execute('DELETE FROM municipal_aids');
    await tx.execute('DELETE FROM ai_configs');
    await tx.execute('DELETE FROM ai_provider_keys');
    await tx.execute('DELETE FROM rag_chunks_fts');
    await tx.execute('DELETE FROM rag_chunks');
    await tx.execute('DELETE FROM rag_documents');
    await tx.execute('DELETE FROM consultations');
    await tx.execute('DELETE FROM incidents');
    await tx.execute('DELETE FROM citizen_profiles');
    await tx.execute('DELETE FROM users');
    await tx.execute('DELETE FROM municipalities');
    await populateDatabase(tx);
  });
}
