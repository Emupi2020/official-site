import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function database(path = ':memory:') {
  const db = new DatabaseSync(path);
  const migrations = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(new URL(file, migrations), 'utf8'));
  }
  return {
    native: db,
    prepare(sql) {
      let args = [];
      const statement = db.prepare(sql);
      return {
        bind(...values) { args = values; return this; },
        first() { return statement.get(...args) || null; },
        run() { return statement.run(...args); },
        all() { return { results: statement.all(...args) }; },
        batchResult() {
          return statement.columns().length ? this.all() : {meta:this.run()};
        }
      };
    },
    batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.batchResult());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
}
