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

const REQUEST_TIMEOUT_MS = 10000;

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
  const endpoint = `${cleanBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) {
    throw new Error('GEMINI returned empty response');
  }
  return text;
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
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`${provider} returned empty response`);
  }
  return text;
}

function classifyLocally(userPrompt: string, hasImage: boolean): string {
  const norm = userPrompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let category = 'Otros';
  let department = 'Atención Ciudadana';

  if (/(farola|luz|alumbrado|oscuro|lampara|bombilla|cable|poste)/.test(norm)) {
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

  let urgency: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA' = 'MEDIA';
  if (/(peligro|critica|urgente|cable caido|electro|inundacion|socavon|accidente|incendio|fuego|hospital|derrumbe)/.test(norm)) {
    urgency = 'CRITICA';
  } else if (/(fuga|sin luz|apagada|roto|rota|desbordado|bloquea|caido|caida|varias)/.test(norm)) {
    urgency = 'ALTA';
  } else if (/(sugerencia|horario|pintura|leve|pequeno|consulta|solicitud)/.test(norm)) {
    urgency = 'BAJA';
  }

  const snippet = userPrompt.trim().replace(/\s+/g, ' ').slice(0, 62);
  const title = snippet.length > 0 ? snippet : `Incidencia de ${category}`;

  return JSON.stringify({
    title,
    category,
    urgency,
    department,
    aiReasoning: hasImage
      ? `Clasificación local con imagen adjunta en ${category} (${urgency}) para ${department}.`
      : `Clasificación determinista local en ${category} (${urgency}) asignada a ${department}.`,
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
  const municipality = resolveMunicipality(db, input.municipalityId);
  if (!municipality) {
    throw new Error('Municipio no encontrado para ejecutar tarea de IA.');
  }

  const keyRows = db
    .prepare(
      `SELECT provider, api_key, base_url, enabled
       FROM ai_provider_keys
       WHERE municipality_id = ?`
    )
    .all(municipality.id) as ProviderKeyRow[];

  const keyMap = new Map<AIProvider, ProviderKeyRow>();
  for (const row of keyRows) {
    keyMap.set(row.provider, row);
  }

  const configRow = db
    .prepare(
      `SELECT feature_key, primary_provider, primary_model, backups_json, max_tokens, temperature
       FROM ai_configs
       WHERE municipality_id = ? AND feature_key = ?
       LIMIT 1`
    )
    .get(municipality.id, input.featureKey) as AiConfigRow | undefined;

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
      };
    }

    const providerCreds = keyMap.get(candidate.provider);
    if (!providerCreds || providerCreds.enabled !== 1 || !providerCreds.api_key.trim()) {
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        ok: false,
        reason: 'disabled_or_missing_key',
      });
      continue;
    }

    try {
      const text =
        candidate.provider === 'GEMINI'
          ? await callGemini({
              apiKey: providerCreds.api_key.trim(),
              baseUrl: providerCreds.base_url,
              model: candidate.model,
              systemPrompt: input.systemPrompt,
              userPrompt: input.userPrompt,
              history: trimmedHistory,
              imageBase64: input.imageBase64,
              maxTokens,
              temperature,
            })
          : await callOpenAICompatible({
              provider: candidate.provider,
              apiKey: providerCreds.api_key.trim(),
              baseUrl: providerCreds.base_url,
              model: candidate.model,
              systemPrompt: input.systemPrompt,
              userPrompt: input.userPrompt,
              history: trimmedHistory,
              imageBase64: input.imageBase64,
              maxTokens,
              temperature,
            });

      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        ok: true,
      });

      return {
        text,
        providerUsed: candidate.provider,
        modelUsed: candidate.model,
        fallbackTriggered: i > 0,
        attempts,
      };
    } catch (err) {
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        ok: false,
        reason: err instanceof Error ? err.message : 'provider_error',
      });
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
  message: string;
  latencyMs: number;
}> {
  const start = Date.now();

  if (provider === 'LOCAL') {
    return {
      ok: true,
      provider: 'LOCAL',
      model: model || 'deterministic-v1',
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
      message: `Falta la API Key para ${provider}.`,
      latencyMs: Date.now() - start,
    };
  }

  const defaultModels: Record<Exclude<AIProvider, 'LOCAL'>, string> = {
    GEMINI: 'gemini-2.0-flash',
    GROQ: 'llama-3.3-70b-versatile',
    OPENAI: 'gpt-4o-mini',
    OPENROUTER: 'meta-llama/llama-3.1-8b-instruct:free',
  };
  const chosenModel = model?.trim() || defaultModels[provider];

  try {
    const reply =
      provider === 'GEMINI'
        ? await callGemini({
            apiKey: trimmedKey,
            baseUrl: baseUrl || DEFAULT_BASE_URLS.GEMINI,
            model: chosenModel,
            systemPrompt: 'Reply with OK.',
            userPrompt: 'Say OK',
            history: [],
            maxTokens: 10,
            temperature: 0,
          })
        : await callOpenAICompatible({
            provider,
            apiKey: trimmedKey,
            baseUrl: baseUrl || DEFAULT_BASE_URLS[provider],
            model: chosenModel,
            systemPrompt: 'Reply with OK.',
            userPrompt: 'Say OK',
            history: [],
            maxTokens: 10,
            temperature: 0,
          });

    return {
      ok: true,
      provider,
      model: chosenModel,
      message: `Conexión correcta (${reply.slice(0, 30)}).`,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      model: chosenModel,
      message: err instanceof Error ? err.message : 'Error de conexión.',
      latencyMs: Date.now() - start,
    };
  }
}
