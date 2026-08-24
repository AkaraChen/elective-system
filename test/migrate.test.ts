import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { migrate } from "../src/db/migrate";

describe("KIT-910 sqlite migration", () => {
  it("adds allowed_grade, year, and default config idempotently", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE courses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        teacher TEXT NOT NULL,
        description TEXT,
        course_time TEXT,
        location TEXT,
        total_seats INTEGER NOT NULL,
        available_seats INTEGER NOT NULL,
        open_time TEXT NOT NULL
      );
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    migrate(sqlite);
    migrate(sqlite);

    const courseCols = sqlite.prepare("PRAGMA table_info(courses)").all() as { name: string }[];
    const userCols = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    const cfg = sqlite.prepare("SELECT key, value FROM config ORDER BY key").all() as {
      key: string;
      value: string;
    }[];

    assert.ok(courseCols.some((c) => c.name === "allowed_grade"));
    assert.ok(userCols.some((c) => c.name === "year"));
    assert.equal(cfg.find((r) => r.key === "grade_order")?.value, "enrollment");
    assert.match(cfg.find((r) => r.key === "start_time")?.value || "", /^\d{4}-09-05T00:00:00$/);
    sqlite.close();
  });
});
