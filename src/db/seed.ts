import bcryptjs from "bcryptjs";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "./schema";
import { users, courses, access, accessUsers, config } from "./schema";

export function seed(d: ReturnType<typeof drizzle>) {
  const existingUser = d.select({ id: users.id }).from(users).limit(1).get();
  if (existingUser) {
    console.log("Seed skipped: existing data preserved");
    return;
  }

  d.delete(accessUsers).run();
  d.delete(access).run();
  d.delete(schema.selections).run();
  d.delete(courses).run();
  d.delete(users).run();
  d.delete(config).run();
  d.run(sql.raw("DELETE FROM sqlite_sequence"));

  const adminHash = bcryptjs.hashSync("admin123", 10);
  const studentHash = bcryptjs.hashSync("123456", 10);

  d.insert(users).values([
    { username: "admin", password: adminHash, isAdmin: 1 },
    { username: "student1", password: studentHash, isAdmin: 0 },
    { username: "student2", password: studentHash, isAdmin: 0 },
  ]).run();

  d.insert(courses).values([
    {
      name: "Python入门",
      teacher: "张老师",
      description: "零基础Python教学",
      courseTime: "周二第3-5节",
      location: "教学楼A-301",
      totalSeats: 60,
      availableSeats: 60,
      openTime: "2026-08-01T00:00:00",
    },
    {
      name: "Go语言",
      teacher: "李老师",
      description: "Go并发编程实践",
      courseTime: "周三第6-8节",
      location: "教学楼B-205",
      totalSeats: 40,
      availableSeats: 40,
      openTime: "2026-08-30T00:00:00",
    },
  ]).run();

  d.insert(access).values({
    courseId: 1,
    openTime: "2026-08-09T00:00:00",
  }).run();

  d.insert(accessUsers).values([
    { accessId: 1, userId: 2 },
    { accessId: 1, userId: 3 },
  ]).run();

  d.insert(config).values([
    { key: "end_time", value: "2026-08-15T23:59:59" },
    { key: "site_title", value: "选课系统" },
    { key: "max_selections", value: "0" },
  ]).run();

  console.log("Seed done");
}

mkdirSync("data", { recursive: true });
const sqlite = new Database("data/db.sqlite");
sqlite.pragma("journal_mode = WAL");
const d = drizzle(sqlite, { schema });
seed(d);
sqlite.close();
