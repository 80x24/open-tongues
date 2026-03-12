// SQLite persistent storage (bun:sqlite)

import { Database } from "bun:sqlite";

export interface DB {
  getTranslations(domain: string, lang: string, originals: string[]): (string | null)[];
  setTranslations(entries: { domain: string; lang: string; original: string; translated: string }[]): void;
  deleteTranslationsByDomainLang(domain: string, lang: string): number;
  deleteTranslationsByDomain(domain: string): number;
  isReady(): boolean;
}

export function createDB(dbPath: string): DB {
  let db: Database | null = null;

  try {
    db = new Database(dbPath, { create: true });
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS translations (
        domain TEXT NOT NULL DEFAULT '',
        lang TEXT NOT NULL,
        original TEXT NOT NULL,
        translated TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (domain, lang, original)
      )
    `);
    console.log(`[db] SQLite initialized at ${dbPath}`);
  } catch (err: any) {
    console.error(`[db] SQLite init failed: ${err.message}`);
    db = null;
  }

  return {
    getTranslations(domain, lang, originals) {
      if (!db || originals.length === 0) return originals.map(() => null);
      try {
        const stmt = db.prepare(
          "SELECT translated FROM translations WHERE domain = ? AND lang = ? AND original = ?"
        );
        return originals.map((text) => {
          const row = stmt.get(domain, lang, text) as { translated: string } | null;
          return row?.translated ?? null;
        });
      } catch {
        return originals.map(() => null);
      }
    },

    setTranslations(entries) {
      if (!db || entries.length === 0) return;
      try {
        const stmt = db.prepare(
          "INSERT OR REPLACE INTO translations (domain, lang, original, translated) VALUES (?, ?, ?, ?)"
        );
        const tx = db.transaction(() => {
          for (const e of entries) {
            stmt.run(e.domain, e.lang, e.original, e.translated);
          }
        });
        tx();
      } catch (err: any) {
        console.error(`[db] write translations failed: ${err.message}`);
      }
    },

    deleteTranslationsByDomainLang(domain, lang) {
      if (!db) return 0;
      try {
        const result = db.prepare("DELETE FROM translations WHERE domain = ? AND lang = ?").run(domain, lang);
        return result.changes;
      } catch {
        return 0;
      }
    },

    deleteTranslationsByDomain(domain) {
      if (!db) return 0;
      try {
        const result = db.prepare("DELETE FROM translations WHERE domain = ?").run(domain);
        return result.changes;
      } catch {
        return 0;
      }
    },

    isReady() {
      return db !== null;
    },
  };
}

// --- Legacy exports for standalone server ---

let _db: Database | null = null;

export function initDB(): void {
  const dbPath = process.env.DB_PATH || "./tongues.db";
  try {
    _db = new Database(dbPath, { create: true });
    _db.exec("PRAGMA journal_mode=WAL");
    _db.exec("PRAGMA synchronous=NORMAL");

    _db.exec(`
      CREATE TABLE IF NOT EXISTS translations (
        domain TEXT NOT NULL DEFAULT '',
        lang TEXT NOT NULL,
        original TEXT NOT NULL,
        translated TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (domain, lang, original)
      )
    `);

    console.log(`[db] SQLite initialized at ${dbPath}`);
  } catch (err: any) {
    console.error(`[db] SQLite init failed: ${err.message}`);
    _db = null;
  }
}

export function dbGetTranslations(
  domain: string,
  lang: string,
  originals: string[]
): (string | null)[] {
  if (!_db || originals.length === 0) return originals.map(() => null);
  try {
    const stmt = _db.prepare(
      "SELECT translated FROM translations WHERE domain = ? AND lang = ? AND original = ?"
    );
    return originals.map((text) => {
      const row = stmt.get(domain, lang, text) as { translated: string } | null;
      return row?.translated ?? null;
    });
  } catch {
    return originals.map(() => null);
  }
}

export function dbSetTranslations(
  entries: { domain: string; lang: string; original: string; translated: string }[]
): void {
  if (!_db || entries.length === 0) return;
  try {
    const stmt = _db.prepare(
      "INSERT OR REPLACE INTO translations (domain, lang, original, translated) VALUES (?, ?, ?, ?)"
    );
    const tx = _db.transaction(() => {
      for (const e of entries) {
        stmt.run(e.domain, e.lang, e.original, e.translated);
      }
    });
    tx();
  } catch (err: any) {
    console.error(`[db] write translations failed: ${err.message}`);
  }
}

export function dbDeleteTranslationsByDomainLang(domain: string, lang: string): number {
  if (!_db) return 0;
  try {
    const result = _db.prepare("DELETE FROM translations WHERE domain = ? AND lang = ?").run(domain, lang);
    return result.changes;
  } catch {
    return 0;
  }
}

export function dbDeleteTranslationsByDomain(domain: string): number {
  if (!_db) return 0;
  try {
    const result = _db.prepare("DELETE FROM translations WHERE domain = ?").run(domain);
    return result.changes;
  } catch {
    return 0;
  }
}

export function isDBReady(): boolean {
  return _db !== null;
}
