import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { migrate } from "./migrate";

mkdirSync("data", { recursive: true });
const sqlite = new Database("data/db.sqlite");

try {
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
} finally {
  sqlite.close();
}
