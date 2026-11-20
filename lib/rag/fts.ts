import crypto from 'crypto';
import { getDb, type DbClient } from '@/lib/db';
import { resolveMunicipality } from '@/lib/db/municipalities';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  filename: string;
  content: string;
  score: number;
}

export interface IngestDocumentInput {
  municipalityId: string;
  filename: string;
  docType: string;
  text: string;
  uploadedBy?: string | null;
}

export interface IngestDocumentResult {
  documentId: string;
  municipalityId: string;
  filename: string;
  charCount: number;
  chunkCount: number;
}

interface FtsChunkRow {
  chunk_id: string;
  document_id: string;
  municipality_id: string;
  filename: string;
  content: string;
  pg_rank?: number;
}

interface VectorChunkRow {
  chunk_id: string;
  document_id: string;
  municipality_id: string;
  filename: string;
  content: string;
  score: number;
}

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al',
  'a', 'en', 'y', 'o', 'u', 'que', 'por', 'para', 'con', 'sin', 'sobre',
  'se', 'su', 'sus', 'mi', 'mis', 'tu', 'tus', 'es', 'son', 'fue', 'ser',
  'como', 'cuando', 'donde', 'cual', 'quien', 'hay', 'esta', 'este', 'esto',
  'the', 'is', 'are', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'a', 'an',
  'le', 'la', 'les', 'des', 'du', 'et', 'ou', 'est', 'dans', 'pour', 'avec',
]);

function tokenizeForSearch(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, ' ')
    .trim();

  if (!normalized) return [];
  const rawTokens = normalized.split(/\s+/).filter((t) => t.length > 1);
  const filtered = rawTokens.filter((t) => !STOPWORDS.has(t));
  return filtered.length > 0 ? filtered : rawTokens;
}

async function getGeminiEmbeddingKey(
  db: DbClient,
  municipalityId?: string
): Promise<string | null> {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (envKey) return envKey;

  if (!municipalityId) return null;
  const row = await db.queryOne<{ api_key: string }>(
    `SELECT api_key
     FROM ai_provider_keys
     WHERE municipality_id = $1 AND provider = 'GEMINI' AND enabled = 1 AND api_key <> ''
     LIMIT 1`,
    [municipalityId]
  );
  return row?.api_key?.trim() || null;
}

export async function generateGeminiEmbedding(
  text: string,
  apiKey: string
): Promise<number[] | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${encodeURIComponent(
        apiKey
      )}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          model: 'models/text-embedding-004',
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

  throw new Error('Formato no soportado. Usa archivos .pdf, .txt o .md.');
}

export function chunkText(
  text: string,
  wordsPerChunk = 350,
  overlap = 40
): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];

  const words = cleaned.split(/\s+/);
  if (words.length <= wordsPerChunk) {
    return [words.join(' ')];
  }

  const safeStep = Math.max(1, wordsPerChunk - Math.min(overlap, wordsPerChunk - 1));
  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + wordsPerChunk, words.length);
    chunks.push(words.slice(start, end).join(' '));
    if (end >= words.length) break;
    start += safeStep;
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

  const chunks = chunkText(cleanText, 350, 40);
  const documentId = `doc-${crypto.randomUUID()}`;
  const geminiKey = await getGeminiEmbeddingKey(db, municipality.id);

  const vectors: Array<string | null> = [];
  for (const chunkContent of chunks) {
    if (geminiKey) {
      const vec = await generateGeminiEmbedding(`${input.filename}\n${chunkContent}`, geminiKey);
      vectors.push(toPgVectorLiteral(vec));
    } else {
      vectors.push(null);
    }
  }

  await db.withTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO rag_documents (id, municipality_id, filename, doc_type, char_count, chunk_count, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        documentId,
        municipality.id,
        input.filename,
        input.docType.toUpperCase(),
        cleanText.length,
        chunks.length,
        input.uploadedBy ?? null,
      ]
    );

    for (let index = 0; index < chunks.length; index++) {
      const chunkId = `${documentId}-c${index + 1}`;
      const chunkContent = chunks[index];
      const vecLiteral = vectors[index];

      await tx.execute(
        `INSERT INTO rag_chunks (chunk_id, document_id, municipality_id, filename, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [chunkId, documentId, municipality.id, input.filename, chunkContent, vecLiteral]
      );
      await tx.execute(
        `INSERT INTO rag_chunks_fts (chunk_id, document_id, municipality_id, filename, content, embedding)
         VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [chunkId, documentId, municipality.id, input.filename, chunkContent, vecLiteral]
      );
    }
  });

  return {
    documentId,
    municipalityId: municipality.id,
    filename: input.filename,
    charCount: cleanText.length,
    chunkCount: chunks.length,
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
  const missing = await db.query<{ chunk_id: string; filename: string; content: string }>(
    `SELECT chunk_id, filename, content
     FROM rag_chunks
     WHERE municipality_id = $1 AND embedding IS NULL
     LIMIT 25`,
    [municipalityId]
  );

  for (const row of missing) {
    const vec = await generateGeminiEmbedding(`${row.filename}\n${row.content}`, geminiKey);
    const literal = toPgVectorLiteral(vec);
    if (!literal) break;
    await db.execute(
      `UPDATE rag_chunks SET embedding = $1::vector WHERE chunk_id = $2 AND municipality_id = $3`,
      [literal, row.chunk_id, municipalityId]
    );
    await db.execute(
      `UPDATE rag_chunks_fts SET embedding = $1::vector WHERE chunk_id = $2 AND municipality_id = $3`,
      [literal, row.chunk_id, municipalityId]
    );
  }
}

