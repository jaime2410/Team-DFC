import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';

export interface FaqCacheResult {
  hit: boolean;
  normalizedQuestion: string;
  answer?: string;
  hits?: number;
}

export interface ZeroTokenIntentResult {
  matched: boolean;
  intent?: 'TRACK_INCIDENT' | 'GREETING';
  answer?: string;
}

interface FaqRow {
  id: string;
  answer: string;
  hits: number;
}

interface IncidentLookupRow {
  tracking_code: string;
  title: string;
  status: 'PENDIENTE' | 'EN_REVISION' | 'EN_CURSO' | 'RESUELTA';
  department: string;
  address_label: string | null;
  urgency: string;
  internal_notes: string | null;
}

const GREETING_PHRASES = new Set([
  'hola',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'buenas',
  'saludos',
  'hey',
  'hello',
  'hi',
  'good morning',
  'good afternoon',
  'bonjour',
  'salut',
  'bonsoir',
  'gracias',
  'muchas gracias',
  'thank you',
  'thanks',
  'merci',
  'مرحبا',
  'اهلا',
  'السلام عليكم',
  'شكرا',
]);

const STATUS_LABELS: Record<string, Record<string, string>> = {
  es: {
    PENDIENTE: 'Recibido (pendiente de revisión)',
    EN_REVISION: 'En revisión por el equipo técnico',
    EN_CURSO: 'En curso de reparación',
    RESUELTA: 'Resuelto',
  },
  en: {
    PENDIENTE: 'Received (pending review)',
    EN_REVISION: 'Under review by the municipal team',
    EN_CURSO: 'In progress',
    RESUELTA: 'Resolved',
  },
  fr: {
    PENDIENTE: 'Reçu (en attente)',
    EN_REVISION: 'En cours d’examen',
    EN_CURSO: 'Intervention en cours',
    RESUELTA: 'Résolu',
  },
  ar: {
    PENDIENTE: 'تم الاستلام (قيد الانتظار)',
    EN_REVISION: 'قيد المراجعة الفنية',
    EN_CURSO: 'قيد التنفيذ',
    RESUELTA: 'تم الحل',
  },
};

export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()\[\]{}"'`~@#$%^&*_+=<>\/\\|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function checkFaqCache(
  municipalityId: string,
  question: string,
  lang = 'es'
): Promise<FaqCacheResult> {
  const normalizedQuestion = normalizeQuestion(question);
  if (!normalizedQuestion) {
    return { hit: false, normalizedQuestion: '' };
  }

  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) {
    return { hit: false, normalizedQuestion };
  }

  const row = await db.queryOne<FaqRow>(
    `SELECT id, answer, hits
     FROM faq_cache
     WHERE municipality_id = $1 AND normalized_question = $2 AND lang = $3
     LIMIT 1`,
    [municipality.id, normalizedQuestion, lang]
  );

  if (!row) {
    return { hit: false, normalizedQuestion };
  }

  await db.execute(`UPDATE faq_cache SET hits = hits + 1 WHERE id = $1`, [row.id]);

  return {
    hit: true,
    normalizedQuestion,
    answer: row.answer,
    hits: row.hits + 1,
  };
}

export async function saveFaqCache(
  municipalityId: string,
  question: string,
  lang: string,
  answer: string
): Promise<void> {
  const normalizedQuestion = normalizeQuestion(question);
  const cleanAnswer = answer.trim();
  if (!normalizedQuestion || !cleanAnswer) return;

  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) return;

  await db.execute(
    `INSERT INTO faq_cache (id, municipality_id, normalized_question, lang, answer, hits)
     VALUES ($1, $2, $3, $4, $5, 1)
     ON CONFLICT (municipality_id, normalized_question, lang)
     DO UPDATE SET answer = EXCLUDED.answer`,
    [`faq-${crypto.randomUUID()}`, municipality.id, normalizedQuestion, lang, cleanAnswer]
  );
}

