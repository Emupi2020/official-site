import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(new URL('../migrations/0001_requests.sql',import.meta.url),'utf8'));
  return { native: db, prepare(sql) { let args=[]; const stmt=db.prepare(sql); return { bind(...values){args=values;return this;}, async first(){return stmt.get(...args)||null;}, async run(){return stmt.run(...args);}, async all(){return { results: stmt.all(...args) };} }; } };
}
