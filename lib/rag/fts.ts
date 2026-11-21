import crypto from 'crypto';
import { getDb, type DbClient } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';
import type { ScrapedMunicipalDoc } from './scraper';

export const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
export const CALIBRATED_VECTOR_THRESHOLD = 0.45;
export const PURE_VECTOR_HIGH_CONFIDENCE = 0.66;
const GEMINI_BATCH_SIZE = 85;

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  category?: string | null;
  content: string;
  score: number;
  vectorScore?: number | null;
  lexicalScore?: number | null;
  retrievalMethod?: 'hybrid' | 'vector' | 'fts';
  sourceUrl?: string | null;
  validUntil?: string | null;
  createdAt?: string | null;
}

export interface IngestDocumentInput {
  municipalityId: string;
  filename: string;
  docType: string;
  text: string;
  category?: string | null;
  uploadedBy?: string | null;
  sourceUrl?: string | null;
  status?: 'VIGENTE' | 'DEROGADA';
  validUntil?: string | null;
}

export interface IngestDocumentResult {
  documentId: string;
  municipalityId: string;
  filename: string;
  category: string | null;
  charCount: number;
  chunkCount: number;
  vectorCount: number;
  embeddingModel: string | null;
  status: 'VIGENTE' | 'DEROGADA';
  validUntil: string | null;
}

export interface BatchIngestResult {
  municipalityId: string;
  documentsIndexed: number;
  chunksIndexed: number;
  vectorsGenerated: number;
  embeddingModel: string | null;
}

interface FtsChunkRow {
  chunk_id: string;
  document_id: string;
  municipality_id: string;
  filename: string;
  content: string;
  category?: string | null;
  pg_rank?: number;
  source_url?: string | null;
  valid_until?: string | null;
  created_at?: string | null;
}

interface VectorChunkRow {
  chunk_id: string;
  document_id: string;
  municipality_id: string;
  filename: string;
  content: string;
  category?: string | null;
  score: number;
  source_url?: string | null;
  valid_until?: string | null;
  created_at?: string | null;
}

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'y', 'o', 'u', 'que', 'por', 'para', 'con', 'sin', 'sobre',
  'se', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'es', 'son', 'fue', 'ser',
  'como', 'cuando', 'donde', 'cual', 'quien', 'hay', 'esta', 'este', 'esto',
  'puedo', 'puede', 'hacer', 'hago', 'necesito', 'quiero', 'saber', 'tiene',
  'preparar', 'casa', 'tipo', 'forma', 'modo', 'cuales', 'dice', 'establece',
  'the', 'is', 'are', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'a', 'an',
  'le', 'la', 'les', 'des', 'du', 'et', 'ou', 'est', 'dans', 'pour', 'avec',
]);

function normalizeClean(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function tokenizeForSearch(input: string): string[] {
  const normalized = normalizeClean(input)
    .replace(/[^a-z0-9\u0600-\u06FF\s/-]/g, ' ')
    .trim();

  if (!normalized) return [];
  const rawTokens = normalized.split(/\s+/).filter((t) => t.length > 1);
  const filtered = rawTokens.filter((t) => !STOPWORDS.has(t));
  return filtered.length > 0 ? filtered : rawTokens;
}

export async function getGeminiEmbeddingKey(
  db: DbClient,
  municipalityId?: string
): Promise<string | null> {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) return envKey;

  if (municipalityId) {
    const row = await db.queryOne<{ api_key: string }>(
      `SELECT api_key
       FROM ai_provider_keys
       WHERE municipality_id = $1 AND provider = 'GEMINI' AND enabled = 1 AND api_key <> ''
       LIMIT 1`,
      [municipalityId]
    );
    if (row?.api_key?.trim()) {
      return row.api_key.trim();
    }
  }

  const anyRow = await db.queryOne<{ api_key: string }>(
    `SELECT api_key
     FROM ai_provider_keys
     WHERE provider = 'GEMINI' AND enabled = 1 AND api_key <> ''
     ORDER BY updated_at DESC
     LIMIT 1`
  );
  return anyRow?.api_key?.trim() || null;
}

export async function generateGeminiEmbedding(
  text: string,
  apiKey: string
): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model: `models/${GEMINI_EMBEDDING_MODEL}`,
          content: { parts: [{ text: text.slice(0, 6000) }] },
          outputDimensionality: 768,
        }),
      }
    );

    if (!res.ok) return null;
    const data = (await res.json()) as {
      embedding?: { values?: number[] };
    };
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length !== 768) return null;
    return values;
  } catch {
    return null;
  }
}

/**
 * Genera embeddings de 768 dimensiones en lotes mediante `batchEmbedContents` de Gemini
 * garantizando un espacio vectorial 100% homogéneo (`gemini-embedding-001`).
 */
