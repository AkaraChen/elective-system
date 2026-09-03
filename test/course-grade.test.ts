import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { courses, selections, users } from "../src/db/schema";
import { removeIneligibleSelections } from "../src/services/course-grade";

function createFixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      grade INTEGER,
      class_name TEXT,
      phone TEXT
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
      allowed_grades TEXT,
      tag TEXT
    );
    CREATE TABLE selections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      course_id INTEGER NOT NULL REFERENCES courses(id),
      created_at TEXT NOT NULL,
      UNIQUE(user_id, course_id)
    );
  `);
  const db = drizzle(sqlite, { schema: { users, courses, selections } });

  db.insert(users).values([
    { username: "allowed", nickname: "Allowed", password: "x", grade: 2026 },
    { username: "removed", nickname: "Removed", password: "x", grade: 2025 },
    { username: "missing", nickname: "Missing", password: "x", grade: null },
  ]).run();
  db.insert(courses).values({
    name: "Test",
    teacher: "Teacher",
    totalSeats: 3,
    availableSeats: 0,
  }).run();
  db.insert(selections).values([
    { userId: 1, courseId: 1, createdAt: "2026-09-05T00:00:00" },
    { userId: 2, courseId: 1, createdAt: "2026-09-05T00:00:00" },
    { userId: 3, courseId: 1, createdAt: "2026-09-05T00:00:00" },
  ]).run();

  return { db, sqlite };
}

describe("course grade reconciliation", () => {
  it("removes every selected student outside the new grade restriction", () => {
    const { db, sqlite } = createFixture();
    try {
      const result = db.transaction((tx) => removeIneligibleSelections(tx, 1, "2026"));
      const remaining = db.select().from(selections).where(eq(selections.courseId, 1)).all();

      assert.deepEqual(result, { removedCount: 2, selectedCount: 1 });
      assert.deepEqual(remaining.map((selection) => selection.userId), [1]);
    } finally {
      sqlite.close();
    }
  });

  it("keeps graded students when unrestricted and removes accounts without a grade", () => {
    const { db, sqlite } = createFixture();
    try {
      const result = db.transaction((tx) => removeIneligibleSelections(tx, 1, null));
      const remaining = db.select().from(selections).where(eq(selections.courseId, 1)).all();

      assert.deepEqual(result, { removedCount: 1, selectedCount: 2 });
      assert.deepEqual(remaining.map((selection) => selection.userId), [1, 2]);
    } finally {
      sqlite.close();
    }
  });
});
