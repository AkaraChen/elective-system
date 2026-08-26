import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import bcryptjs from "bcryptjs";
import Database from "better-sqlite3";

const originalDirectory = process.cwd();
const fixtureDirectory = mkdtempSync(join(tmpdir(), "elective-routes-"));
let baseUrl = "";
let server: Server | undefined;
let sessionDb: Database.Database | undefined;
let rawDb: Database.Database | undefined;

before(async () => {
  process.chdir(fixtureDirectory);
  mkdirSync("data");
  createSchema();

  const [{ createApp }, database] = await Promise.all([
    import("../src/app"),
    import("../src/db/index"),
  ]);
  rawDb = database.rawDb;
  seedFixture(rawDb);

  const app = createApp();
  sessionDb = app.locals.sessionDb;
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
  }
  sessionDb?.close();
  rawDb?.close();
  process.chdir(originalDirectory);
  rmSync(fixtureDirectory, { recursive: true, force: true });
});

describe("grade and selection routes", () => {
  it("returns only courses allowed for the logged-in student's grade", async () => {
    const student = await login("student", "123");
    const response = await fetch(`${baseUrl}/courses`, { headers: { cookie: student.cookie } });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Allowed course/);
    assert.doesNotMatch(html, /Restricted course/);
    assert.match(html, /Student Nickname/);
  });

  it("uses the earliest matching priority batch", async () => {
    const student = await login("student", "123");
    const response = await fetch(`${baseUrl}/courses`, { headers: { cookie: student.cookie } });
    const html = await response.text();

    assert.match(html, /data-opentime="2090-01-01T00:00:00"/);
    assert.doesNotMatch(html, /data-opentime="2099-01-01T00:00:00"/);
  });

  it("rejects an administrator assigning an ineligible student", async () => {
    const admin = await login("admin", "123");
    const response = await fetch(`${baseUrl}/api/admin/class/courses/2/students`, {
      method: "PUT",
      headers: {
        cookie: admin.cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: admin.csrf, user_ids: "2" }),
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /不允许年级/);
    assert.equal(rawDb!.prepare("SELECT count(*) FROM selections WHERE user_id = 2 AND course_id = 2").pluck().get(), 0);
  });

  it("rejects a global deadline before the configured start", async () => {
    const admin = await login("admin", "123");
    const response = await fetch(`${baseUrl}/api/admin/config`, {
      method: "PUT",
      headers: {
        cookie: admin.cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ _csrf: admin.csrf, key: "end_time", value: "1999-12-31" }),
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /截止时间必须晚于开始时间/);
  });

  it("removes selections that become ineligible after a student grade change", async () => {
    rawDb!.prepare("INSERT INTO selections (user_id, course_id, created_at) VALUES (?, ?, ?)")
      .run(2, 1, "2026-08-27T00:00:00");
    rawDb!.prepare("UPDATE courses SET available_seats = 9 WHERE id = 1").run();

    const admin = await login("admin", "123");
    const response = await fetch(`${baseUrl}/api/admin/users/2`, {
      method: "PUT",
      redirect: "manual",
      headers: {
        cookie: admin.cookie,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        _csrf: admin.csrf,
        username: "student",
        nickname: "Student Nickname",
        password: "",
        isAdmin: "0",
        grade: "2025",
      }),
    });

    assert.equal(response.status, 302);
    assert.equal(rawDb!.prepare("SELECT grade FROM users WHERE id = 2").pluck().get(), 2025);
    assert.equal(rawDb!.prepare("SELECT count(*) FROM selections WHERE user_id = 2").pluck().get(), 0);
    assert.equal(rawDb!.prepare("SELECT available_seats FROM courses WHERE id = 1").pluck().get(), 10);
  });

  it("creates accounts with duplicate nicknames but unique usernames and required grades", async () => {
    const admin = await login("admin", "123");
    for (const username of ["student-a", "student-b"]) {
      const response = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        redirect: "manual",
        headers: {
          cookie: admin.cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          _csrf: admin.csrf,
          username,
          nickname: "同名学生",
          password: "123",
          isAdmin: "0",
          grade: "2026",
        }),
      });
      assert.equal(response.status, 302);
    }

    assert.deepEqual(
      rawDb!.prepare("SELECT username, nickname, grade FROM users WHERE username LIKE 'student-%' ORDER BY username").all(),
      [
        { username: "student-a", nickname: "同名学生", grade: 2026 },
        { username: "student-b", nickname: "同名学生", grade: 2026 },
      ],
    );
  });
});

