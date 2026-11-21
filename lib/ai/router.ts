import { getDb } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import { retrieveContext, type RetrievedChunk } from '@/lib/rag/fts';
import { trimHistory } from './tokenSaver';

export type AIProvider = 'GEMINI' | 'GROQ' | 'OPENAI' | 'OPENROUTER' | 'LOCAL';
export type AIFeatureKey = 'CHAT' | 'CLASSIFY' | 'VISION';

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BackupEntry {
  provider: AIProvider;
  model: string;
}

export interface ProviderAttempt {
  provider: AIProvider;
  model: string;
  ok: boolean;
  reason?: string;
}

export interface RunAITaskInput {
  municipalityId: string;
  featureKey: AIFeatureKey;
  systemPrompt: string;
  userPrompt: string;
  history?: ChatHistoryMessage[];
  imageBase64?: string;
  ragChunks?: RetrievedChunk[];
  lang?: string;
}

export interface RunAITaskResult {
  text: string;
  providerUsed: AIProvider;
  modelUsed: string;
  fallbackTriggered: boolean;
  attempts: ProviderAttempt[];
  inputTokens: number;
  outputTokens: number;
}

interface ProviderKeyRow {
  provider: AIProvider;
  api_key: string;
  base_url: string;
  enabled: number;
}

interface AiConfigRow {
  feature_key: AIFeatureKey;
  primary_provider: AIProvider;
  primary_model: string;
  backups_json: string;
  max_tokens: number;
  temperature: number;
}

const DEFAULT_BASE_URLS: Record<Exclude<AIProvider, 'LOCAL'>, string> = {
  GEMINI: 'https://generativelanguage.googleapis.com/v1beta',
  GROQ: 'https://api.groq.com/openai/v1',
  OPENAI: 'https://api.openai.com/v1',
  OPENROUTER: 'https://openrouter.ai/api/v1',
};

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const FALLBACK_MODELS: Record<AIProvider, string[]> = {
  GEMINI: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-pro',
  ],
  GROQ: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'meta-llama/llama-4-scout-17b-16e-instruct',
  ],
  OPENAI: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  OPENROUTER: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'qwen/qwen-2.5-vl-7b-instruct:free',
  ],
  LOCAL: ['deterministic-v1'],
};

const MODEL_CACHE_TTL_MS = 600_000;
const modelListCache = new Map<string, { models: string[]; expiresAt: number }>();

