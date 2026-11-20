import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { retrieveContext } from '@/lib/rag/fts';
import {
  checkFaqCache,
  detectZeroTokenIntent,
  normalizeQuestion,
  saveFaqCache,
  trimHistory,
} from '@/lib/ai/tokenSaver';
import { runAITask, type ChatHistoryMessage } from '@/lib/ai/router';

export type ChatChannel = 'WEB' | 'WHATSAPP';

export interface ChatInput {
  municipalityId: string;
  message: string;
  history?: ChatHistoryMessage[];
  lang?: string;
  channel?: ChatChannel;
}

export interface ChatResult {
  answer: string;
  providerUsed: string;
  tokensSaved: boolean;
  usedRag: boolean;
  sources: string[];
  fallbackTriggered: boolean;
  suggestIncident: boolean;
  prefillDescription: string | null;
  municipalityName: string;
}

const SUPPORTED_LANGS = ['es', 'en', 'fr', 'ar'];

const LANG_NAMES: Record<string, string> = {
  es: 'español',
  en: 'English',
  fr: 'français',
  ar: 'العربية',
};

const STRONG_PROBLEM = /(bache|socavon|farola|alumbrado|fuga|alcantarilla|inundacion|charco|cable|tuberia|averia|pothole|streetlight|leak|nid de poule|lampadaire|fuite)/;
const WEAK_PROBLEM = /(basura|contenedor|rama|arbol|luz|agua|banco|papelera|acera|garbage|trash|tree|water|light|poubelle|arbre)/;
const REPORT_CUE = /(hay |esta |estan |roto|rota|rotos|lleno|desbordad|caid|apagad|sin |no funciona|sucio|huele|problema|aviso|avisar|denunc|there is|broken|fallen|overflow|not working|cassé|tombé|il y a)/;

function detectIncident(message: string): boolean {
  const norm = normalizeQuestion(message);
  if (STRONG_PROBLEM.test(norm)) return true;
  return WEAK_PROBLEM.test(norm) && REPORT_CUE.test(norm + ' ');
}

function detectTopic(message: string): string {
  const norm = normalizeQuestion(message);
  if (/(ayuda|subvencion|bono|beca|descuento|bonificacion|grant)/.test(norm)) return 'Ayudas';
  if (/(ibi|impuesto|tasa|pago|fiscal|tax)/.test(norm)) return 'Impuestos';
  if (/(basura|residuo|reciclaje|mueble|enseres|recogida|waste)/.test(norm)) return 'Residuos';
  if (/(horario|cita|empadron|certificado|tramite|registro|opening|hours)/.test(norm)) return 'Trámites';
  if (/sol-\d+/.test(norm)) return 'Seguimiento';
  return 'General';
}

async function recordConsultation(args: {
  municipalityId: string;
  question: string;
  answer: string;
  topic: string;
  lang: string;
  channel: ChatChannel;
  tokensSaved: boolean;
  providerUsed: string;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO consultations (id, municipality_id, question, answer, topic, lang, channel, tokens_saved, provider_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      `cons-${crypto.randomUUID()}`,
      args.municipalityId,
      args.question,
      args.answer,
      args.topic,
      args.lang,
      args.channel,
      args.tokensSaved ? 1 : 0,
      args.providerUsed,
    ]
  );
}

export async function processChatMessage(input: ChatInput): Promise<ChatResult> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, input.municipalityId);
  if (!municipality) {
    throw new Error('Municipio no encontrado.');
  }

  const message = input.message.trim().slice(0, 1000);
  const lang = SUPPORTED_LANGS.includes(input.lang ?? '') ? (input.lang as string) : 'es';
  const channel: ChatChannel = input.channel === 'WHATSAPP' ? 'WHATSAPP' : 'WEB';
  const topic = detectTopic(message);

  const base = {
    municipalityName: municipality.name,
    sources: [] as string[],
    usedRag: false,
    fallbackTriggered: false,
    suggestIncident: false,
    prefillDescription: null as string | null,
  };

  // 1. Router local de intenciones (0 tokens)
  const intent = await detectZeroTokenIntent(municipality.id, message, lang);
  if (intent.matched && intent.answer) {
    await recordConsultation({
      municipalityId: municipality.id,
      question: message,
      answer: intent.answer,
      topic,
      lang,
      channel,
      tokensSaved: true,
      providerUsed: 'LOCAL_INTENT',
    });
    return { ...base, answer: intent.answer, providerUsed: 'LOCAL_INTENT', tokensSaved: true };
  }

  // 2. Caché FAQ (0 tokens)
  const cached = await checkFaqCache(municipality.id, message, lang);
  if (cached.hit && cached.answer) {
    await recordConsultation({
      municipalityId: municipality.id,
      question: message,
      answer: cached.answer,
      topic,
      lang,
      channel,
      tokensSaved: true,
      providerUsed: 'FAQ_CACHE',
    });
    return { ...base, answer: cached.answer, providerUsed: 'FAQ_CACHE', tokensSaved: true };
  }

  // 3. RAG: Top-3 fragmentos oficiales (<= 1800 caracteres)
  const chunks = await retrieveContext({
    municipalityId: municipality.id,
    query: message,
    topK: 3,
    maxChars: 1800,
  });

  const contextBlock =
    chunks.length > 0
      ? chunks.map((c, i) => `[Fuente ${i + 1}: ${c.filename}]\n${c.content}`).join('\n\n')
      : 'No hay documentos oficiales relevantes para esta consulta.';

  // 4. Llamada a IA con ventana deslizante y límites estrictos
  const systemPrompt =
    `Eres el asistente virtual del Ayuntamiento de ${municipality.name} (${municipality.province}). ` +
    `Responde de forma clara, breve y cercana, en el idioma "${LANG_NAMES[lang]}", ` +
    `basándote solo en el contexto oficial del municipio. Cita el documento fuente cuando aplique. ` +
    `Si no tienes datos suficientes, indícalo y sugiere acudir al Ayuntamiento.`;

  const userPrompt = `CONTEXTO OFICIAL:\n${contextBlock}\n\nPREGUNTA DEL VECINO:\n${message}`;

  const ai = await runAITask({
    municipalityId: municipality.id,
    featureKey: 'CHAT',
    systemPrompt,
    userPrompt: chunks.length > 0 ? userPrompt : message,
    history: trimHistory(input.history ?? [], 4),
    ragChunks: chunks,
    lang,
  });

  // 5. Detección de avería / problema urbano
  const suggestIncident = detectIncident(message);

  // 6. Registro en consultations y guardado en faq_cache (solo consultas informativas)
  await recordConsultation({
    municipalityId: municipality.id,
    question: message,
    answer: ai.text,
    topic,
    lang,
    channel,
    tokensSaved: false,
    providerUsed: ai.providerUsed,
  });

  if (!suggestIncident) {
    await saveFaqCache(municipality.id, message, lang, ai.text);
  }

  return {
    ...base,
    answer: ai.text,
    providerUsed: ai.providerUsed,
    tokensSaved: false,
    usedRag: chunks.length > 0,
    sources: Array.from(new Set(chunks.map((c) => c.filename))),
    fallbackTriggered: ai.fallbackTriggered,
    suggestIncident,
    prefillDescription: suggestIncident ? message : null,
  };
}
