import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { seedDatabase } from './seed';

export interface DbClient {
  query: <T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<T[]>;
  queryOne: <T extends QueryResultRow = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<T | undefined>;
  execute: (sql: string, params?: unknown[]) => Promise<{ changes: number }>;
  withTransaction: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>;
}

declare global {
  // eslint-disable-next-line no-var
  var __almeriacercaPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __almeriacercaPgClient: DbClient | undefined;
  // eslint-disable-next-line no-var
  var __almeriacercaPgPromise: Promise<DbClient> | undefined;
}

function readDatabaseUrlFromEnvFile(): string | undefined {
  const envFiles = ['.env.local', '.env'];
  for (const filename of envFiles) {
    const filePath = path.resolve(process.cwd(), filename);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^DATABASE_URL\s*=\s*(.+)$/);
      if (!match) continue;
      let value = match[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value) return value;
    }
  }
  return undefined;
}

function toPgParams(sql: string): string {
  let out = '';
  let index = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      out += ch;
      continue;
    }
    if (ch === '?' && !inSingleQuote && !inDoubleQuote) {
      out += `$${index++}`;
      continue;
    }
    out += ch;
  }

  return out;
}

function normalizeParams(params?: unknown[]): unknown[] {
  if (!params || params.length === 0) return [];
  return params.map((val) => {
    if (val === undefined) return null;
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val;
  });
}

async function resolveConnectionConfig(rawUrl: string): Promise<{
  connectionString: string;
  ssl: { rejectUnauthorized: boolean } | undefined;
}> {
  const parsed = new URL(rawUrl);
  const supabaseDirect = parsed.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  const needsSsl =
    parsed.hostname.includes('supabase.') ||
    parsed.searchParams.get('sslmode') === 'require';

  if (supabaseDirect) {
    let hasIpv4 = false;
    try {
      await dns.promises.lookup(parsed.hostname, { family: 4 });
      hasIpv4 = true;
    } catch {
      hasIpv4 = false;
    }

    if (!hasIpv4) {
      const projectRef = supabaseDirect[1];
      const poolerHost =
        process.env.SUPABASE_POOLER_HOST || 'aws-0-eu-central-1.pooler.supabase.com';
      const pooled = new URL(rawUrl);
      pooled.hostname = poolerHost;
      pooled.port = parsed.port || '5432';
      if (!pooled.username.includes('.')) {
        pooled.username = `${pooled.username}.${projectRef}`;
      }
      return {
        connectionString: pooled.toString(),
        ssl: { rejectUnauthorized: false },
      };
    }
  }

  return {
    connectionString: rawUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  };
}