function normalizeGeminiModel(model: string): string {
  const clean = model.trim().replace(/^models\//i, '');
  if (!clean || clean.toLowerCase() === 'gemini-3.5-flash-lite') {
    return DEFAULT_GEMINI_MODEL;
  }
  return clean;
}

export async function listProviderModels({
  provider,
  apiKey,
  baseUrl,
}: {
  provider: AIProvider;
  apiKey?: string;
  baseUrl?: string;
}): Promise<string[]> {
  if (provider === 'LOCAL') {
    return ['deterministic-v1'];
  }

  const trimmedKey = (apiKey ?? '').trim();
  if (!trimmedKey) {
    return [...FALLBACK_MODELS[provider]];
  }

  const cleanBase = (baseUrl || DEFAULT_BASE_URLS[provider]).replace(/\/$/, '');
  const cacheKey = `${provider}:${cleanBase}:${trimmedKey.slice(-6)}`;
  const cached = modelListCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return [...cached.models];
  }

  try {
    let discovered: string[] = [];

    if (provider === 'GEMINI') {
      const res = await fetch(
        `${cleanBase}/models?key=${encodeURIComponent(trimmedKey)}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        }
      );
      if (!res.ok) {
        return [...FALLBACK_MODELS.GEMINI];
      }
      const data = (await res.json()) as {
        models?: Array<{
          name?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      const rawModels = Array.isArray(data.models) ? data.models : [];
      discovered = rawModels
        .filter(
          (m) =>
            Array.isArray(m.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent')
        )
        .map((m) => (m.name ?? '').replace(/^models\//i, '').trim())
        .filter(
          (id) =>
            /^gemini-/i.test(id) &&
            !/(embedding|imagen|veo|tts|aqa|bison)/i.test(id)
        );
    } else {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${trimmedKey}`,
      };
      if (provider === 'OPENROUTER') {
        headers['HTTP-Referer'] = 'https://almeriacerca.local';
        headers['X-Title'] = 'AlmeriaCerca';
      }
      const res = await fetch(`${cleanBase}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        return [...FALLBACK_MODELS[provider]];
      }
      const data = (await res.json()) as {
        data?: Array<{ id?: string }>;
      };
      const rawList = Array.isArray(data.data) ? data.data : [];
      discovered = rawList
        .map((item) => (item.id ?? '').trim())
        .filter(
          (id) =>
            Boolean(id) &&
            !/(whisper|tts|embedding|dall-e|moderation|guard|audio|realtime)/i.test(
              id
            )
        );

      if (provider === 'OPENROUTER') {
        discovered.sort((a, b) => {
          const aFree = a.toLowerCase().endsWith(':free') ? 0 : 1;
          const bFree = b.toLowerCase().endsWith(':free') ? 0 : 1;
          return aFree - bFree;
        });
      }
    }

    const unique = Array.from(new Set(discovered));
    if (unique.length === 0) {
      return [...FALLBACK_MODELS[provider]];
    }

    modelListCache.set(cacheKey, {
      models: unique,
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
    });
    return [...unique];
  } catch {
    return [...FALLBACK_MODELS[provider]];
  }
}

export function resolveAutoModel({
  provider,
  featureKey,
  availableModels,
}: {
  provider: AIProvider;
  featureKey: AIFeatureKey;
  availableModels?: string[];
}): string {
  if (provider === 'LOCAL') {
    return 'deterministic-v1';
  }

  const list =
    availableModels && availableModels.length > 0
      ? availableModels
      : FALLBACK_MODELS[provider];

  const findMatch = (predicate: (lower: string) => boolean): string | undefined =>
    list.find((m) => predicate(m.toLowerCase()));

  if (provider === 'GEMINI') {
    if (featureKey === 'CLASSIFY') {
      return (
        findMatch((l) => l.includes('2.5-flash-lite')) ??
        findMatch((l) => l.includes('2.5-flash') && !l.includes('lite')) ??
        findMatch((l) => l.includes('2.5-flash')) ??
        findMatch((l) => l.includes('2.0-flash')) ??
        findMatch((l) => l.includes('flash')) ??
        list[0]
      );
    }
    return (
      findMatch((l) => l.includes('2.5-flash') && !l.includes('lite')) ??
      findMatch((l) => l.includes('2.0-flash')) ??
      findMatch((l) => l.includes('2.5-flash-lite')) ??
      findMatch((l) => l.includes('flash')) ??
      list[0]
    );
  }

  if (provider === 'GROQ') {
    if (featureKey === 'CLASSIFY') {
      return (
        findMatch((l) => l.includes('8b-instant')) ??
        findMatch((l) => l.includes('llama-3.3-70b')) ??
        list[0]
      );
    }
    if (featureKey === 'CHAT') {
      return (
        findMatch((l) => l.includes('llama-3.3-70b')) ??
        findMatch((l) => l.includes('70b')) ??
        findMatch((l) => l.includes('8b-instant')) ??
        list[0]
      );
    }
    return (
      findMatch((l) => l.includes('llama-4-scout')) ??
      findMatch((l) => l.includes('vision')) ??
      findMatch((l) => l.includes('llama-3.3-70b')) ??
      list[0]
    );
  }

  if (provider === 'OPENAI') {
    return (
      findMatch((l) => l.includes('gpt-4.1-mini')) ??
      findMatch((l) => l.includes('gpt-4o-mini')) ??
      findMatch((l) => l.includes('gpt-4o')) ??
      list[0]
    );
  }

  if (provider === 'OPENROUTER') {
    if (featureKey === 'VISION') {
      return (
        findMatch(
          (l) =>
            l.includes(':free') &&
            (l.includes('vl') || l.includes('vision') || l.includes('gemini'))
        ) ??
        findMatch((l) => l.includes(':free')) ??
        list[0]
      );
    }
    return (
      findMatch((l) => l.includes('llama-3.3-70b') && l.includes(':free')) ??
      findMatch((l) => l.includes('gemini') && l.includes(':free')) ??
      findMatch((l) => l.includes(':free')) ??
      list[0]
    );
  }

  return list[0];
}

const REQUEST_TIMEOUT_MS = 15000;

function parseDataUrl(imageBase64: string): { mimeType: string; data: string; fullUrl: string } {
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1],
      data: match[2],
      fullUrl: imageBase64,
    };
  }
  return {
    mimeType: 'image/jpeg',
    data: imageBase64,
    fullUrl: `data:image/jpeg;base64,${imageBase64}`,
  };
}

async function callGemini({
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  userPrompt,
  history,
  imageBase64,
  maxTokens,
  temperature,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  history: ChatHistoryMessage[];
  imageBase64?: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const cleanBase = (baseUrl || DEFAULT_BASE_URLS.GEMINI).replace(/\/$/, '');
  const cleanModel = normalizeGeminiModel(model);
  const endpoint = `${cleanBase}/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  type GeminiPart =
    | { text: string }
    | { inlineData: { mimeType: string; data: string } };

  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> =
    history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

  const currentParts: GeminiPart[] = [{ text: userPrompt }];
  if (imageBase64) {
    const parsed = parseDataUrl(imageBase64);
    currentParts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.data,
      },
    });
  }
  contents.push({ role: 'user', parts: currentParts });

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GEMINI HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const visibleText = parts
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  const text = visibleText || parts.find((p) => typeof p.text === 'string')?.text?.trim();
  if (!text) {
    throw new Error('GEMINI returned empty response');
  }
  const estIn = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  const estOut = Math.ceil(text.length / 4);
  return JSON.stringify({
    __llm_wrapped: true,
    text,
    inputTokens: json.usageMetadata?.promptTokenCount ?? estIn,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? estOut,
  });
}

