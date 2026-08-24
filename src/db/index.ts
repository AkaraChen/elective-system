import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import * as schema from "./schema";
import { migrate } from "./migrate";

mkdirSync("data", { recursive: true });
const sqlite = new Database("data/db.sqlite");
sqlite.pragma("journal_mode = WAL");
migrate(sqlite);

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;