export async function generateGeminiEmbeddingsBatch(
  texts: string[],
  apiKey: string
): Promise<Array<number[] | null>> {
  if (texts.length === 0) return [];
  const results: Array<number[] | null> = new Array(texts.length).fill(null);

  for (let start = 0; start < texts.length; start += GEMINI_BATCH_SIZE) {
    const slice = texts.slice(start, start + GEMINI_BATCH_SIZE);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:batchEmbedContents?key=${encodeURIComponent(
            apiKey
          )}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              requests: slice.map((t) => ({
                model: `models/${GEMINI_EMBEDDING_MODEL}`,
                content: { parts: [{ text: t.slice(0, 5000) }] },
                outputDimensionality: 768,
              })),
            }),
          }
        );

        if (res.status === 429 && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }

        if (!res.ok) {
          break;
        }

        const data = (await res.json()) as {
          embeddings?: Array<{ values?: number[] }>;
        };
        const embeddings = Array.isArray(data.embeddings) ? data.embeddings : [];
        for (let idx = 0; idx < slice.length; idx++) {
          const vals = embeddings[idx]?.values;
          if (Array.isArray(vals) && vals.length === 768) {
            results[start + idx] = vals;
          }
        }
        break;
      } catch {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }
    }
    if (start + GEMINI_BATCH_SIZE < texts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

function toPgVectorLiteral(vec: number[] | null): string | null {
  if (!vec || vec.length !== 768) return null;
  return `[${vec.join(',')}]`;
}

function selectWithinBudget(
  candidates: RetrievedChunk[],
  topK: number,
  maxChars: number
): RetrievedChunk[] {
  const selected: RetrievedChunk[] = [];
  let accumulatedChars = 0;

  for (const chunk of candidates) {
    if (selected.length >= topK) break;

    if (selected.length === 0 && chunk.content.length > maxChars) {
      selected.push({
        ...chunk,
        content: chunk.content.slice(0, maxChars).trim(),
      });
      break;
    }

    if (accumulatedChars + chunk.content.length > maxChars) {
      continue;
    }

    selected.push(chunk);
    accumulatedChars += chunk.content.length;
  }

  return selected;
}

function flattenGenericJson(data: unknown, prefix = ''): string[] {
  const lines: string[] = [];
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (['id', 'fecha_extraccion', 'vector'].includes(k.toLowerCase())) continue;
      if (v === null || v === undefined || v === '') continue;
      const label = prefix ? `${prefix} - ${k}` : k;
      if (typeof v === 'object') {
        lines.push(...flattenGenericJson(v, label));
      } else {
        const txt = String(v).replace(/\s+/g, ' ').trim();
        if (txt) lines.push(`${label}: ${txt}`);
      }
    }
  } else if (Array.isArray(data)) {
    for (const item of data) {
      lines.push(...flattenGenericJson(item, prefix));
    }
  } else if (data !== null && data !== undefined) {
    const txt = String(data).replace(/\s+/g, ' ').trim();
    if (txt) lines.push(prefix ? `${prefix}: ${txt}` : txt);
  }
  return lines;
}

export function parseUploadedJsonDocuments(
  buffer: Buffer,
  fallbackFilename: string
): ScrapedMunicipalDoc[] {
  const raw = buffer.toString('utf-8').trim();
  const parsed = JSON.parse(raw) as unknown;
  const nowIso = new Date().toISOString();
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const docs: ScrapedMunicipalDoc[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const titulo =
      (typeof obj.titulo === 'string' && obj.titulo.trim()) ||
      (typeof obj.title === 'string' && obj.title.trim()) ||
      (typeof obj.nombre === 'string' && obj.nombre.trim()) ||
      `${fallbackFilename.replace(/\.json$/i, '')}_${i + 1}`;
    const categoria =
      (typeof obj.categoria === 'string' && obj.categoria.trim()) ||
      (typeof obj.category === 'string' && obj.category.trim()) ||
      'documento_municipal';
    const fuenteUrl =
      (typeof obj.fuente_url === 'string' && obj.fuente_url.trim()) ||
      (typeof obj.source_url === 'string' && obj.source_url.trim()) ||
      (typeof obj.url === 'string' && obj.url.trim()) ||
      fallbackFilename;
    const texto =
      typeof obj.texto === 'string' && obj.texto.trim()
        ? obj.texto.trim()
        : typeof obj.text === 'string' && obj.text.trim()
        ? obj.text.trim()
        : flattenGenericJson(obj).join('\n').trim();

    if (texto && texto.length >= 20) {
      docs.push({
        id:
          (typeof obj.id === 'string' && obj.id.trim()) ||
          `json-doc-${i + 1}-${crypto.randomUUID().slice(0, 8)}`,
        titulo,
        categoria,
        fuente_url: fuenteUrl,
        fecha_extraccion: nowIso,
        texto,
      });
    }
  }

  return docs;
}

