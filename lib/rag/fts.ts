import crypto from 'crypto';
import { getDb } from '@/lib/db';
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
  const municipality = resolveMunicipality(db, input.municipalityId);
  if (!municipality) {
    throw new Error('Municipio no encontrado para ingesta RAG.');
  }

  const cleanText = input.text.trim();
  if (!cleanText) {
    throw new Error('El documento no contiene texto indexable.');
  }

  const chunks = chunkText(cleanText, 350, 40);
  const documentId = `doc-${crypto.randomUUID()}`;

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO rag_documents (id, municipality_id, filename, doc_type, char_count, chunk_count, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      documentId,
      municipality.id,
      input.filename,
      input.docType.toUpperCase(),
      cleanText.length,
      chunks.length,
      input.uploadedBy ?? null
    );

    const insertChunk = db.prepare(
      `INSERT INTO rag_chunks (chunk_id, document_id, municipality_id, filename, content)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insertFts = db.prepare(
      `INSERT INTO rag_chunks_fts (chunk_id, document_id, municipality_id, filename, content)
       VALUES (?, ?, ?, ?, ?)`
    );

    chunks.forEach((chunkContent, index) => {
      const chunkId = `${documentId}-c${index + 1}`;
      insertChunk.run(chunkId, documentId, municipality.id, input.filename, chunkContent);
      insertFts.run(chunkId, documentId, municipality.id, input.filename, chunkContent);
    });
  });

  tx();

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
  const municipality = resolveMunicipality(db, municipalityId);
  if (!municipality) {
    return { deleted: false };
  }

  let deleted = false;
  const tx = db.transaction(() => {
    db.prepare(
      `DELETE FROM rag_chunks_fts WHERE document_id = ? AND municipality_id = ?`
    ).run(documentId, municipality.id);

    db.prepare(
      `DELETE FROM rag_chunks WHERE document_id = ? AND municipality_id = ?`
    ).run(documentId, municipality.id);

    const res = db
      .prepare(`DELETE FROM rag_documents WHERE id = ? AND municipality_id = ?`)
      .run(documentId, municipality.id);

    deleted = res.changes > 0;
  });

  tx();
  return { deleted };
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
  const municipality = resolveMunicipality(db, municipalityId);
  if (!municipality) return [];

  const queryTokens = Array.from(new Set(tokenizeForSearch(query)));
  if (queryTokens.length === 0) return [];

  const rows = db
    .prepare(
      `SELECT chunk_id, document_id, municipality_id, filename, content
       FROM rag_chunks_fts
       WHERE municipality_id = ?`
    )
    .all(municipality.id) as FtsChunkRow[];

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
  const avgdl =
    docTokenCounts.reduce((acc, len) => acc + len, 0) / Math.max(1, N);
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
    let score = 0;

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

  const selected: RetrievedChunk[] = [];
  let accumulatedChars = 0;

  for (const chunk of scored) {
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
