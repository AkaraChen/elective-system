import type Database from "better-sqlite3";
import { defaultStartTime } from "../utils/time";

function tableExists(sqlite: Database.Database, table: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  return !!row;
}

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

export function migrate(sqlite: Database.Database): void {
  if (tableExists(sqlite, "courses") && !hasColumn(sqlite, "courses", "allowed_grade")) {
    sqlite.exec("ALTER TABLE courses ADD COLUMN allowed_grade TEXT");
  }
  if (tableExists(sqlite, "users") && !hasColumn(sqlite, "users", "year")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN year INTEGER");
  }
  if (tableExists(sqlite, "config")) {
    const insert = sqlite.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    );
    insert.run("start_time", defaultStartTime());
    insert.run("grade_order", "enrollment");
  }
}