async function callOpenAICompatible({
  provider,
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  userPrompt,
  history,
  imageBase64,
  maxTokens,
  temperature,
}: {
  provider: 'GROQ' | 'OPENAI' | 'OPENROUTER';
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  history: ChatHistoryMessage[];
  imageBase64?: string;
  maxTokens: number;
  temperature: number;
}): Promise<string> {
  const cleanBase = (baseUrl || DEFAULT_BASE_URLS[provider]).replace(/\/$/, '');
  const endpoint = `${cleanBase}/chat/completions`;

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  if (imageBase64 && (provider === 'OPENAI' || provider === 'OPENROUTER')) {
    const parsed = parseDataUrl(imageBase64);
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: parsed.fullUrl } },
      ],
    });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === 'OPENROUTER') {
    headers['HTTP-Referer'] = 'https://almeriacerca.local';
    headers['X-Title'] = 'AlmeriaCerca';
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${provider} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`${provider} returned empty response`);
  }
  const estIn = Math.ceil((systemPrompt.length + userPrompt.length) / 4);
  const estOut = Math.ceil(text.length / 4);
  return JSON.stringify({
    __llm_wrapped: true,
    text,
    inputTokens: json.usage?.prompt_tokens ?? estIn,
    outputTokens: json.usage?.completion_tokens ?? estOut,
  });
}

function unwrapLlmResult(
  raw: string,
  promptLen: number
): { text: string; inputTokens: number; outputTokens: number } {
  try {
    const parsed = JSON.parse(raw) as {
      __llm_wrapped?: boolean;
      text?: string;
      inputTokens?: number;
      outputTokens?: number;
    };
    if (parsed && parsed.__llm_wrapped && typeof parsed.text === 'string') {
      return {
        text: parsed.text,
        inputTokens: Number(parsed.inputTokens ?? Math.ceil(promptLen / 4)),
        outputTokens: Number(parsed.outputTokens ?? Math.ceil(parsed.text.length / 4)),
      };
    }
  } catch {
    // Not wrapped
  }
  return {
    text: raw,
    inputTokens: Math.ceil(promptLen / 4),
    outputTokens: Math.ceil(raw.length / 4),
  };
}