export async function extractTextFromFile(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const pdfParseModule = await import('pdf-parse');
    const pdfParse = pdfParseModule.default;
    const result = await pdfParse(buffer);
    return (result.text ?? '').trim();
  }

  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    return buffer.toString('utf-8').trim();
  }

  if (lower.endsWith('.json')) {
    const docs = parseUploadedJsonDocuments(buffer, filename);
    return docs
      .map(
        (d) =>
          `${d.titulo} (${d.categoria})\nFuente oficial: ${d.fuente_url}\n${d.texto}`
      )
      .join('\n\n---\n\n')
      .trim();
  }

  throw new Error('Formato no soportado. Usa archivos .pdf, .txt, .md o .json.');
}

/**
 * Troceado semántico respetando saltos de línea, párrafos, Códigos SIA y referencias de leyes,
 * inspirado en `trocear_texto` de `vectorizar.py` (~720 caracteres por fragmento, solapamiento 100).
 */
export function chunkText(
  text: string,
  sizeOrWords = 720,
  overlapParam = 100
): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return [];

  // Si se invocó con los valores antiguos por palabras (350, 40), escalar a caracteres semánticos
  const chunkSize = sizeOrWords <= 400 ? 720 : sizeOrWords;
  const overlap = sizeOrWords <= 400 ? 100 : overlapParam;

  if (cleaned.length <= chunkSize) {
    return [cleaned];
  }

  const lines = cleaned
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    if (line.length > chunkSize) {
      if (currentLines.length > 0) {
        chunks.push(currentLines.join('\n'));
        currentLines = [];
        currentLen = 0;
      }
      const step = Math.max(100, chunkSize - overlap);
      for (let i = 0; i < line.length; i += step) {
        const piece = line.slice(i, i + chunkSize).trim();
        if (piece) chunks.push(piece);
        if (i + chunkSize >= line.length) break;
      }
      continue;
    }

    const extraNewline = currentLines.length > 0 ? 1 : 0;
    if (currentLen + line.length + extraNewline <= chunkSize) {
      currentLines.push(line);
      currentLen += line.length + extraNewline;
    } else {
      chunks.push(currentLines.join('\n'));

      const tail: string[] = [];
      let tailLen = 0;
      for (let i = currentLines.length - 1; i >= 0; i--) {
        const prev = currentLines[i];
        if (tailLen + prev.length + 1 <= overlap) {
          tail.unshift(prev);
          tailLen += prev.length + 1;
        } else {
          break;
        }
      }
      currentLines = [...tail, line];
      currentLen =
        currentLines.reduce((acc, s) => acc + s.length, 0) +
        Math.max(0, currentLines.length - 1);
    }
  }

  if (currentLines.length > 0) {
    chunks.push(currentLines.join('\n'));
  }

  return chunks;
}

