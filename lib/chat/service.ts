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
import { hasImmediateDangerKeywords } from '@/lib/ai/classifier';

export type ChatChannel = 'WEB' | 'WHATSAPP';

export interface SourceDetail {
  filename: string;
  sourceUrl: string | null;
  dateLabel: string | null;
}

export interface ChatInput {
  municipalityId: string;
  message: string;
  history?: ChatHistoryMessage[];
  lang?: string;
  channel?: ChatChannel;
}

export interface ChatResult {
  consultationId: string;
  answer: string;
  providerUsed: string;
  tokensSaved: boolean;
  inputTokens: number;
  outputTokens: number;
  usedRag: boolean;
  sources: string[];
  sourceDetails: SourceDetail[];
  fallbackTriggered: boolean;
  suggestIncident: boolean;
  prefillDescription: string | null;
  suggestHumanEscalation: boolean;
  emergency112Alert: boolean;
  municipalityName: string;
}

const SUPPORTED_LANGS = ['es', 'en', 'fr', 'ar'];

const LANG_NAMES: Record<string, string> = {
  es: 'español',
  en: 'English',
  fr: 'français',
  ar: 'العربية',
};

const STRONG_PROBLEM =
  /(bache|socavon|farola|alumbrado|fuga|alcantarilla|inundacion|charco|cable|tuberia|averia|pothole|streetlight|leak|nid de poule|lampadaire|fuite)/;
const WEAK_PROBLEM =
  /(basura|contenedor|rama|arbol|luz|agua|banco|papelera|acera|garbage|trash|tree|water|light|poubelle|arbre)/;
const REPORT_CUE =
  /(hay |esta |estan |roto|rota|rotos|lleno|desbordad|caid|apagad|sin |no funciona|sucio|huele|problema|aviso|avisar|denunc|there is|broken|fallen|overflow|not working|cassé|tombé|il y a)/;
const HUMAN_ESCALATION_CUE =
  /(hablar con una persona|persona real|agente humano|atencion personal|mi expediente|recurso de alzada|litigio|abogado|multa personal|datos fiscales|speak to a person|human agent|parler a quelqu)/;

function detectIncident(message: string): boolean {
  const norm = normalizeQuestion(message);
  if (STRONG_PROBLEM.test(norm)) return true;
  return WEAK_PROBLEM.test(norm) && REPORT_CUE.test(norm + ' ');
}

function detectHumanEscalationCue(message: string): boolean {
  const norm = normalizeQuestion(message);
  return HUMAN_ESCALATION_CUE.test(norm);
}

function detectTopic(message: string): string {
  const norm = normalizeQuestion(message);
  if (/(ayuda|subvencion|bono|beca|descuento|bonificacion|grant)/.test(norm)) return 'Ayudas';
  if (/(ibi|impuesto|tasa|pago|fiscal|tax)/.test(norm)) return 'Impuestos';
  if (/(basura|residuo|reciclaje|mueble|enseres|recogida|waste)/.test(norm)) return 'Residuos';
  if (/(horario|cita|empadron|certificado|tramite|registro|opening|hours)/.test(norm))
    return 'Trámites';
  if (/sol-\d+/.test(norm)) return 'Seguimiento';
  return 'General';
}