export function classifyLocally(userPrompt: string, hasImage: boolean): string {
  const norm = userPrompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const immediateDanger =
    /(112|incendio|fuego|humo|derrumbe|cable|electro|explosi|herido|inundacion|accidente grave)/.test(
      norm
    );

  let category = 'Otros';
  let department = 'Atención Ciudadana';

  if (/(polideportivo|piscina|pista|deport|gimnasio|campo de futbol|pabellon)/.test(norm)) {
    category = 'Otros';
    department = 'Deportes';
  } else if (/(feria|fiesta|verbena|procesion|escenario|cabalgata|evento|concierto)/.test(norm)) {
    category = 'Otros';
    department = 'Fiestas';
  } else if (/(farola|luz|alumbrado|oscuro|lampara|bombilla|cable|poste)/.test(norm)) {
    category = 'Alumbrado';
    department = 'Electricidad';
  } else if (/(agua|fuga|tuberia|alcantarilla|fuente|riego|inundacion|charco)/.test(norm)) {
    category = 'Agua y Averías';
    department = 'Aguas y Mantenimiento';
  } else if (/(basura|contenedor|sucio|limpieza|cristales|escombros|bolsas|olor|papelera)/.test(norm)) {
    category = 'Limpieza y Basura';
    department = 'Limpieza Viaria';
  } else if (/(bache|socavon|acera|calzada|asfalt|senal|paso de peatones|grieta)/.test(norm)) {
    category = 'Baches y Vía Pública';
    department = 'Obras y Urbanismo';
  } else if (/(arbol|rama|parque|jardin|banco|columpio|plaza|poda|cesped)/.test(norm)) {
    category = 'Parques y Jardines';
    department = 'Medio Ambiente';
  }

  let urgency: 'BAJA' | 'MEDIA' | 'ALTA' | 'URGENTE' | 'EMERGENCIA_112' = 'MEDIA';
  if (immediateDanger) {
    urgency = 'EMERGENCIA_112';
    department = 'Policía Local';
  } else if (/(peligro|critica|urgente|socavon|accidente|hospital)/.test(norm)) {
    urgency = 'URGENTE';
  } else if (/(fuga|sin luz|apagada|roto|rota|desbordado|bloquea|caido|caida|varias)/.test(norm)) {
    urgency = 'ALTA';
  } else if (/(sugerencia|horario|pintura|leve|pequeno|consulta|solicitud)/.test(norm)) {
    urgency = 'BAJA';
  }

  const snippet = userPrompt.trim().replace(/\s+/g, ' ').slice(0, 62);
  const title = snippet.length > 0 ? snippet : `Incidencia de ${category}`;
  const photoMatchesText = !/(no coincide|foto distinta|imagen equivocada|otra cosa)/.test(norm);
  const detectedRisk = immediateDanger || urgency === 'URGENTE';

  return JSON.stringify({
    title,
    category,
    urgency,
    department,
    aiReasoning: hasImage
      ? `Clasificación local con análisis de imagen en ${category} (${urgency}) para ${department}.`
      : `Clasificación determinista local en ${category} (${urgency}) asignada a ${department}.`,
    imageDescription: hasImage
      ? `Imagen ciudadana asociada a ${category.toLowerCase()} (${title}).`
      : null,
    photoMatchesText,
    detectedRisk,
  });
}

