// SQLite persistent storage (bun:sqlite)

import { Database } from "bun:sqlite";

let db: Database | null = null;

export function initDB(): void {
  const dbPath = process.env.DB_PATH || "./tongues.db";
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
}

export function dbGetTranslations(
  domain: string,
  lang: string,
  originals: string[]
): (string | null)[] {
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
}

export function dbSetTranslations(
  entries: { domain: string; lang: string; original: string; translated: string }[]
): void {
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
}

export function dbDeleteTranslationsByDomainLang(domain: string, lang: string): number {
  if (!db) return 0;
  try {
    const result = db.prepare("DELETE FROM translations WHERE domain = ? AND lang = ?").run(domain, lang);
    return result.changes;
  } catch {
    return 0;
  }
}

export function dbDeleteTranslationsByDomain(domain: string): number {
  if (!db) return 0;
  try {
    const result = db.prepare("DELETE FROM translations WHERE domain = ?").run(domain);
    return result.changes;
  } catch {
    return 0;
  }
}

export function isDBReady(): boolean {
  return db !== null;
}
