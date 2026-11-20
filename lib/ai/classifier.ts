import { classifyLocally, runAITask } from '@/lib/ai/router';

export const INCIDENT_CATEGORIES = [
  'Alumbrado',
  'Limpieza y Basura',
  'Baches y Vía Pública',
  'Agua y Averías',
  'Parques y Jardines',
  'Otros',
] as const;

export const INCIDENT_URGENCIES = [
  'BAJA',
  'MEDIA',
  'ALTA',
  'URGENTE',
  'EMERGENCIA_112',
] as const;

export const INCIDENT_DEPARTMENTS = [
  'Electricidad',
  'Limpieza Viaria',
  'Obras y Urbanismo',
  'Aguas y Mantenimiento',
  'Medio Ambiente',
  'Atención Ciudadana',
  'Policía Local',
  'Deportes',
  'Fiestas',
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];
export type IncidentUrgency = (typeof INCIDENT_URGENCIES)[number];
export type IncidentDepartment = (typeof INCIDENT_DEPARTMENTS)[number];

export interface IncidentClassification {
  title: string;
  category: IncidentCategory;
  urgency: IncidentUrgency;
  department: IncidentDepartment;
  aiReasoning: string;
  providerUsed: string;
  fallbackTriggered: boolean;
  imageDescription: string | null;
  photoMatchesText: boolean;
  detectedRisk: boolean;
}

const CATEGORY_DEPARTMENT: Record<IncidentCategory, IncidentDepartment> = {
  Alumbrado: 'Electricidad',
  'Limpieza y Basura': 'Limpieza Viaria',
  'Baches y Vía Pública': 'Obras y Urbanismo',
  'Agua y Averías': 'Aguas y Mantenimiento',
  'Parques y Jardines': 'Medio Ambiente',
  Otros: 'Atención Ciudadana',
};

const IMMEDIATE_DANGER_REGEX =
  /(112|incendio|fuego|humo|derrumbe|cable|electro|explosi|herido|inundacion|accidente grave)/i;

const SYSTEM_PROMPT =
  'Eres un clasificador de incidencias urbanas de un ayuntamiento. ' +
  'Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con los campos: ' +
  '{"title","category","urgency","department","aiReasoning","imageDescription","photoMatchesText","detectedRisk"}. ' +
  `category debe ser uno de: ${INCIDENT_CATEGORIES.join(' | ')}. ` +
  `urgency debe ser uno de: ${INCIDENT_URGENCIES.join(' | ')}. ` +
  `department debe ser uno de: ${INCIDENT_DEPARTMENTS.join(' | ')}. ` +
  'photoMatchesText (boolean): true si la imagen coincide con el texto o no hay imagen; false si contradice el texto. ' +
  'detectedRisk (boolean): true si se observa riesgo físico o emergencia.';

function isOneOf<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function normalizeUrgency(raw: unknown): IncidentUrgency | null {
  if (raw === 'CRITICA') return 'URGENTE';
  if (isOneOf(INCIDENT_URGENCIES, raw)) return raw;
  return null;
}

export function hasImmediateDangerKeywords(text: string): boolean {
  const norm = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return IMMEDIATE_DANGER_REGEX.test(norm);
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function localClassification(description: string, hasImage: boolean): Omit<
  IncidentClassification,
  'providerUsed' | 'fallbackTriggered'
> {
  const parsed = extractJson(classifyLocally(description, hasImage)) ?? {};
  const category = isOneOf(INCIDENT_CATEGORIES, parsed.category) ? parsed.category : 'Otros';
  const danger = hasImmediateDangerKeywords(description);
  let urgency = normalizeUrgency(parsed.urgency) ?? 'MEDIA';
  const detectedRisk = Boolean(parsed.detectedRisk) || danger;

  if (danger) {
    urgency = 'EMERGENCIA_112';
  } else if (detectedRisk && (urgency === 'BAJA' || urgency === 'MEDIA')) {
    urgency = 'URGENTE';
  }

  let department: IncidentDepartment = isOneOf(INCIDENT_DEPARTMENTS, parsed.department)
    ? parsed.department
    : CATEGORY_DEPARTMENT[category];

  if (urgency === 'EMERGENCIA_112') {
    department = 'Policía Local';
  }

  return {
    title:
      typeof parsed.title === 'string' && parsed.title
        ? parsed.title.slice(0, 80)
        : 'Incidencia ciudadana',
    category,
    urgency,
    department,
    aiReasoning: typeof parsed.aiReasoning === 'string' ? parsed.aiReasoning : '',
    imageDescription:
      typeof parsed.imageDescription === 'string' ? parsed.imageDescription : null,
    photoMatchesText:
      typeof parsed.photoMatchesText === 'boolean' ? parsed.photoMatchesText : true,
    detectedRisk,
  };
}

export async function classifyIncident({
  municipalityId,
  description,
  imageBase64,
  categoryHint,
}: {
  municipalityId: string;
  description: string;
  imageBase64?: string;
  categoryHint?: string;
}): Promise<IncidentClassification> {
  const promptText = categoryHint
    ? `${description}\n(Tipo indicado por el vecino: ${categoryHint})`
    : description;

  const ai = await runAITask({
    municipalityId,
    featureKey: imageBase64 ? 'VISION' : 'CLASSIFY',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: promptText,
    imageBase64,
  });

  const parsed = extractJson(ai.text);
  const parsedUrgency = parsed ? normalizeUrgency(parsed.urgency) : null;
  if (parsed && isOneOf(INCIDENT_CATEGORIES, parsed.category) && parsedUrgency) {
    const category = parsed.category;
    const danger = hasImmediateDangerKeywords(promptText);
    const detectedRisk = Boolean(parsed.detectedRisk) || danger;
    let urgency: IncidentUrgency = parsedUrgency;
    if (danger) {
      urgency = 'EMERGENCIA_112';
    } else if (detectedRisk && (urgency === 'BAJA' || urgency === 'MEDIA')) {
      urgency = 'URGENTE';
    }

    let department: IncidentDepartment = isOneOf(INCIDENT_DEPARTMENTS, parsed.department)
      ? parsed.department
      : CATEGORY_DEPARTMENT[category];
    if (urgency === 'EMERGENCIA_112') {
      department = 'Policía Local';
    }

    return {
      title:
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim().slice(0, 80)
          : description.slice(0, 80),
      category,
      urgency,
      department,
      aiReasoning:
        typeof parsed.aiReasoning === 'string' ? parsed.aiReasoning.trim().slice(0, 240) : '',
      providerUsed: ai.providerUsed,
      fallbackTriggered: ai.fallbackTriggered,
      imageDescription:
        typeof parsed.imageDescription === 'string'
          ? parsed.imageDescription.slice(0, 240)
          : null,
      photoMatchesText:
        typeof parsed.photoMatchesText === 'boolean' ? parsed.photoMatchesText : true,
      detectedRisk,
    };
  }

  const local = localClassification(promptText, Boolean(imageBase64));
  return {
    ...local,
    title: local.title || description.slice(0, 80),
    providerUsed: 'LOCAL',
    fallbackTriggered: ai.providerUsed !== 'LOCAL' ? true : ai.fallbackTriggered,
  };
}