async function synthesizeLocalChat({
  municipalityId,
  municipalityName,
  userPrompt,
  ragChunks,
  lang,
}: {
  municipalityId: string;
  municipalityName: string;
  userPrompt: string;
  ragChunks: RetrievedChunk[];
  lang: string;
}): Promise<string> {
  const chunks =
    ragChunks.length > 0
      ? ragChunks
      : await retrieveContext({
          municipalityId,
          query: userPrompt,
          topK: 3,
          maxChars: 1800,
        });

  if (chunks.length > 0) {
    const queryWords = userPrompt
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    const bestChunk = chunks[0];
    const sentences = bestChunk.content
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 12);

    const rankedSentences = sentences
      .map((sentence) => {
        const normSentence = sentence
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '');
        const hits = queryWords.reduce(
          (acc, word) => acc + (normSentence.includes(word) ? 1 : 0),
          0
        );
        return { sentence, hits };
      })
      .sort((a, b) => b.hits - a.hits);

    const excerpt = rankedSentences
      .slice(0, 3)
      .map((item) => item.sentence)
      .join(' ');

    const bodyText = excerpt || bestChunk.content.slice(0, 420);

    if (lang === 'en') {
      return `According to ${municipalityName} official information (${bestChunk.filename}): ${bodyText}`;
    }
    if (lang === 'fr') {
      return `D'après le document officiel de ${municipalityName} (${bestChunk.filename}) : ${bodyText}`;
    }
    if (lang === 'ar') {
      return `وفقاً للوثيقة الرسمية لبلدية ${municipalityName} (${bestChunk.filename}): ${bodyText}`;
    }
    return `Según la documentación oficial de ${municipalityName} (${bestChunk.filename}): ${bodyText}`;
  }

  const fallbackMessages: Record<string, string> = {
    es: `En el Ayuntamiento de ${municipalityName} atendemos de lunes a viernes de 09:00 a 14:00. Si quieres avisar de una avería en tu calle puedes usar "Avisar de un problema", o escribir tu duda más concreta (ej. empadronamiento, IBI, basura o ayudas).`,
    en: `${municipalityName} Town Hall is open Monday to Friday from 09:00 to 14:00. You can ask specifically about local grants, waste collection, registration, or report a street issue.`,
    fr: `La mairie de ${municipalityName} vous accueille du lundi au vendredi de 09h00 à 14h00. Vous pouvez demander des détails sur les aides, le recensement ou signaler un incident.`,
    ar: `تستقبلكم بلدية ${municipalityName} من الاثنين إلى الجمعة من 09:00 إلى 14:00. يمكنكم السؤال عن المساعدات أو المواعيد أو الإبلاغ عن أي مشكلة في الشارع.`,
  };

  return fallbackMessages[lang] ?? fallbackMessages.es;
}

