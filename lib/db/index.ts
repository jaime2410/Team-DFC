import fs from 'fs';
import path from 'path';
import initSqlJs, { type Database as SqlJsDatabase, type SqlValue } from 'sql.js';
import { seedDatabase } from './seed';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'almeriacerca.db');

export interface PreparedStatement {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
  run: (...params: unknown[]) => { changes: number };
}

export interface DbClient {
  prepare: (sql: string) => PreparedStatement;
  exec: (sql: string) => void;
  transaction: <T extends (...args: never[]) => unknown>(fn: T) => T;
  saveToDisk: () => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __almeriacercaDb: DbClient | undefined;
  // eslint-disable-next-line no-var
  var __almeriacercaDbPromise: Promise<DbClient> | undefined;
}

function toSqlValue(val: unknown): SqlValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number' || typeof val === 'string' || val instanceof Uint8Array) {
    return val;
  }
  return String(val);
}

function normalizeBindArgs(params: unknown[]): SqlValue[] | Record<string, SqlValue> | undefined {
  if (params.length === 0) return undefined;
  if (params.length === 1) {
    const single = params[0];
    if (Array.isArray(single)) {
      return single.map(toSqlValue);
    }
    if (single !== null && typeof single === 'object' && !(single instanceof Uint8Array)) {
      const mapped: Record<string, SqlValue> = {};
      for (const [k, v] of Object.entries(single as Record<string, unknown>)) {
        mapped[k] = toSqlValue(v);
      }
      return mapped;
    }
  }
  return params.map(toSqlValue);
}

function createDbClient(rawDb: SqlJsDatabase): DbClient {
  let inTransaction = false;

  const saveToDisk = () => {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const exported = rawDb.export();
    fs.writeFileSync(DB_PATH, Buffer.from(exported));
  };

  const client: DbClient = {
    prepare(sql: string): PreparedStatement {
      return {
        all(...params: unknown[]) {
          const stmt = rawDb.prepare(sql);
          try {
            const bound = normalizeBindArgs(params);
            if (bound !== undefined) {
              stmt.bind(bound);
            }
            const rows: unknown[] = [];
            while (stmt.step()) {
              rows.push(stmt.getAsObject());
            }
            return rows;
          } finally {
            stmt.free();
          }
        },
        get(...params: unknown[]) {
          const stmt = rawDb.prepare(sql);
          try {
            const bound = normalizeBindArgs(params);
            if (bound !== undefined) {
              stmt.bind(bound);
            }
            return stmt.step() ? stmt.getAsObject() : undefined;
          } finally {
            stmt.free();
          }
        },
        run(...params: unknown[]) {
          const stmt = rawDb.prepare(sql);
          try {
            const bound = normalizeBindArgs(params);
            if (bound !== undefined) {
              stmt.bind(bound);
            }
            stmt.step();
            const changes = rawDb.getRowsModified();
            if (!inTransaction) {
              saveToDisk();
            }
            return { changes };
          } finally {
            stmt.free();
          }
        },
      };
    },

    exec(sql: string) {
      rawDb.exec(sql);
      if (!inTransaction) {
        saveToDisk();
      }
    },

    transaction<T extends (...args: never[]) => unknown>(fn: T): T {
      return ((...args: Parameters<T>) => {
        const nested = inTransaction;
        if (!nested) {
          inTransaction = true;
          rawDb.exec('BEGIN TRANSACTION');
        }
        try {
          const result = fn(...args);
          if (!nested) {
            rawDb.exec('COMMIT');
            inTransaction = false;
            saveToDisk();
          }
          return result;
        } catch (err) {
          if (!nested) {
            try {
              rawDb.exec('ROLLBACK');
            } catch {
              // Ignore rollback failure
            }
            inTransaction = false;
          }
          throw err;
        }
      }) as T;
    },

    saveToDisk,
  };

  return client;
}

function initSchema(db: DbClient): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS municipalities (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      province TEXT NOT NULL,
      center_lat REAL NOT NULL,
      center_lng REAL NOT NULL,
      streets_json TEXT NOT NULL,
      whatsapp_phone_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('CITIZEN', 'ADMIN', 'DEPARTMENT')),
      department_name TEXT,
      preferred_lang TEXT NOT NULL DEFAULT 'es',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS citizen_profiles (
      user_id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      user_id TEXT,
      tracking_code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      photo_url TEXT,
      resolved_photo_url TEXT,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS consultations (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      topic TEXT,
      lang TEXT NOT NULL DEFAULT 'es',
      channel TEXT NOT NULL DEFAULT 'WEB' CHECK (channel IN ('WEB', 'WHATSAPP')),
      tokens_saved INTEGER NOT NULL DEFAULT 0,
      provider_used TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rag_documents (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      char_count INTEGER NOT NULL,
      chunk_count INTEGER NOT NULL,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rag_chunks (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      municipality_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rag_chunks_fts (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      municipality_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_provider_keys (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('GEMINI', 'GROQ', 'OPENAI', 'OPENROUTER', 'LOCAL')),
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (municipality_id, provider),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_configs (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      feature_key TEXT NOT NULL CHECK (feature_key IN ('CHAT', 'CLASSIFY', 'VISION')),
      primary_provider TEXT NOT NULL,
      primary_model TEXT NOT NULL,
      backups_json TEXT NOT NULL,
      max_tokens INTEGER NOT NULL DEFAULT 300,
      temperature REAL NOT NULL DEFAULT 0.2,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (municipality_id, feature_key),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS municipal_aids (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      discount_label TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      deadline TEXT,
      apply_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS street_alerts (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      affected_streets_json TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      municipality_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('STREET_ALERT', 'AID_MATCH', 'INCIDENT_UPDATE')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      ref_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS faq_cache (
      id TEXT PRIMARY KEY,
      municipality_id TEXT NOT NULL,
      normalized_question TEXT NOT NULL,
      lang TEXT NOT NULL,
      answer TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (municipality_id, normalized_question, lang),
      FOREIGN KEY (municipality_id) REFERENCES municipalities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_incidents_muni ON incidents(municipality_id);
    CREATE INDEX IF NOT EXISTS idx_aids_muni ON municipal_aids(municipality_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_muni ON street_alerts(municipality_id);
    CREATE INDEX IF NOT EXISTS idx_consultations_muni ON consultations(municipality_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON user_notifications(user_id, municipality_id);
    CREATE INDEX IF NOT EXISTS idx_rag_fts_muni ON rag_chunks_fts(municipality_id);
  `);
}

export async function getDb(): Promise<DbClient> {
  if (global.__almeriacercaDb) {
    return global.__almeriacercaDb;
  }

  if (!global.__almeriacercaDbPromise) {
    global.__almeriacercaDbPromise = (async () => {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const SQL = await initSqlJs({
        useOldExtensionFunctions: false,
        locateFile: (file: string) =>
          path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file),
      });

      const fileExists = fs.existsSync(DB_PATH);
      const rawDb = fileExists
        ? new SQL.Database(fs.readFileSync(DB_PATH))
        : new SQL.Database();

      const client = createDbClient(rawDb);
      initSchema(client);
      seedDatabase(client);
      client.saveToDisk();

      global.__almeriacercaDb = client;
      return client;
    })();
  }

  return global.__almeriacercaDbPromise;
}
