import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { migrate } from "../src/db/migrate";

describe("KIT-910 sqlite migration", () => {
  it("migrates legacy year fields to grade fields and adds account/time defaults idempotently", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        year INTEGER
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
        open_time TEXT NOT NULL,
        allowed_grade TEXT
      );
      CREATE TABLE config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    sqlite.prepare("INSERT INTO users (username, password, year) VALUES (?, ?, ?)").run("student", "hash", 2026);
    sqlite.prepare("INSERT INTO courses (name, teacher, total_seats, available_seats, open_time, allowed_grade) VALUES (?, ?, ?, ?, ?, ?)")
      .run("Test", "Teacher", 1, 1, "2026-09-05T00:00:00", "2026");
    sqlite.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run("grade_order", "enrollment");

    migrate(sqlite);
    migrate(sqlite);

    const courseCols = sqlite.prepare("PRAGMA table_info(courses)").all() as { name: string }[];
    const userCols = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    const cfg = sqlite.prepare("SELECT key, value FROM config ORDER BY key").all() as {
      key: string;
      value: string;
    }[];

    assert.ok(courseCols.some((c) => c.name === "allowed_grades"));
    assert.ok(!courseCols.some((c) => c.name === "allowed_grade"));
    assert.ok(courseCols.some((c) => c.name === "tag"));
    assert.ok(!courseCols.some((c) => c.name === "open_time"));
    assert.ok(userCols.some((c) => c.name === "nickname"));
    assert.ok(userCols.some((c) => c.name === "grade"));
    assert.ok(userCols.some((c) => c.name === "class_name"));
    assert.ok(userCols.some((c) => c.name === "phone"));
    assert.ok(!userCols.some((c) => c.name === "year"));
    assert.deepEqual(
      sqlite.prepare("SELECT username, nickname, grade FROM users").get(),
      { username: "student", nickname: "student", grade: 2026 },
    );
    assert.equal(
      sqlite.prepare("SELECT allowed_grades FROM courses").pluck().get(),
      "2026",
    );
    assert.equal(cfg.find((r) => r.key === "grade_order"), undefined);
    assert.match(cfg.find((r) => r.key === "start_time")?.value || "", /^\d{4}-09-05T00:00:00$/);
    assert.match(cfg.find((r) => r.key === "end_time")?.value || "", /^\d{4}-09-30T23:59:59$/);
    sqlite.close();
  });
});