export async function retrieveContext({
  municipalityId,
  query,
  topK = 3,
  maxChars = 1800,
}: {
  municipalityId: string;
  query: string;
  topK?: number;
  maxChars?: number;
}): Promise<RetrievedChunk[]> {
  const db = await getDb();
  const municipality = await resolveMunicipality(db, municipalityId);
  if (!municipality) return [];

  // 1. Búsqueda vectorial real con pgvector (<=> similitud coseno + índice HNSW) cuando exista GEMINI_API_KEY
  const geminiKey = await getGeminiEmbeddingKey(db, municipality.id);
  if (geminiKey) {
    await ensureMissingChunkEmbeddings(db, municipality.id, geminiKey);
    const queryEmbedding = await generateGeminiEmbedding(query, geminiKey);
    const queryVecLiteral = toPgVectorLiteral(queryEmbedding);

    if (queryVecLiteral) {
      const vecRows = await db.query<VectorChunkRow>(
        `SELECT chunk_id, document_id, municipality_id, filename, content,
                (1 - (embedding <=> $2::vector))::float8 AS score
         FROM rag_chunks
         WHERE municipality_id = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector ASC
         LIMIT $3`,
        [municipality.id, queryVecLiteral, Math.max(topK * 2, 6)]
      );

      if (vecRows.length > 0) {
        const mapped: RetrievedChunk[] = vecRows
          .filter((r) => Number(r.score) > 0.25)
          .map((r) => ({
            chunkId: r.chunk_id,
            documentId: r.document_id,
            filename: r.filename,
            content: r.content,
            score: Number(Number(r.score).toFixed(4)),
          }));
        if (mapped.length > 0) {
          return selectWithinBudget(mapped, topK, maxChars);
        }
      }
    }
  }

  // 2. Respaldo automático: búsqueda textual en PostgreSQL (ts_rank_cd + BM25) filtrada por municipality_id
  const queryTokens = Array.from(new Set(tokenizeForSearch(query)));
  if (queryTokens.length === 0) return [];

  const rows = await db.query<FtsChunkRow>(
    `SELECT chunk_id, document_id, municipality_id, filename, content,
            ts_rank_cd(
              to_tsvector('spanish', filename || ' ' || content),
              plainto_tsquery('spanish', $2)
            )::float8 AS pg_rank
     FROM rag_chunks_fts
     WHERE municipality_id = $1`,
    [municipality.id, query]
  );

  if (rows.length === 0) return [];

  const docTokenCounts: number[] = [];
  const docTermFreqs: Array<Map<string, number>> = [];
  const docFileTokens: Array<Set<string>> = [];
  const docNormalizedTexts: string[] = [];
  const docFreq = new Map<string, number>();

  for (const row of rows) {
    const tokens = tokenizeForSearch(row.content);
    const fileTokens = new Set(tokenizeForSearch(row.filename));
    docTokenCounts.push(tokens.length);
    docFileTokens.push(fileTokens);
    docNormalizedTexts.push(
      row.content
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
    );

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
  const avgdl = docTokenCounts.reduce((acc, len) => acc + len, 0) / Math.max(1, N);
  const k1 = 1.5;
  const b = 0.75;

  const normalizedQuery = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const scored: RetrievedChunk[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tfMap = docTermFreqs[i];
    const dl = Math.max(1, docTokenCounts[i]);
    const fileSet = docFileTokens[i];
    let score = Number(row.pg_rank ?? 0) * 2.5;

    for (const term of queryTokens) {
      const df = docFreq.get(term) ?? 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const tf = tfMap.get(term) ?? 0;

      if (tf > 0) {
        const denom = tf + k1 * (1 - b + (b * dl) / Math.max(1, avgdl));
        score += idf * ((tf * (k1 + 1)) / denom);
      }

      if (fileSet.has(term)) {
        score += idf * 0.6;
      }
    }

    if (normalizedQuery.length >= 4 && docNormalizedTexts[i].includes(normalizedQuery)) {
      score += 2.0;
    }

    if (score > 0) {
      scored.push({
        chunkId: row.chunk_id,
        documentId: row.document_id,
        filename: row.filename,
        content: row.content,
        score: Number(score.toFixed(4)),
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return selectWithinBudget(scored, topK, maxChars);
}
