import Database from "better-sqlite3";
import bcryptjs from "bcryptjs";

const BASE = "http://localhost:8080";

async function post(url: string, body: string, cookie?: string): Promise<{ status: number; text: string; cookie?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(url, { method: "POST", headers, body, redirect: "manual" });
  const text = await res.text();
  const setCookie = res.headers.get("set-cookie");
  return { status: res.status, text, cookie: setCookie || undefined };
}

async function login(username: string, password: string): Promise<string> {
  const { cookie } = await post(`${BASE}/api/login`, `username=${username}&password=${password}`);
  if (!cookie) throw new Error(`Login failed for ${username}`);
  return cookie.split(";")[0];
}

async function main() {
  console.log("=== Concurrent selection test ===");

  // Create 3 test students directly in DB
  const db = new Database("./data/db.sqlite");
  const hash = bcryptjs.hashSync("test123", 10);
  const names = ["concurrent_a", "concurrent_b", "concurrent_c"];
  for (const name of names) {
    db.prepare("INSERT OR IGNORE INTO users (username, password, is_admin) VALUES (?, ?, 0)").run(name, hash);
  }

  // Reset course 1 seats to 3 and clear any prior selections
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocalISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const pastTime = toLocalISO(new Date(now.getTime() - 60000));
  db.prepare("UPDATE courses SET available_seats = 3, open_time = ? WHERE id = 1").run(pastTime);
  db.prepare("DELETE FROM selections WHERE course_id = 1").run();
  db.close();

  // Login all 3 students
  const students: { name: string; cookie: string }[] = [];
  for (const name of names) {
    const cookie = await login(name, "test123");
    students.push({ name, cookie });
    console.log(`  Logged in: ${name}`);
  }

  const cookies = students.map(s => s.cookie);

  console.log("  Firing 10 concurrent requests for 3 seats...");

  // Fire 10 concurrent requests, cycling through cookies
  const promises: Promise<{ status: number; text: string; idx: number }>[] = [];
  for (let i = 0; i < 10; i++) {
    const cookie = cookies[i % cookies.length];
    promises.push(
      post(`${BASE}/api/courses/1/select`, "", cookie).then(r => ({ ...r, idx: i }))
    );
  }

  const results = await Promise.all(promises);

  const successes = results.filter(r => r.status === 200);
  const failures = results.filter(r => r.status === 400);

  console.log(`  Success (200): ${successes.length}`);
  console.log(`  Failure (400): ${failures.length}`);

  // Verify DB state
  const db2 = new Database("./data/db.sqlite");
  const selections = db2.prepare("SELECT user_id FROM selections WHERE course_id = 1").all();
  const course = db2.prepare("SELECT available_seats FROM courses WHERE id = 1").get() as any;
  db2.close();

  console.log(`  Selections in DB: ${selections.length}`);
  console.log(`  Remaining seats: ${course.available_seats}`);

  if (selections.length === 3 && course.available_seats === 0) {
    console.log("\n✓ Concurrent safety test PASSED (no oversell)");
  } else {
    console.log(`\n✗ Concurrent safety test FAILED (expected 3 selections/0 seats)`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