async function recordConsultation(args: {
  id: string;
  municipalityId: string;
  question: string;
  answer: string;
  topic: string;
  lang: string;
  channel: ChatChannel;
  tokensSaved: boolean;
  providerUsed: string;
  ragDocIds?: string[];
  inputTokens?: number;
  outputTokens?: number;
  escalatedToHuman?: boolean;
}): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO consultations (
       id, municipality_id, question, answer, topic, lang, channel,
       tokens_saved, provider_used, rag_doc_ids_json, input_tokens, output_tokens, escalated_to_human
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      args.id,
      args.municipalityId,
      args.question,
      args.answer,
      args.topic,
      args.lang,
      args.channel,
      args.tokensSaved ? 1 : 0,
      args.providerUsed,
      JSON.stringify(args.ragDocIds ?? []),
      args.inputTokens ?? 0,
      args.outputTokens ?? 0,
      args.escalatedToHuman ? 1 : 0,
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
  const consultationId = `cons-${crypto.randomUUID()}`;
  const emergency112Alert = hasImmediateDangerKeywords(message);

  const base = {
    consultationId,
    municipalityName: municipality.name,
    sources: [] as string[],
    sourceDetails: [] as SourceDetail[],
    usedRag: false,
    inputTokens: 0,
    outputTokens: 0,
    fallbackTriggered: false,
    suggestIncident: false,
    prefillDescription: null as string | null,
    suggestHumanEscalation: false,
    emergency112Alert,
  };

  // 1. Router local de intenciones (0 tokens)
  const intent = await detectZeroTokenIntent(municipality.id, message, lang);
  if (intent.matched && intent.answer) {
    await recordConsultation({
      id: consultationId,
      municipalityId: municipality.id,
      question: message,
      answer: intent.answer,
      topic,
      lang,
      channel,
      tokensSaved: true,
      providerUsed: 'LOCAL_INTENT',
      inputTokens: 0,
      outputTokens: 0,
    });
    return {
      ...base,
      answer: intent.answer,
      providerUsed: 'LOCAL_INTENT',
      tokensSaved: true,
    };
  }

  // 2. Caché FAQ (0 tokens)
  const cached = await checkFaqCache(municipality.id, message, lang);
  if (cached.hit && cached.answer) {
    await recordConsultation({
      id: consultationId,
      municipalityId: municipality.id,
      question: message,
      answer: cached.answer,
      topic,
      lang,
      channel,
      tokensSaved: true,
      providerUsed: 'FAQ_CACHE',
      inputTokens: 0,
      outputTokens: 0,
    });
    return {
      ...base,
      answer: cached.answer,
      providerUsed: 'FAQ_CACHE',
      tokensSaved: true,
    };
  }

  // 3. RAG: Top-3 fragmentos oficiales vigentes (<= 1800 caracteres)
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
    `Si no tienes datos suficientes, indícalo y sugiere hablar con atención ciudadana.`;

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

  // 5. Detección de avería / problema urbano y necesidad de escalado a persona
  const suggestIncident = detectIncident(message);
  const explicitHuman = detectHumanEscalationCue(message);
  const suggestHumanEscalation = explicitHuman || chunks.length === 0;

  let finalAnswer = ai.text;
  if (emergency112Alert) {
    finalAnswer = `⚠️ Peligro inmediato: llama al 112 ahora mismo (Policía Local / Emergencias).\n\n${finalAnswer}`;
  }

  // 6. Registro en consultations con input_tokens y output_tokens
  await recordConsultation({
    id: consultationId,
    municipalityId: municipality.id,
    question: message,
    answer: finalAnswer,
    topic,
    lang,
    channel,
    tokensSaved: false,
    providerUsed: ai.providerUsed,
    ragDocIds: Array.from(new Set(chunks.map((c) => c.documentId))),
    inputTokens: ai.inputTokens,
    outputTokens: ai.outputTokens,
    escalatedToHuman: explicitHuman,
  });

  if (!suggestIncident && chunks.length > 0 && !explicitHuman) {
    await saveFaqCache(municipality.id, message, lang, finalAnswer);
  }

  const seenFiles = new Set<string>();
  const sourceDetails: SourceDetail[] = [];
  for (const ch of chunks) {
    if (seenFiles.has(ch.filename)) continue;
    seenFiles.add(ch.filename);
    sourceDetails.push({
      filename: ch.filename,
      sourceUrl: ch.sourceUrl ?? null,
      dateLabel: ch.validUntil
        ? `Vigente hasta ${ch.validUntil}`
        : ch.createdAt
        ? ch.createdAt.slice(0, 10)
        : null,
    });
  }

  return {
    ...base,
    answer: finalAnswer,
    providerUsed: ai.providerUsed,
    tokensSaved: false,
    inputTokens: ai.inputTokens,
    outputTokens: ai.outputTokens,
    usedRag: chunks.length > 0,
    sources: Array.from(seenFiles),
    sourceDetails,
    fallbackTriggered: ai.fallbackTriggered,
    suggestIncident,
    prefillDescription: suggestIncident ? message : null,
    suggestHumanEscalation,
  };
}
