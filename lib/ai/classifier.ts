import { classifyLocally, runAITask } from '@/lib/ai/router';

export const INCIDENT_CATEGORIES = [
  'Alumbrado',
  'Limpieza y Basura',
  'Baches y Vía Pública',
  'Agua y Averías',
  'Parques y Jardines',
  'Otros',
] as const;

export const INCIDENT_URGENCIES = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const;

export const INCIDENT_DEPARTMENTS = [
  'Electricidad',
  'Limpieza Viaria',
  'Obras y Urbanismo',
  'Aguas y Mantenimiento',
  'Medio Ambiente',
  'Atención Ciudadana',
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
}

const CATEGORY_DEPARTMENT: Record<IncidentCategory, IncidentDepartment> = {
  Alumbrado: 'Electricidad',
  'Limpieza y Basura': 'Limpieza Viaria',
  'Baches y Vía Pública': 'Obras y Urbanismo',
  'Agua y Averías': 'Aguas y Mantenimiento',
  'Parques y Jardines': 'Medio Ambiente',
  Otros: 'Atención Ciudadana',
};

const SYSTEM_PROMPT =
  'Eres un clasificador de incidencias urbanas de un ayuntamiento. ' +
  'Responde ÚNICAMENTE con un objeto JSON válido, sin texto adicional, con los campos: ' +
  '{"title","category","urgency","department","aiReasoning"}. ' +
  `category debe ser uno de: ${INCIDENT_CATEGORIES.join(' | ')}. ` +
  `urgency debe ser uno de: ${INCIDENT_URGENCIES.join(' | ')}. ` +
  `department debe ser uno de: ${INCIDENT_DEPARTMENTS.join(' | ')}. ` +
  'title: máximo 80 caracteres. aiReasoning: una frase breve que justifique la urgencia.';

function isOneOf<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
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
  return {
    title: typeof parsed.title === 'string' && parsed.title ? parsed.title.slice(0, 80) : 'Incidencia ciudadana',
    category,
    urgency: isOneOf(INCIDENT_URGENCIES, parsed.urgency) ? parsed.urgency : 'MEDIA',
    department: isOneOf(INCIDENT_DEPARTMENTS, parsed.department)
      ? parsed.department
      : CATEGORY_DEPARTMENT[category],
    aiReasoning: typeof parsed.aiReasoning === 'string' ? parsed.aiReasoning : '',
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
  const promptText = categoryHint ? `${description}\n(Tipo indicado por el vecino: ${categoryHint})` : description;

  const ai = await runAITask({
    municipalityId,
    featureKey: imageBase64 ? 'VISION' : 'CLASSIFY',
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: promptText,
    imageBase64,
  });

  const parsed = extractJson(ai.text);
  if (
    parsed &&
    isOneOf(INCIDENT_CATEGORIES, parsed.category) &&
    isOneOf(INCIDENT_URGENCIES, parsed.urgency)
  ) {
    const category = parsed.category;
    return {
      title:
        typeof parsed.title === 'string' && parsed.title.trim()
          ? parsed.title.trim().slice(0, 80)
          : description.slice(0, 80),
      category,
      urgency: parsed.urgency,
      department: isOneOf(INCIDENT_DEPARTMENTS, parsed.department)
        ? parsed.department
        : CATEGORY_DEPARTMENT[category],
      aiReasoning:
        typeof parsed.aiReasoning === 'string' ? parsed.aiReasoning.trim().slice(0, 240) : '',
      providerUsed: ai.providerUsed,
      fallbackTriggered: ai.fallbackTriggered,
    };
  }

  // JSON inválido o motor LOCAL: clasificador determinista por palabras clave
  const local = localClassification(promptText, Boolean(imageBase64));
  return {
    ...local,
    title: local.title || description.slice(0, 80),
    providerUsed: 'LOCAL',
    fallbackTriggered: ai.providerUsed !== 'LOCAL' ? true : ai.fallbackTriggered,
  };
}
