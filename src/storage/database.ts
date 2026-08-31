import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { del, get, set } from 'idb-keyval';

const DATABASE_NAME = 'sayable';
const STATE_KEY = 'sayable.state.v2';
const IDB_VERSION_KEY = 'sayable.schema-version';

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS local_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    detail TEXT,
    created_at INTEGER NOT NULL
  );
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_local_log_created_at
    ON local_log(created_at);
  `,
] as const;

export type PersistenceBackend = 'sqlite' | 'indexeddb';

let backend: PersistenceBackend = 'indexeddb';
let database: SQLiteDBConnection | null = null;

async function openNativeDatabase(): Promise<SQLiteDBConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await sqlite.checkConnectionsConsistency();
  const existing = await sqlite.isConnection(DATABASE_NAME, false);
  const db = existing.result
    ? await sqlite.retrieveConnection(DATABASE_NAME, false)
    : await sqlite.createConnection(DATABASE_NAME, false, 'no-encryption', 1, false);

  const opened = await db.isDBOpen();
  if (!opened.result) await db.open();

  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);',
  );
  const versionRows = await db.query('SELECT version FROM schema_version LIMIT 1;');
  let version = Number(versionRows.values?.[0]?.version ?? 0);
  if (!versionRows.values?.length) {
    await db.run('INSERT INTO schema_version(version) VALUES (?);', [0]);
  }

  while (version < MIGRATIONS.length) {
    await db.beginTransaction();
    try {
      await db.execute(MIGRATIONS[version], false);
      await db.run('UPDATE schema_version SET version = ?;', [version + 1], false);
      await db.commitTransaction();
      version += 1;
    } catch (error) {
      await db.rollbackTransaction().catch(() => undefined);
      throw error;
    }
  }

  return db;
}

export async function initPersistence(): Promise<PersistenceBackend> {
  if (Capacitor.isNativePlatform()) {
    database = await openNativeDatabase();
    backend = 'sqlite';
    return backend;
  }

  backend = 'indexeddb';
  const version = Number((await get(IDB_VERSION_KEY)) ?? 0);
  if (version < MIGRATIONS.length) await set(IDB_VERSION_KEY, MIGRATIONS.length);
  return backend;
}

export function persistenceBackend(): PersistenceBackend {
  return backend;
}

export async function loadPersistedState<T>(): Promise<T | null> {
  if (backend === 'sqlite') {
    if (!database) throw new Error('SQLite is not initialized');
    const result = await database.query('SELECT json FROM app_state WHERE id = 1;');
    const raw = result.values?.[0]?.json;
    return typeof raw === 'string' ? JSON.parse(raw) as T : null;
  }

  return (await get<T>(STATE_KEY)) ?? null;
}

export async function savePersistedState(value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  if (backend === 'sqlite') {
    if (!database) throw new Error('SQLite is not initialized');
    await database.beginTransaction();
    try {
      await database.run(
        `INSERT INTO app_state(id, json, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at;`,
        [json, Date.now()],
        false,
      );
      await database.commitTransaction();
    } catch (error) {
      await database.rollbackTransaction().catch(() => undefined);
      throw error;
    }
    return;
  }

  await set(STATE_KEY, value);
}

export async function clearPersistedState(): Promise<void> {
  if (backend === 'sqlite') {
    if (!database) throw new Error('SQLite is not initialized');
    await database.run('DELETE FROM app_state WHERE id = 1;');
    return;
  }

  await del(STATE_KEY);
}

export async function writeLocalLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  detail = '',
): Promise<void> {
  if (backend !== 'sqlite' || !database) return;
  await database.beginTransaction();
  try {
    await database.run(
      'INSERT INTO local_log(level, event, detail, created_at) VALUES (?, ?, ?, ?);',
      [level, event, detail.slice(0, 500), Date.now()],
      false,
    );
    await database.run(
      `DELETE FROM local_log
       WHERE id NOT IN (SELECT id FROM local_log ORDER BY id DESC LIMIT 500);`,
      [],
      false,
    );
    await database.commitTransaction();
  } catch (error) {
    await database.rollbackTransaction().catch(() => undefined);
    throw error;
  }
}
