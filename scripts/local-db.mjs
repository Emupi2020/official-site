import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  return { native: db, prepare(sql) { let args=[]; const stmt=db.prepare(sql); return { bind(...values){args=values;return this;}, async first(){return stmt.get(...args)||null;}, async run(){return stmt.run(...args);}, async all(){return { results: stmt.all(...args) };} }; } };
}