export async function detectZeroTokenIntent(
  municipalityId: string,
  message: string,
  lang = 'es'
): Promise<ZeroTokenIntentResult> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) {
    return { matched: false };
  }

  // 1. Búsqueda directa por código SOL-XXX sin gastar tokens
  const codeMatch = message.match(/\b(SOL-\d+)\b/i);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const incident = await db.queryOne<IncidentLookupRow>(
      `SELECT tracking_code, title, status, department, address_label, urgency, internal_notes
       FROM incidents
       WHERE UPPER(tracking_code) = $1 AND municipality_id = $2
       LIMIT 1`,
      [code, municipality.id]
    );

    if (!incident) {
      const notFoundMap: Record<string, string> = {
        es: `No encuentro el aviso ${code} en ${municipality.name}. Revisa el código o cambia de municipio arriba si pertenece a otro pueblo.`,
        en: `I could not find report ${code} in ${municipality.name}. Please double-check the code or active town.`,
        fr: `Je ne trouve pas le signalement ${code} à ${municipality.name}. Vérifiez le code ou la commune sélectionnée.`,
        ar: `لم أجد البلاغ رقم ${code} في ${municipality.name}. تأكد من الرمز أو من البلدية المختارة.`,
      };
      return {
        matched: true,
        intent: 'TRACK_INCIDENT',
        answer: notFoundMap[lang] ?? notFoundMap.es,
      };
    }

    const langLabels = STATUS_LABELS[lang] ?? STATUS_LABELS.es;
    const statusText = langLabels[incident.status] ?? incident.status;
    const noteText = incident.internal_notes
      ? ` ${incident.internal_notes}`
      : '';

    const foundMap: Record<string, string> = {
      es: `El aviso ${incident.tracking_code} ("${incident.title}") está en estado: ${statusText}. Equipo asignado: ${incident.department}${incident.address_label ? ` (${incident.address_label})` : ''}.${noteText}`,
      en: `Report ${incident.tracking_code} ("${incident.title}") is currently: ${statusText}. Assigned team: ${incident.department}.${noteText}`,
      fr: `Le signalement ${incident.tracking_code} (« ${incident.title} ») est au statut : ${statusText}. Service : ${incident.department}.${noteText}`,
      ar: `البلاغ ${incident.tracking_code} ("${incident.title}") حالته الآن: ${statusText}. القسم المختص: ${incident.department}.${noteText}`,
    };

    return {
      matched: true,
      intent: 'TRACK_INCIDENT',
      answer: foundMap[lang] ?? foundMap.es,
    };
  }

  // 2. Saludos o cortesía breves (sin consulta real detrás)
  const normalized = normalizeQuestion(message);
  const words = normalized ? normalized.split(' ') : [];
  if (words.length > 0 && words.length <= 4 && GREETING_PHRASES.has(normalized)) {
    const greetingMap: Record<string, string> = {
      es: `¡Hola! Soy el asistente de ${municipality.name}. Pregúntame sobre horarios, empadronamiento, ayudas municipales o escribe un código como SOL-101.`,
      en: `Hello! I am the ${municipality.name} Town Hall assistant. Ask me about opening hours, registration, local grants, or check a code like SOL-101.`,
      fr: `Bonjour ! Je suis l'assistant de la mairie de ${municipality.name}. Posez-moi vos questions sur les horaires, démarches, aides ou suivez un code comme SOL-101.`,
      ar: `مرحباً! أنا مساعد بلدية ${municipality.name}. اسألني عن المواعيد أو التسجيل أو المساعدات البلدية أو اكتب رمز متابعة مثل SOL-101.`,
    };
    return {
      matched: true,
      intent: 'GREETING',
      answer: greetingMap[lang] ?? greetingMap.es,
    };
  }

  return { matched: false };
}

export function trimHistory<T>(history: T[], maxTurns = 4): T[] {
  if (!Array.isArray(history) || maxTurns <= 0) return [];
  return history.slice(-maxTurns);
}
