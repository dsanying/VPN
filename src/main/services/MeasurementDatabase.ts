import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

/** Private measurement database: no subscription URLs or node credentials are stored. */
export class MeasurementDatabase {
  private db?: DatabaseSync;
  private closed = false;
  constructor(private readonly file: string) {}
  private open(): DatabaseSync {
    if (this.closed) throw new Error('Measurement database is closed');
    if (!this.db) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.db = new DatabaseSync(this.file);
      fs.chmodSync(this.file, 0o600);
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS measurements (kind TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id))'
      );
    }
    return this.db;
  }
  close(): void {
    this.db?.close();
    this.db = undefined;
    this.closed = true;
  }
  read<T>(kind: string): Record<string, T> {
    const rows = this.open().prepare('SELECT id,payload FROM measurements WHERE kind=?').all(kind);
    return Object.fromEntries(
      rows.flatMap((row) => {
        try {
          return [[String(row.id), JSON.parse(String(row.payload)) as T]];
        } catch {
          return [];
        }
      })
    );
  }
  replace<T extends { fingerprint: string }>(kind: string, records: Record<string, T>): void {
    const db = this.open();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM measurements WHERE kind=?').run(kind);
      const insert = db.prepare(
        'INSERT INTO measurements(kind,id,fingerprint,payload) VALUES(?,?,?,?)'
      );
      for (const [id, record] of Object.entries(records))
        insert.run(kind, id, record.fingerprint, JSON.stringify(record));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
const databases = new Map<string, MeasurementDatabase>();
/** The owner releases a profile before deletion, replacement or terminal shutdown. */
export function closeMeasurementDatabases(file?: string): void {
  for (const [key, database] of databases) {
    if (file !== undefined && key !== file) continue;
    database.close();
    databases.delete(key);
  }
}
export function measurementDatabase(file: string): MeasurementDatabase {
  let db = databases.get(file);
  if (!db) {
    db = new MeasurementDatabase(file);
    databases.set(file, db);
  }
  return db;
}
