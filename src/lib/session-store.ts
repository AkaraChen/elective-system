import session from "express-session";
import type Database from "better-sqlite3";

export class BetterSqlite3Store extends session.Store {
  private db: Database.Database;
  private table: string;

  constructor(options: { db: Database.Database; table?: string }) {
    super();
    this.db = options.db;
    this.table = options.table || "sessions";
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS ${this.table} (sid TEXT PRIMARY KEY, expired INTEGER, sess TEXT)`
    );
    setInterval(() => {
      this.db.prepare(`DELETE FROM ${this.table} WHERE ? > expired`).run(Date.now());
    }, 86400000).unref();
  }

  get(sid: string, callback: (err: any, session?: any) => void) {
    try {
      const row = this.db.prepare(`SELECT sess FROM ${this.table} WHERE sid = ?`).get(sid) as any;
      if (!row) return callback(null, null);
      callback(null, JSON.parse(row.sess));
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sess: any, callback?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge;
      const now = Date.now();
      const expired = maxAge ? now + maxAge : now + 86400000;
      this.db.prepare(`INSERT OR REPLACE INTO ${this.table} VALUES (?, ?, ?)`).run(sid, expired, JSON.stringify(sess));
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: any) => void) {
    try {
      this.db.prepare(`DELETE FROM ${this.table} WHERE sid = ?`).run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sess: any, callback?: (err?: any) => void) {
    try {
      const maxAge = sess.cookie?.maxAge;
      const now = Date.now();
      const expired = maxAge ? now + maxAge : now + 86400000;
      this.db.prepare(`UPDATE ${this.table} SET expired = ? WHERE sid = ?`).run(expired, sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }
}