async function login(username: string, password: string): Promise<{ cookie: string; csrf: string }> {
  const page = await fetch(`${baseUrl}/login`);
  const initialCookie = cookieValue(page.headers.get("set-cookie"));
  const csrf = extractCsrf(await page.text());
  const response = await fetch(`${baseUrl}/api/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie: initialCookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ _csrf: csrf, username, password }),
  });
  assert.equal(response.status, 302);
  const authenticatedCookie = cookieValue(response.headers.get("set-cookie")) || initialCookie;
  const authenticatedPage = await fetch(`${baseUrl}/`, {
    headers: { cookie: authenticatedCookie },
  });
  return {
    cookie: authenticatedCookie,
    csrf: extractCsrf(await authenticatedPage.text()),
  };
}

function cookieValue(header: string | null): string {
  return header?.split(";", 1)[0] || "";
}

function extractCsrf(html: string): string {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(match);
  return match[1];
}

function createSchema() {
  const sqlite = new Database("data/db.sqlite");
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      grade INTEGER
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
      allowed_grades TEXT
    );
    CREATE TABLE access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      open_time TEXT NOT NULL
    );
    CREATE TABLE access_users (
      access_id INTEGER NOT NULL REFERENCES access(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      PRIMARY KEY (access_id, user_id)
    );
    CREATE TABLE selections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      course_id INTEGER NOT NULL REFERENCES courses(id),
      created_at TEXT NOT NULL,
      UNIQUE (user_id, course_id)
    );
    CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  sqlite.close();
}

function seedFixture(sqlite: Database.Database) {
  const password = bcryptjs.hashSync("123", 4);
  sqlite.prepare("INSERT INTO users (username, nickname, password, is_admin, grade) VALUES (?, ?, ?, ?, ?)")
    .run("admin", "Admin Nickname", password, 1, null);
  sqlite.prepare("INSERT INTO users (username, nickname, password, is_admin, grade) VALUES (?, ?, ?, ?, ?)")
    .run("student", "Student Nickname", password, 0, 2026);
  sqlite.prepare("INSERT INTO courses (name, teacher, total_seats, available_seats, open_time, allowed_grades) VALUES (?, ?, ?, ?, ?, ?)")
    .run("Allowed course", "Teacher", 10, 10, "2999-01-01T00:00:00", "2026");
  sqlite.prepare("INSERT INTO courses (name, teacher, total_seats, available_seats, open_time, allowed_grades) VALUES (?, ?, ?, ?, ?, ?)")
    .run("Restricted course", "Teacher", 10, 10, "2000-01-01T00:00:00", "2025");
  const later = sqlite.prepare("INSERT INTO access (course_id, open_time) VALUES (?, ?)").run(1, "2099-01-01T00:00:00").lastInsertRowid;
  const earlier = sqlite.prepare("INSERT INTO access (course_id, open_time) VALUES (?, ?)").run(1, "2090-01-01T00:00:00").lastInsertRowid;
  sqlite.prepare("INSERT INTO access_users (access_id, user_id) VALUES (?, ?)").run(later, 2);
  sqlite.prepare("INSERT INTO access_users (access_id, user_id) VALUES (?, ?)").run(earlier, 2);
  const setConfig = sqlite.prepare("INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  setConfig.run("start_time", "2000-01-01T00:00:00");
  setConfig.run("end_time", "2999-12-31T23:59:59");
  setConfig.run("max_selections", "3");
}
