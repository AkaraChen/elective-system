import type Database from "better-sqlite3";
import { defaultEndTime, defaultStartTime } from "../utils/time";

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
  if (tableExists(sqlite, "users")) {
    if (!hasColumn(sqlite, "users", "nickname")) {
      sqlite.exec("ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
    }
    sqlite.exec("UPDATE users SET nickname = username WHERE nickname = ''");

    if (!hasColumn(sqlite, "users", "grade")) {
      if (hasColumn(sqlite, "users", "year")) {
        sqlite.exec("ALTER TABLE users RENAME COLUMN year TO grade");
      } else {
        sqlite.exec("ALTER TABLE users ADD COLUMN grade INTEGER");
      }
    }

    if (!hasColumn(sqlite, "users", "class_name")) {
      sqlite.exec("ALTER TABLE users ADD COLUMN class_name TEXT");
    }
    if (!hasColumn(sqlite, "users", "phone")) {
      sqlite.exec("ALTER TABLE users ADD COLUMN phone TEXT");
    }
  }

  if (tableExists(sqlite, "courses")) {
    if (!hasColumn(sqlite, "courses", "allowed_grades")) {
      if (hasColumn(sqlite, "courses", "allowed_grade")) {
        sqlite.exec("ALTER TABLE courses RENAME COLUMN allowed_grade TO allowed_grades");
      } else {
        sqlite.exec("ALTER TABLE courses ADD COLUMN allowed_grades TEXT");
      }
    }
    if (!hasColumn(sqlite, "courses", "tag")) {
      sqlite.exec("ALTER TABLE courses ADD COLUMN tag TEXT");
    }
    if (hasColumn(sqlite, "courses", "open_time")) {
      sqlite.exec("ALTER TABLE courses DROP COLUMN open_time");
    }
  }

  if (tableExists(sqlite, "config")) {
    const insert = sqlite.prepare(
      "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING",
    );
    insert.run("start_time", defaultStartTime());
    insert.run("end_time", defaultEndTime());
    sqlite.prepare("DELETE FROM config WHERE key = ?").run("grade_order");
  }
}