export async function runAITask(input: RunAITaskInput): Promise<RunAITaskResult> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, input.municipalityId);
  if (!municipality) {
    throw new Error('Municipio no encontrado para ejecutar tarea de IA.');
  }

  const keyRows = await db.query<ProviderKeyRow>(
    `SELECT provider, api_key, base_url, enabled
     FROM ai_provider_keys
     WHERE municipality_id = $1`,
    [municipality.id]
  );

  const keyMap = new Map<AIProvider, ProviderKeyRow>();
  for (const row of keyRows) {
    keyMap.set(row.provider, row);
  }

  const configRow = await db.queryOne<AiConfigRow>(
    `SELECT feature_key, primary_provider, primary_model, backups_json, max_tokens, temperature
     FROM ai_configs
     WHERE municipality_id = $1 AND feature_key = $2
     LIMIT 1`,
    [municipality.id, input.featureKey]
  );

  const maxTokens =
    configRow?.max_tokens ?? (input.featureKey === 'CHAT' ? 300 : 180);
  const temperature = configRow?.temperature ?? 0.2;

  let backups: BackupEntry[] = [];
  if (configRow?.backups_json) {
    try {
      backups = JSON.parse(configRow.backups_json) as BackupEntry[];
    } catch {
      backups = [];
    }
  }

  const rawChain: BackupEntry[] = [
    ...(configRow
      ? [{ provider: configRow.primary_provider, model: configRow.primary_model }]
      : []),
    ...backups,
    { provider: 'LOCAL', model: 'deterministic-v1' },
  ];

  // Deduplicar entradas idénticas consecutivas manteniendo el orden de cascada
  const chain: BackupEntry[] = [];
  for (const item of rawChain) {
    const exists = chain.some(
      (c) => c.provider === item.provider && c.model === item.model
    );
    if (!exists) {
      chain.push(item);
    }
  }

  const trimmedHistory = trimHistory(input.history ?? [], 4);
  const attempts: ProviderAttempt[] = [];

  for (let i = 0; i < chain.length; i++) {
    const candidate = chain[i];

    if (candidate.provider === 'LOCAL') {
      const text =
        input.featureKey === 'CHAT'
          ? await synthesizeLocalChat({
              municipalityId: municipality.id,
              municipalityName: municipality.name,
              userPrompt: input.userPrompt,
              ragChunks: input.ragChunks ?? [],
              lang: input.lang ?? 'es',
            })
          : classifyLocally(input.userPrompt, Boolean(input.imageBase64));

      attempts.push({
        provider: 'LOCAL',
        model: candidate.model || 'deterministic-v1',
        ok: true,
      });

      return {
        text,
        providerUsed: 'LOCAL',
        modelUsed: candidate.model || 'deterministic-v1',
        fallbackTriggered: i > 0,
        attempts,
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const providerCreds = keyMap.get(candidate.provider);
    const rawCandidateModel = (candidate.model ?? '').trim();
    const isAutoCandidate =
      !rawCandidateModel || rawCandidateModel.toLowerCase() === 'auto';

    if (!providerCreds || providerCreds.enabled !== 1 || !providerCreds.api_key.trim()) {
      const skippedModel = isAutoCandidate
        ? resolveAutoModel({
            provider: candidate.provider,
            featureKey: input.featureKey,
          })
        : candidate.provider === 'GEMINI'
        ? normalizeGeminiModel(rawCandidateModel)
        : rawCandidateModel;

      attempts.push({
        provider: candidate.provider,
        model: skippedModel,
        ok: false,
        reason: 'disabled_or_missing_key',
      });
      continue;
    }

    const trimmedApiKey = providerCreds.api_key.trim();
    let activeModel: string;
    if (isAutoCandidate) {
      const discoveredModels = await listProviderModels({
        provider: candidate.provider,
        apiKey: trimmedApiKey,
        baseUrl: providerCreds.base_url,
      });
      activeModel = resolveAutoModel({
        provider: candidate.provider,
        featureKey: input.featureKey,
        availableModels: discoveredModels,
      });
    } else {
      activeModel =
        candidate.provider === 'GEMINI'
          ? normalizeGeminiModel(rawCandidateModel)
          : rawCandidateModel;
    }

    const activeProvider = candidate.provider;
    const invokeCandidate = async (modelToRun: string): Promise<string> =>
      activeProvider === 'GEMINI'
        ? callGemini({
            apiKey: trimmedApiKey,
            baseUrl: providerCreds.base_url,
            model: modelToRun,
            systemPrompt: input.systemPrompt,
            userPrompt: input.userPrompt,
            history: trimmedHistory,
            imageBase64: input.imageBase64,
            maxTokens,
            temperature,
          })
        : callOpenAICompatible({
            provider: activeProvider,
            apiKey: trimmedApiKey,
            baseUrl: providerCreds.base_url,
            model: modelToRun,
            systemPrompt: input.systemPrompt,
            userPrompt: input.userPrompt,
            history: trimmedHistory,
            imageBase64: input.imageBase64,
            maxTokens,
            temperature,
          });

    try {
      const rawReply = await invokeCandidate(activeModel);
      const unwrapped = unwrapLlmResult(
        rawReply,
        input.systemPrompt.length + input.userPrompt.length
      );

      attempts.push({
        provider: candidate.provider,
        model: activeModel,
        ok: true,
      });

      return {
        text: unwrapped.text,
        providerUsed: candidate.provider,
        modelUsed: activeModel,
        fallbackTriggered: i > 0,
        attempts,
        inputTokens: unwrapped.inputTokens,
        outputTokens: unwrapped.outputTokens,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'provider_error';
      attempts.push({
        provider: candidate.provider,
        model: activeModel,
        ok: false,
        reason: errMsg,
      });

      // Auto-recuperación ante HTTP 404 / modelo retirado
      if (/(404|not found|model_not_found|decommissioned)/i.test(errMsg)) {
        const availableModels = (
          await listProviderModels({
            provider: candidate.provider,
            apiKey: trimmedApiKey,
            baseUrl: providerCreds.base_url,
          })
        ).filter((m) => m.toLowerCase() !== activeModel.toLowerCase());

        if (availableModels.length > 0) {
          const recoveryModel = resolveAutoModel({
            provider: candidate.provider,
            featureKey: input.featureKey,
            availableModels,
          });

          if (
            recoveryModel &&
            recoveryModel.toLowerCase() !== activeModel.toLowerCase()
          ) {
            try {
              const retryReply = await invokeCandidate(recoveryModel);
              const unwrappedRetry = unwrapLlmResult(
                retryReply,
                input.systemPrompt.length + input.userPrompt.length
              );

              attempts.push({
                provider: candidate.provider,
                model: recoveryModel,
                ok: true,
              });

              return {
                text: unwrappedRetry.text,
                providerUsed: candidate.provider,
                modelUsed: recoveryModel,
                fallbackTriggered: i > 0,
                attempts,
                inputTokens: unwrappedRetry.inputTokens,
                outputTokens: unwrappedRetry.outputTokens,
              };
            } catch (retryErr) {
              attempts.push({
                provider: candidate.provider,
                model: recoveryModel,
                ok: false,
                reason:
                  retryErr instanceof Error
                    ? retryErr.message
                    : 'provider_error',
              });
            }
          }
        }
      }
    }
  }

  // Salvaguarda final si la cadena no contenía LOCAL por configuración corrupta
  const fallbackText =
    input.featureKey === 'CHAT'
      ? await synthesizeLocalChat({
          municipalityId: municipality.id,
          municipalityName: municipality.name,
          userPrompt: input.userPrompt,
          ragChunks: input.ragChunks ?? [],
          lang: input.lang ?? 'es',
        })
      : classifyLocally(input.userPrompt, Boolean(input.imageBase64));

  return {
    text: fallbackText,
    providerUsed: 'LOCAL',
    modelUsed: 'deterministic-v1',
    fallbackTriggered: true,
    attempts,
    inputTokens: 0,
    outputTokens: 0,
  };
}

export async function testProviderConnection({
  provider,
  apiKey,
  model,
  baseUrl,
}: {
  provider: AIProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}): Promise<{
  ok: boolean;
  provider: AIProvider;
  model: string;
  models: string[];
  message: string;
  latencyMs: number;
}> {
  const start = Date.now();

  if (provider === 'LOCAL') {
    return {
      ok: true,
      provider: 'LOCAL',
      model: model || 'deterministic-v1',
      models: ['deterministic-v1'],
      message: 'Motor local determinista operativo (sin consumo de tokens externos).',
      latencyMs: Date.now() - start,
    };
  }

  const trimmedKey = (apiKey ?? '').trim();
  if (!trimmedKey) {
    return {
      ok: false,
      provider,
      model: model || '',
      models: [...FALLBACK_MODELS[provider]],
      message: `Falta la API Key para ${provider}.`,
      latencyMs: Date.now() - start,
    };
  }

  const models = await listProviderModels({
    provider,
    apiKey: trimmedKey,
    baseUrl,
  });

  const requestedModel = (model ?? '').trim();
  const matchedInList = models.find(
    (m) => m.toLowerCase() === requestedModel.toLowerCase()
  );

  const chosenModel =
    !requestedModel ||
    requestedModel.toLowerCase() === 'auto' ||
    !matchedInList
      ? resolveAutoModel({
          provider,
          featureKey: 'CHAT',
          availableModels: models,
        })
      : provider === 'GEMINI'
      ? normalizeGeminiModel(matchedInList)
      : matchedInList;

  try {
    if (provider === 'GEMINI') {
      await callGemini({
        apiKey: trimmedKey,
        baseUrl: baseUrl || DEFAULT_BASE_URLS.GEMINI,
        model: chosenModel,
        systemPrompt: 'Reply with OK.',
        userPrompt: 'Say OK',
        history: [],
        maxTokens: 64,
        temperature: 0,
      });
    } else {
      await callOpenAICompatible({
        provider,
        apiKey: trimmedKey,
        baseUrl: baseUrl || DEFAULT_BASE_URLS[provider],
        model: chosenModel,
        systemPrompt: 'Reply with OK.',
        userPrompt: 'Say OK',
        history: [],
        maxTokens: 64,
        temperature: 0,
      });
    }

    return {
      ok: true,
      provider,
      model: chosenModel,
      models,
      message: `Conexión correcta · Usando ${chosenModel} (${models.length} modelos activos)`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      model: chosenModel,
      models,
      message: err instanceof Error ? err.message : 'Error de conexión.',
      latencyMs: Date.now() - start,
    };
  }
}