export async function ingestDocument(
  input: IngestDocumentInput
): Promise<IngestDocumentResult> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, input.municipalityId);
  if (!municipality) {
    throw new Error('Municipio no encontrado para ingesta RAG.');
  }

  const cleanText = input.text.trim();
  if (!cleanText) {
    throw new Error('El documento no contiene texto indexable.');
  }

  const chunks = chunkText(cleanText, 720, 100);
  const documentId = `doc-${crypto.randomUUID()}`;
  const docStatus: 'VIGENTE' | 'DEROGADA' =
    input.status === 'DEROGADA' ? 'DEROGADA' : 'VIGENTE';
  const validUntil = input.validUntil?.trim() ? input.validUntil.trim() : null;
  const sourceUrl = input.sourceUrl?.trim() ? input.sourceUrl.trim() : null;
  const category = input.category?.trim() ? input.category.trim() : 'normativa_municipal';

  const geminiKey = await getGeminiEmbeddingKey(db, municipality.id);

  let rawVectors: Array<number[] | null> = new Array(chunks.length).fill(null);
  if (geminiKey) {
    const textsForEmbed = chunks.map(
      (chunkContent) => `${input.filename} (${category})\n${chunkContent}`
    );
    rawVectors = await generateGeminiEmbeddingsBatch(textsForEmbed, geminiKey);
  }

  let vectorCount = 0;
  const vectorLiterals = rawVectors.map((vec) => {
    const lit = toPgVectorLiteral(vec);
    if (lit) vectorCount++;
    return lit;
  });

  await db.withTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO rag_documents (
         id, municipality_id, filename, doc_type, category, source_url, status, valid_until,
         usage_count, char_count, chunk_count, uploaded_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10, $11)`,
      [
        documentId,
        municipality.id,
        input.filename,
        input.docType.toUpperCase(),
        category,
        sourceUrl,
        docStatus,
        validUntil,
        cleanText.length,
        chunks.length,
        input.uploadedBy ?? null,
      ]
    );

    for (let index = 0; index < chunks.length; index++) {
      const chunkId = `${documentId}-c${index + 1}`;
      const chunkContent = chunks[index];
      const vecLiteral = vectorLiterals[index];
      const embeddingModel = vecLiteral ? GEMINI_EMBEDDING_MODEL : null;

      await tx.execute(
        `INSERT INTO rag_chunks (chunk_id, document_id, municipality_id, filename, content, embedding, embedding_model)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7)`,
        [
          chunkId,
          documentId,
          municipality.id,
          input.filename,
          chunkContent,
          vecLiteral,
          embeddingModel,
        ]
      );
      await tx.execute(
        `INSERT INTO rag_chunks_fts (chunk_id, document_id, municipality_id, filename, content, embedding, embedding_model)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7)`,
        [
          chunkId,
          documentId,
          municipality.id,
          input.filename,
          chunkContent,
          vecLiteral,
          embeddingModel,
        ]
      );
    }
  });

  return {
    documentId,
    municipalityId: municipality.id,
    filename: input.filename,
    category,
    charCount: cleanText.length,
    chunkCount: chunks.length,
    vectorCount,
    embeddingModel: vectorCount > 0 ? GEMINI_EMBEDDING_MODEL : null,
    status: docStatus,
    validUntil,
  };
}

/**
 * Ingesta masiva por lotes de documentos oficiales scrapeados (Sede Electrónica, Trámites SIA y Leyes BOE).
 * Vectoriza todos los fragmentos con `batchEmbedContents` (`gemini-embedding-001`) e inserta de forma idempotente.
 */
export async function ingestScrapedDocumentsBatch({
  municipalityId,
  documents,
  uploadedBy,
  validUntil = null,
}: {
  municipalityId: string;
  documents: ScrapedMunicipalDoc[];
  uploadedBy?: string | null;
  validUntil?: string | null;
}): Promise<BatchIngestResult> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) {
    throw new Error('Municipio no encontrado para sincronización RAG.');
  }

  interface PreparedDoc {
    docId: string;
    filename: string;
    docType: string;
    category: string;
    sourceUrl: string | null;
    charCount: number;
    chunks: Array<{
      chunkId: string;
      content: string;
      embedInput: string;
    }>;
  }

  const preparedDocs: PreparedDoc[] = [];
  const allEmbedInputs: string[] = [];

  for (const doc of documents) {
    const cleanText = doc.texto.trim();
    if (!cleanText || cleanText.length < 30) continue;

    const safeSlug = doc.id
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 64);
    const docId = `doc-${municipality.slug}-${safeSlug}`;
    const filename = doc.titulo.trim();
    const category = doc.categoria.trim() || 'sede_electronica';
    const sourceUrl = doc.fuente_url?.trim() || null;
    const docType = category.startsWith('ley_boe')
      ? 'BOE'
      : category === 'tramite_sede'
      ? 'SIA'
      : 'SEDE';

    const rawChunks = chunkText(cleanText, 720, 100);
    const docChunks = rawChunks.map((rawChunk, idx) => {
      const hasTitlePrefix = rawChunk
        .toLowerCase()
        .startsWith(filename.toLowerCase().slice(0, 20));
      const content = hasTitlePrefix ? rawChunk : `${filename}\n${rawChunk}`;
      const embedInput = `${filename} (${category})\nFuente: ${sourceUrl ?? 'Oficial'}\n${rawChunk}`;
      allEmbedInputs.push(embedInput);
      return {
        chunkId: `${docId}-c${idx + 1}`,
        content,
        embedInput,
      };
    });

    if (docChunks.length === 0) continue;

    preparedDocs.push({
      docId,
      filename,
      docType,
      category,
      sourceUrl,
      charCount: cleanText.length,
      chunks: docChunks,
    });
  }

  const geminiKey = await getGeminiEmbeddingKey(db, municipality.id);

  // Recuperar vectores existentes de pgvector para no recalcular ni perder embeddings ya generados
  const existingChunkVectors = await db.query<{
    chunk_id: string;
    embedding_text: string | null;
    embedding_model: string | null;
  }>(
    `SELECT chunk_id, embedding::text AS embedding_text, embedding_model
     FROM rag_chunks
     WHERE municipality_id = $1
       AND embedding IS NOT NULL
       AND embedding_model = $2`,
    [municipality.id, GEMINI_EMBEDDING_MODEL]
  );
  const existingVecMap = new Map<string, string>();
  for (const row of existingChunkVectors) {
    if (row.embedding_text) {
      existingVecMap.set(row.chunk_id, row.embedding_text);
    }
  }

  interface FlatChunkRecord {
    chunkId: string;
    docId: string;
    filename: string;
    content: string;
    embedInput: string;
    vecLiteral: string | null;
    embeddingModel: string | null;
  }

  const flatChunks: FlatChunkRecord[] = [];
  const missingIndices: number[] = [];
  const missingInputs: string[] = [];

  for (const pDoc of preparedDocs) {
    for (const ch of pDoc.chunks) {
      const cachedVec = existingVecMap.get(ch.chunkId) ?? null;
      const idx = flatChunks.length;
      flatChunks.push({
        chunkId: ch.chunkId,
        docId: pDoc.docId,
        filename: pDoc.filename,
        content: ch.content,
        embedInput: ch.embedInput,
        vecLiteral: cachedVec,
        embeddingModel: cachedVec ? GEMINI_EMBEDDING_MODEL : null,
      });
      if (!cachedVec) {
        missingIndices.push(idx);
        missingInputs.push(ch.embedInput);
      }
    }
  }

  if (geminiKey && missingInputs.length > 0) {
    const newVectors = await generateGeminiEmbeddingsBatch(missingInputs, geminiKey);
    for (let i = 0; i < missingIndices.length; i++) {
      const lit = toPgVectorLiteral(newVectors[i]);
      if (lit) {
        const targetIdx = missingIndices[i];
        flatChunks[targetIdx].vecLiteral = lit;
        flatChunks[targetIdx].embeddingModel = GEMINI_EMBEDDING_MODEL;
      }
    }
  }

  const vectorsGenerated = flatChunks.reduce(
    (acc, ch) => acc + (ch.vecLiteral ? 1 : 0),
    0
  );

  await db.withTransaction(async (tx) => {
    const existingRows = await tx.query<{
      id: string;
      usage_count: number;
      status: 'VIGENTE' | 'DEROGADA';
    }>(
      `SELECT id,
              COALESCE(usage_count, 0) AS usage_count,
              COALESCE(status, 'VIGENTE') AS status
       FROM rag_documents
       WHERE municipality_id = $1`,
      [municipality.id]
    );
    const existingMap = new Map(existingRows.map((r) => [r.id, r]));

    const docIds = preparedDocs.map((d) => d.docId);
    if (docIds.length > 0) {
      await tx.execute(
        `DELETE FROM rag_chunks_fts WHERE municipality_id = $1 AND document_id = ANY($2::text[])`,
        [municipality.id, docIds]
      );
      await tx.execute(
        `DELETE FROM rag_chunks WHERE municipality_id = $1 AND document_id = ANY($2::text[])`,
        [municipality.id, docIds]
      );
      await tx.execute(
        `DELETE FROM rag_documents WHERE municipality_id = $1 AND id = ANY($2::text[])`,
        [municipality.id, docIds]
      );
    }

    const DOC_BATCH = 40;
    for (let i = 0; i < preparedDocs.length; i += DOC_BATCH) {
      const slice = preparedDocs.slice(i, i + DOC_BATCH);
      const valuesSql: string[] = [];
      const params: unknown[] = [];
      let pIdx = 1;

      for (const pDoc of slice) {
        const prev = existingMap.get(pDoc.docId);
        valuesSql.push(
          `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`
        );
        params.push(
          pDoc.docId,
          municipality.id,
          pDoc.filename,
          pDoc.docType,
          pDoc.category,
          pDoc.sourceUrl,
          prev?.status ?? 'VIGENTE',
          validUntil,
          prev?.usage_count ?? 0,
          pDoc.charCount,
          pDoc.chunks.length,
          uploadedBy ?? null
        );
      }

      await tx.execute(
        `INSERT INTO rag_documents (
           id, municipality_id, filename, doc_type, category, source_url, status, valid_until,
           usage_count, char_count, chunk_count, uploaded_by
         ) VALUES ${valuesSql.join(', ')}`,
        params
      );
    }

    const CHUNK_BATCH = 45;
    for (let i = 0; i < flatChunks.length; i += CHUNK_BATCH) {
      const slice = flatChunks.slice(i, i + CHUNK_BATCH);
      const valuesSql: string[] = [];
      const params: unknown[] = [];
      let pIdx = 1;

      for (const ch of slice) {
        valuesSql.push(
          `($${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}::vector, $${pIdx++})`
        );
        params.push(
          ch.chunkId,
          ch.docId,
          municipality.id,
          ch.filename,
          ch.content,
          ch.vecLiteral,
          ch.embeddingModel
        );
      }

      await tx.execute(
        `INSERT INTO rag_chunks (chunk_id, document_id, municipality_id, filename, content, embedding, embedding_model)
         VALUES ${valuesSql.join(', ')}`,
        params
      );
      await tx.execute(
        `INSERT INTO rag_chunks_fts (chunk_id, document_id, municipality_id, filename, content, embedding, embedding_model)
         VALUES ${valuesSql.join(', ')}`,
        params
      );
    }
  });

  return {
    municipalityId: municipality.id,
    documentsIndexed: preparedDocs.length,
    chunksIndexed: allEmbedInputs.length,
    vectorsGenerated,
    embeddingModel: vectorsGenerated > 0 ? GEMINI_EMBEDDING_MODEL : null,
  };
}

export async function deleteDocument(
  municipalityId: string,
  documentId: string
): Promise<{ deleted: boolean }> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) {
    return { deleted: false };
  }

  let deleted = false;
  await db.withTransaction(async (tx) => {
    await tx.execute(
      `DELETE FROM rag_chunks_fts WHERE document_id = $1 AND municipality_id = $2`,
      [documentId, municipality.id]
    );
    await tx.execute(
      `DELETE FROM rag_chunks WHERE document_id = $1 AND municipality_id = $2`,
      [documentId, municipality.id]
    );
    const res = await tx.execute(
      `DELETE FROM rag_documents WHERE id = $1 AND municipality_id = $2`,
      [documentId, municipality.id]
    );
    deleted = res.changes > 0;
  });

  return { deleted };
}

async function ensureMissingChunkEmbeddings(
  db: DbClient,
  municipalityId: string,
  geminiKey: string
): Promise<void> {
  const missing = await db.query<{
    chunk_id: string;
    filename: string;
    content: string;
  }>(
    `SELECT chunk_id, filename, content
     FROM rag_chunks
     WHERE municipality_id = $1
       AND (embedding IS NULL OR embedding_model IS DISTINCT FROM $2)
     LIMIT $3`,
    [municipalityId, GEMINI_EMBEDDING_MODEL, GEMINI_BATCH_SIZE]
  );

  if (missing.length === 0) return;

  const texts = missing.map((row) => `${row.filename}\n${row.content}`);
  const vectors = await generateGeminiEmbeddingsBatch(texts, geminiKey);

  for (let i = 0; i < missing.length; i++) {
    const literal = toPgVectorLiteral(vectors[i]);
    if (!literal) continue;
    const chunkId = missing[i].chunk_id;
    await db.execute(
      `UPDATE rag_chunks
       SET embedding = $1::vector, embedding_model = $2
       WHERE chunk_id = $3 AND municipality_id = $4`,
      [literal, GEMINI_EMBEDDING_MODEL, chunkId, municipalityId]
    );
    await db.execute(
      `UPDATE rag_chunks_fts
       SET embedding = $1::vector, embedding_model = $2
       WHERE chunk_id = $3 AND municipality_id = $4`,
      [literal, GEMINI_EMBEDDING_MODEL, chunkId, municipalityId]
    );
  }
}

async function incrementDocumentUsage(
  db: DbClient,
  municipalityId: string,
  chunks: RetrievedChunk[]
): Promise<void> {
  const docIds = Array.from(new Set(chunks.map((c) => c.documentId)));
  for (const docId of docIds) {
    await db.execute(
      `UPDATE rag_documents
       SET usage_count = COALESCE(usage_count, 0) + 1
       WHERE id = $1 AND municipality_id = $2`,
      [docId, municipalityId]
    );
  }
}

/**
 * Detecta si una consulta tiene coincidencia léxica directa con un trámite oficial,
 * código SIA, ley del BOE o concepto municipal específico dentro del fragmento.
 */
function hasDirectProcedureOrLawMatch(
  normalizedQuery: string,
  queryTokens: string[],
  normalizedTitle: string,
  normalizedContent: string,
  pgRank: number,
  bm25Score: number,
  matchedTermCount: number,
  titleMatchCount: number
): boolean {
  // 1. Coincidencia exacta de Código SIA (ej. 3318987)
  const siaMatch = normalizedQuery.match(/\b(331\d{4})\b/);
  if (siaMatch && normalizedContent.includes(siaMatch[1])) {
    return true;
  }

  // 2. Coincidencia directa de número de Ley o Real Decreto (ej. "39/2015", "40/2015", "7/1985", "58/2003", "38/2003", "7/2021")
  const lawNumberMatch = normalizedQuery.match(/\b(\d{1,3}\/\d{4})\b/);
  if (
    lawNumberMatch &&
    (normalizedContent.includes(lawNumberMatch[1]) ||
      normalizedTitle.includes(lawNumberMatch[1]))
  ) {
    return true;
  }

  // 3. Coincidencia en el título oficial del trámite o ley
  if (titleMatchCount >= 1 && (bm25Score >= 1.5 || pgRank >= 0.02)) {
    return true;
  }

  // 4. Coincidencia de frase de >= 5 caracteres o >= 2 términos significativos con BM25 sólido
  if (
    normalizedQuery.length >= 5 &&
    (normalizedTitle.includes(normalizedQuery) ||
      normalizedContent.includes(normalizedQuery))
  ) {
    return true;
  }

  if (queryTokens.length >= 2 && matchedTermCount >= 2 && bm25Score >= 1.8) {
    return true;
  }

  if (queryTokens.length === 1 && matchedTermCount === 1 && bm25Score >= 1.5) {
    return true;
  }

  if (pgRank >= 0.04 && bm25Score >= 1.4) {
    return true;
  }

  return false;
}

/**
 * Recuperación híbrida contrastada:
 * 1. Búsqueda vectorial coseno con `gemini-embedding-001` en `pgvector` (espacio homogéneo, umbral calibrado >= 0.45).
 * 2. Búsqueda léxica PostgreSQL Full-Text Search (`ts_rank_cd` + Okapi BM25) con detección de trámite, código SIA o ley BOE.
 * 3. Fusión de ambos rankings sin falsos rechazos; si ninguno tiene respaldo, devuelve `[]` para activar escalado a humano.
 */
export async function retrieveContext({
  municipalityId,
  query,
  topK = 3,
  maxChars = 1800,
  trackUsage = true,
}: {
  municipalityId: string;
  query: string;
  topK?: number;
  maxChars?: number;
  trackUsage?: boolean;
}): Promise<RetrievedChunk[]> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) return [];

  const todayIso = new Date().toISOString().slice(0, 10);
  const vectorCandidates = new Map<string, RetrievedChunk>();

  // 1. Búsqueda vectorial homogénea con pgvector (<=> similitud coseno) exclusivamente sobre vectores `gemini-embedding-001`
  const geminiKey = await getGeminiEmbeddingKey(db, municipality.id);
  if (geminiKey) {
    await ensureMissingChunkEmbeddings(db, municipality.id, geminiKey);
    const queryEmbedding = await generateGeminiEmbedding(query, geminiKey);
    const queryVecLiteral = toPgVectorLiteral(queryEmbedding);

    if (queryVecLiteral) {
      const vecRows = await db.query<VectorChunkRow>(
        `SELECT c.chunk_id, c.document_id, c.municipality_id, c.filename, c.content,
                d.category, d.source_url, d.valid_until, d.created_at,
                (1 - (c.embedding <=> $2::vector))::float8 AS score
         FROM rag_chunks c
         JOIN rag_documents d ON d.id = c.document_id
         WHERE c.municipality_id = $1
           AND c.embedding IS NOT NULL
           AND COALESCE(c.embedding_model, $4) = $4
           AND COALESCE(d.status, 'VIGENTE') = 'VIGENTE'
           AND (d.valid_until IS NULL OR d.valid_until = '' OR d.valid_until >= $5)
         ORDER BY c.embedding <=> $2::vector ASC
         LIMIT $3`,
        [
          municipality.id,
          queryVecLiteral,
          Math.max(topK * 4, 12),
          GEMINI_EMBEDDING_MODEL,
          todayIso,
        ]
      );

      for (const r of vecRows) {
        const vScore = Number(r.score);
        if (vScore >= CALIBRATED_VECTOR_THRESHOLD) {
          vectorCandidates.set(r.chunk_id, {
            chunkId: r.chunk_id,
            documentId: r.document_id,
            filename: r.filename,
            category: r.category ?? null,
            content: r.content,
            score: Number(vScore.toFixed(4)),
            vectorScore: Number(vScore.toFixed(4)),
            retrievalMethod: 'vector',
            sourceUrl: r.source_url ?? null,
            validUntil: r.valid_until ?? null,
            createdAt: r.created_at ?? null,
          });
        }
      }
    }
  }

  // 2. Búsqueda léxica FTS en PostgreSQL (`ts_rank_cd` + Okapi BM25) sobre documentos VIGENTES
  const queryTokens = Array.from(new Set(tokenizeForSearch(query)));
  const rows =
    queryTokens.length > 0
      ? await db.query<FtsChunkRow>(
          `SELECT c.chunk_id, c.document_id, c.municipality_id, c.filename, c.content,
                  d.category, d.source_url, d.valid_until, d.created_at,
                  ts_rank_cd(
                    to_tsvector('spanish', c.filename || ' ' || c.content),
                    plainto_tsquery('spanish', $2)
                  )::float8 AS pg_rank
           FROM rag_chunks_fts c
           JOIN rag_documents d ON d.id = c.document_id
           WHERE c.municipality_id = $1
             AND COALESCE(d.status, 'VIGENTE') = 'VIGENTE'
             AND (d.valid_until IS NULL OR d.valid_until = '' OR d.valid_until >= $3)`,
          [municipality.id, query, todayIso]
        )
      : [];

  const lexicalCandidates = new Map<string, RetrievedChunk>();

  if (rows.length > 0 && queryTokens.length > 0) {
    const docTokenCounts: number[] = [];
    const docTermFreqs: Array<Map<string, number>> = [];
    const docFileTokens: Array<Set<string>> = [];
    const docNormalizedTexts: string[] = [];
    const docNormalizedTitles: string[] = [];
    const docFreq = new Map<string, number>();

    for (const row of rows) {
      const tokens = tokenizeForSearch(row.content);
      const fileTokens = new Set(tokenizeForSearch(row.filename));
      docTokenCounts.push(tokens.length);
      docFileTokens.push(fileTokens);
      docNormalizedTexts.push(normalizeClean(row.content));
      docNormalizedTitles.push(normalizeClean(row.filename));

      const tf = new Map<string, number>();
      for (const tok of tokens) {
        tf.set(tok, (tf.get(tok) ?? 0) + 1);
      }
      docTermFreqs.push(tf);

      const uniqueTerms = new Set([...tokens, ...Array.from(fileTokens)]);
      for (const term of Array.from(uniqueTerms)) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }

    const N = rows.length;
    const avgdl =
      docTokenCounts.reduce((acc, len) => acc + len, 0) / Math.max(1, N);
    const k1 = 1.5;
    const b = 0.75;
    const normalizedQuery = normalizeClean(query);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const tfMap = docTermFreqs[i];
      const dl = Math.max(1, docTokenCounts[i]);
      const fileSet = docFileTokens[i];
      const pgRank = Number(row.pg_rank ?? 0);
      let bm25Score = pgRank * 3.0;
      let matchedTermCount = 0;
      let titleMatchCount = 0;

      for (const term of queryTokens) {
        const df = docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const tf = tfMap.get(term) ?? 0;

        if (tf > 0) {
          matchedTermCount++;
          const denom = tf + k1 * (1 - b + (b * dl) / Math.max(1, avgdl));
          bm25Score += idf * ((tf * (k1 + 1)) / denom);
        }

        if (fileSet.has(term)) {
          titleMatchCount++;
          bm25Score += idf * 0.9;
        }
      }

      if (
        normalizedQuery.length >= 4 &&
        docNormalizedTexts[i].includes(normalizedQuery)
      ) {
        bm25Score += 2.5;
      }

      const isDirectMatch = hasDirectProcedureOrLawMatch(
        normalizedQuery,
        queryTokens,
        docNormalizedTitles[i],
        docNormalizedTexts[i],
        pgRank,
        bm25Score,
        matchedTermCount,
        titleMatchCount
      );

      const hasLexicalTokenOverlap =
        matchedTermCount >= 1 || titleMatchCount >= 1 || pgRank > 0.01;

      // Si el fragmento tiene coincidencia léxica directa o tiene respaldo vectorial (>= 0.45) + solapamiento léxico
      if (
        isDirectMatch ||
        (vectorCandidates.has(row.chunk_id) && hasLexicalTokenOverlap)
      ) {
        lexicalCandidates.set(row.chunk_id, {
          chunkId: row.chunk_id,
          documentId: row.document_id,
          filename: row.filename,
          category: row.category ?? null,
          content: row.content,
          score: Number(bm25Score.toFixed(4)),
          lexicalScore: Number(bm25Score.toFixed(4)),
          retrievalMethod: 'fts',
          sourceUrl: row.source_url ?? null,
          validUntil: row.valid_until ?? null,
          createdAt: row.created_at ?? null,
        });
      }
    }
  }

  // 3. Fusión Híbrida (Vector + FTS) con calibración contra falsos positivos fuera de dominio
  const mergedMap = new Map<string, RetrievedChunk>();

  for (const [chunkId, vecChunk] of Array.from(vectorCandidates.entries())) {
    const lexChunk = lexicalCandidates.get(chunkId);
    const vScore = vecChunk.vectorScore ?? vecChunk.score;
    if (lexChunk && (lexChunk.lexicalScore ?? 0) > 0) {
      const lexicalBoost = Math.min(0.35, (lexChunk.lexicalScore ?? 0) * 0.05);
      const hybridScore = Number((vScore + lexicalBoost).toFixed(4));
      mergedMap.set(chunkId, {
        ...vecChunk,
        score: hybridScore,
        lexicalScore: lexChunk.lexicalScore,
        retrievalMethod: 'hybrid',
      });
    } else if (vScore >= PURE_VECTOR_HIGH_CONFIDENCE) {
      // Solo aceptar candidato vectorial sin ningún término léxico en común si supera alta confianza semántica (>= 0.66)
      mergedMap.set(chunkId, vecChunk);
    }
  }

  for (const [chunkId, lexChunk] of Array.from(lexicalCandidates.entries())) {
    if (!mergedMap.has(chunkId)) {
      // Normalizar score léxico puro a escala comparable [0.46 .. 0.92] cuando entra por coincidencia directa FTS
      const normalizedLexScore = Number(
        Math.min(0.92, 0.46 + (lexChunk.lexicalScore ?? 1) * 0.045).toFixed(4)
      );
      mergedMap.set(chunkId, {
        ...lexChunk,
        score: vectorCandidates.size > 0 ? normalizedLexScore : lexChunk.score,
      });
    }
  }

  const combined = Array.from(mergedMap.values()).sort(
    (a, b) => b.score - a.score
  );

  if (combined.length === 0) {
    return [];
  }

  const selected = selectWithinBudget(combined, topK, maxChars);
  if (trackUsage && selected.length > 0) {
    await incrementDocumentUsage(db, municipality.id, selected);
  }
  return selected;
}