function wrapRunner(
  runner: Pick<Pool | PoolClient, 'query'>,
  pool: Pool
): DbClient {
  return {
    async query<T extends QueryResultRow = Record<string, unknown>>(
      sql: string,
      params?: unknown[]
    ): Promise<T[]> {
      const res = await runner.query<T>(toPgParams(sql), normalizeParams(params));
      return res.rows;
    },

    async queryOne<T extends QueryResultRow = Record<string, unknown>>(
      sql: string,
      params?: unknown[]
    ): Promise<T | undefined> {
      const res = await runner.query<T>(toPgParams(sql), normalizeParams(params));
      return res.rows[0];
    },

    async execute(sql: string, params?: unknown[]): Promise<{ changes: number }> {
      const res = await runner.query(toPgParams(sql), normalizeParams(params));
      return { changes: res.rowCount ?? 0 };
    },

    async withTransaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txClient = wrapRunner(client, pool);
        const result = await fn(txClient);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback failure
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

async function initSchema(db: DbClient): Promise<void> {
  await db.execute(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS municipalities (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      province TEXT NOT NULL,
      center_lat DOUBLE PRECISION NOT NULL,
      center_lng DOUBLE PRECISION NOT NULL,
      streets_json TEXT NOT NULL,
      whatsapp_phone_id TEXT,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('CITIZEN', 'ADMIN', 'DEPARTMENT')),
      department_name TEXT,
      preferred_lang TEXT NOT NULL DEFAULT 'es',
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS citizen_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      street_name TEXT,
      neighborhood TEXT,
      household_size INTEGER NOT NULL DEFAULT 1,
      has_children INTEGER NOT NULL DEFAULT 0,
      large_family INTEGER NOT NULL DEFAULT 0,
      has_seniors_or_dependents INTEGER NOT NULL DEFAULT 0,
      reduced_mobility INTEGER NOT NULL DEFAULT 0,
      income_bracket TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (income_bracket IN ('LOW', 'MEDIUM', 'HIGH')),
      interests_json TEXT NOT NULL DEFAULT '[]',
      whatsapp_phone TEXT,
      notifications_opt_in INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      tracking_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_url TEXT,
      resolved_photo_url TEXT,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      address_label TEXT,
      category TEXT NOT NULL,
      urgency TEXT NOT NULL CHECK (urgency IN ('BAJA', 'MEDIA', 'ALTA', 'CRITICA')),
      department TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDIENTE', 'EN_REVISION', 'EN_CURSO', 'RESUELTA')),
      ai_reasoning TEXT,
      ai_provider_used TEXT,
      channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB', 'WHATSAPP')),
      upvotes INTEGER NOT NULL DEFAULT 1,
      internal_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      updated_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS consultations (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      topic TEXT,
      lang TEXT NOT NULL DEFAULT 'es',
      channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB', 'WHATSAPP')),
      tokens_saved INTEGER NOT NULL DEFAULT 0,
      provider_used TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(768)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS rag_chunks_fts (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(768)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_provider_keys (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('GEMINI', 'GROQ', 'OPENAI', 'OPENROUTER', 'LOCAL')),
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      UNIQUE (municipality_id, provider)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_configs (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      feature_key TEXT NOT NULL CHECK (feature_key IN ('CHAT', 'CLASSIFY', 'VISION')),
      primary_provider TEXT NOT NULL,
      primary_model TEXT NOT NULL,
      backups_json TEXT NOT NULL,
      max_tokens INTEGER NOT NULL DEFAULT 300,
      temperature DOUBLE PRECISION NOT NULL DEFAULT 0.2,
      updated_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      UNIQUE (municipality_id, feature_key)
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS municipal_aids (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      discount_label TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      deadline TEXT,
      apply_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS street_alerts (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      affected_streets_json TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('STREET_ALERT', 'AID_MATCH', 'INCIDENT_UPDATE')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      ref_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS faq_cache (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL REFERENCES municipalities(id) ON DELETE CASCADE,
      normalized_question TEXT NOT NULL,
      lang TEXT NOT NULL,
      answer TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      UNIQUE (municipality_id, normalized_question, lang)
    );
  `);

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_incidents_muni ON incidents(municipality_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_aids_muni ON municipal_aids(municipality_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_alerts_muni ON street_alerts(municipality_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_consultations_muni ON consultations(municipality_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id, municipality_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_rag_chunks_muni ON rag_chunks(municipality_id);`);
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_rag_fts_muni ON rag_chunks_fts(municipality_id);`);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding_hnsw
      ON rag_chunks USING hnsw (embedding vector_cosine_ops);
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_rag_fts_embedding_hnsw
      ON rag_chunks_fts USING hnsw (embedding vector_cosine_ops);
  `);

  // Migraciones incrementales seguras (FASE 6 — Rúbrica Reto 2) sin pérdida de datos
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reporter_ids_json TEXT NOT NULL DEFAULT '[]';`);
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS citizen_rating INTEGER;`);
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS citizen_feedback TEXT;`);
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS reopened_count INTEGER NOT NULL DEFAULT 0;`);
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS is_quarantined INTEGER NOT NULL DEFAULT 0;`);
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS quarantine_reason TEXT;`);

  await db.execute(`ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;`);
  await db.execute(`ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_urgency_check;`);

  await db.execute(`UPDATE incidents SET status = 'RECIBIDO' WHERE status = 'PENDIENTE';`);
  await db.execute(`UPDATE incidents SET status = 'VISTO' WHERE status = 'EN_REVISION';`);
  await db.execute(`UPDATE incidents SET status = 'RESUELTO' WHERE status = 'RESUELTA';`);
  await db.execute(`UPDATE incidents SET urgency = 'URGENTE' WHERE urgency = 'CRITICA';`);
  await db.execute(`
    UPDATE incidents
    SET reporter_ids_json = '["' || user_id || '"]'
    WHERE user_id IS NOT NULL AND (reporter_ids_json IS NULL OR reporter_ids_json = '[]');
  `);

  await db.execute(`
    ALTER TABLE incidents ADD CONSTRAINT incidents_status_check
      CHECK (status IN ('RECIBIDO', 'VISTO', 'ASIGNADO', 'EN_CURSO', 'RESUELTO', 'PENDIENTE', 'EN_REVISION', 'RESUELTA'));
  `);
  await db.execute(`
    ALTER TABLE incidents ADD CONSTRAINT incidents_urgency_check
      CHECK (urgency IN ('BAJA', 'MEDIA', 'ALTA', 'URGENTE', 'EMERGENCIA_112', 'CRITICA'));
  `);

  await db.execute(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS source_url TEXT;`);
  await db.execute(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'VIGENTE';`);
  await db.execute(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS valid_until TEXT;`);
  await db.execute(`ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;`);

  await db.execute(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS escalated_to_human INTEGER NOT NULL DEFAULT 0;`);
  await db.execute(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS rag_doc_ids_json TEXT NOT NULL DEFAULT '[]';`);
  await db.execute(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS input_tokens INTEGER NOT NULL DEFAULT 0;`);
  await db.execute(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS output_tokens INTEGER NOT NULL DEFAULT 0;`);
  await db.execute(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS human_answer TEXT;`);
  await db.execute(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS answered_by TEXT;`);
  await db.execute(`ALTER TABLE consultations ADD COLUMN IF NOT EXISTS answered_at TEXT;`);

  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS viewed_at TEXT;`);
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS resolved_at TEXT;`);
  await db.execute(`ALTER TABLE incidents ADD COLUMN IF NOT EXISTS history_json TEXT NOT NULL DEFAULT '[]';`);

  // Backfill de tiempos reales e historial de auditoría para incidencias sembradas
  await db.execute(`
    UPDATE incidents
    SET viewed_at = created_at
    WHERE viewed_at IS NULL AND status IN ('VISTO', 'ASIGNADO', 'EN_CURSO', 'RESUELTO');
  `);
  await db.execute(`
    UPDATE incidents
    SET resolved_at = updated_at
    WHERE resolved_at IS NULL AND status = 'RESUELTO';
  `);
  await db.execute(`
    UPDATE incidents
    SET history_json = json_build_array(
      json_build_object(
        'status', 'RECIBIDO',
        'timestamp', created_at,
        'actor', 'Sistema Municipal',
        'note', 'Aviso registrado en el municipio.'
      ),
      json_build_object(
        'status', status,
        'timestamp', updated_at,
        'actor', department,
        'note', COALESCE(NULLIF(internal_notes, ''), 'Estado actual: ' || status)
      )
    )::text
    WHERE history_json IS NULL OR history_json = '[]';
  `);

  await db.execute(`ALTER TABLE faq_cache ADD COLUMN IF NOT EXISTS approved_by_admin INTEGER NOT NULL DEFAULT 1;`);

  // Migrar modelos Gemini retirados (404) a un modelo vigente y rápido
  await db.execute(`
    UPDATE ai_configs
    SET primary_model = 'gemini-3.5-flash-lite'
    WHERE primary_provider = 'GEMINI'
      AND primary_model IN ('gemini-2.0-flash', 'models/gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro');
  `);
}

export async function getDb(): Promise<DbClient> {
  if (global.__almeriacercaPgClient) {
    return global.__almeriacercaPgClient;
  }

  if (!global.__almeriacercaPgPromise) {
    global.__almeriacercaPgPromise = (async () => {
      const rawUrl = process.env.DATABASE_URL || readDatabaseUrlFromEnvFile();
      if (!rawUrl) {
        throw new Error('Falta la variable DATABASE_URL en .env.local o en el entorno.');
      }

      const { connectionString, ssl } = await resolveConnectionConfig(rawUrl);
      const pool =
        global.__almeriacercaPgPool ??
        new Pool({
          connectionString,
          ssl,
          max: 10,
          idleTimeoutMillis: 30000,
          connectionTimeoutMillis: 10000,
        });
      global.__almeriacercaPgPool = pool;

      const client = wrapRunner(pool, pool);
      await initSchema(client);
      await seedDatabase(client);

      global.__almeriacercaPgClient = client;
      return client;
    })().catch((err) => {
      global.__almeriacercaPgPromise = undefined;
      throw err;
    });
  }

  return global.__almeriacercaPgPromise;
}
