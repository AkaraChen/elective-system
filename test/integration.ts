const BASE = "http://localhost:8080";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  \u2714 ${name}`);
    passed++;
  } else {
    console.log(`  \u2716 ${name}${detail ? " - " + detail : ""}`);
    failed++;
  }
}

async function post(url: string, body: string, cookie?: string): Promise<{ status: number; text: string; cookie?: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(BASE + url, { method: "POST", headers, body, redirect: "manual" });
  const text = await res.text();
  return { status: res.status, text, cookie: res.headers.get("set-cookie") || undefined };
}

async function put(url: string, body: string, cookie: string): Promise<{ status: number; text: string }> {
  const res = await fetch(BASE + url, {
    method: "PUT",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookie },
    body,
    redirect: "manual",
  });
  return { status: res.status, text: await res.text() };
}

async function del(url: string, cookie: string): Promise<{ status: number; text: string }> {
  const res = await fetch(BASE + url, {
    method: "DELETE",
    headers: { "Cookie": cookie },
    redirect: "manual",
  });
  return { status: res.status, text: await res.text() };
}

async function login(username: string, password: string): Promise<string> {
  const { cookie } = await post("/api/login", `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`);
  if (!cookie) throw new Error(`Login failed for ${username}`);
  return cookie.split(";")[0];
}

async function dbGet(sql: string, params?: any[]): Promise<any> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database("./data/db.sqlite");
  const stmt = db.prepare(sql);
  const result = params ? stmt.get(...params) : stmt.get();
  db.close();
  return result;
}

async function dbAll(sql: string, params?: any[]): Promise<any[]> {
  const Database = (await import("better-sqlite3")).default;
  const db = new Database("./data/db.sqlite");
  const stmt = db.prepare(sql);
  const result = params ? stmt.all(...params) : stmt.all();
  db.close();
  return result;
}

async function main() {
  console.log("=== Integration Test ===\n");

  // 1. Admin login
  console.log("1. Admin login");
  const adminCookie = await login("admin", "admin123");
  check("admin login", adminCookie.includes("connect.sid"));

  // 2. Create course
  console.log("\n2. Create course");
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const toLocalISOShort = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const openTime = toLocalISOShort(new Date(now.getTime() - 60000));
  const endTimeStr = toLocalISOShort(new Date(now.getTime() + 600000));

  let resp = await post("/api/admin/courses",
    `name=IntegrationTest&teacher=Test&description=test&totalSeats=5&openTime=${encodeURIComponent(openTime)}`,
    adminCookie
  );
  check("create course", resp.status === 302, "status=" + resp.status);

  let courseRow = await dbGet("SELECT id, name, total_seats, available_seats FROM courses WHERE name='IntegrationTest'");
  check("course in DB", courseRow !== undefined);
  if (courseRow) {
    check("course totalSeats=5", courseRow.total_seats === 5);
    check("course availableSeats=5", courseRow.available_seats === 5);
  }
  const courseId = courseRow?.id;

  // 3. Set end_time
  console.log("\n3. Set end_time");
  resp = await put("/api/admin/config", `key=end_time&value=${encodeURIComponent(endTimeStr)}`, adminCookie);
  check("set end_time", resp.status === 302);

  // 4. Create students
  console.log("\n4. Create students");
  resp = await post("/api/admin/users", "username=int_student_a&password=pass123&isAdmin=0", adminCookie);
  check("create student_a", resp.status === 302);

  resp = await post("/api/admin/users", "username=int_student_b&password=pass123&isAdmin=0", adminCookie);
  check("create student_b", resp.status === 302);

  // 5. student_a login and select
  console.log("\n5. student_a select course");
  const cookieA = await login("int_student_a", "pass123");
  check("student_a login", cookieA.includes("connect.sid"));

  let selectResp = await post(`/api/courses/${courseId}/select`, "", cookieA);
  check("student_a select HTTP 200", selectResp.status === 200);
  check("student_a select shows 已选", selectResp.text.includes("已选"));

  let seatsAfter = await dbGet(`SELECT available_seats FROM courses WHERE id=?`, [courseId]);
  check("seats 5->4", seatsAfter.available_seats === 4, `got ${seatsAfter?.available_seats}`);

  // 6. Duplicate select
  console.log("\n6. Duplicate select rejected");
  selectResp = await post(`/api/courses/${courseId}/select`, "", cookieA);
  check("duplicate HTTP 400", selectResp.status === 400);
  check("duplicate error text", selectResp.text.includes("已选过"));

  // 7. student_b select same course
  console.log("\n7. student_b select");
  const cookieB = await login("int_student_b", "pass123");
  selectResp = await post(`/api/courses/${courseId}/select`, "", cookieB);
  check("student_b select HTTP 200", selectResp.status === 200);
  seatsAfter = await dbGet(`SELECT available_seats FROM courses WHERE id=?`, [courseId]);
  check("seats 4->3", seatsAfter.available_seats === 3, `got ${seatsAfter?.available_seats}`);

  // 8. student_a drop
  console.log("\n8. student_a drop");
  selectResp = await post(`/api/courses/${courseId}/drop`, "", cookieA);
  check("drop HTTP 200", selectResp.status === 200);
  check("drop shows 抢课", selectResp.text.includes("抢课"));
  seatsAfter = await dbGet(`SELECT available_seats FROM courses WHERE id=?`, [courseId]);
  check("seats 3->4", seatsAfter.available_seats === 4, `got ${seatsAfter?.available_seats}`);

  // 9. Seat consistency
  console.log("\n9. Seat consistency");
  const selCount = await dbGet(`SELECT count(*) as c FROM selections WHERE course_id=?`, [courseId]);
  const course = await dbGet(`SELECT total_seats, available_seats FROM courses WHERE id=?`, [courseId]);
  const expected = course.total_seats - selCount.c;
  check("seat consistency", course.available_seats === expected, `expected ${expected}, got ${course.available_seats}`);

  // 10. Delete student cascade
  console.log("\n10. Delete student cascade");
  const userRow = await dbGet("SELECT id FROM users WHERE username='int_student_a'");
  const userIdA = userRow?.id;
  resp = await del(`/api/admin/users/${userIdA}`, adminCookie);
  check("delete user HTTP 200", resp.status === 200);

  const userExists = await dbGet(`SELECT count(*) as c FROM users WHERE id=?`, [userIdA]);
  const selOrphan = await dbGet(`SELECT count(*) as c FROM selections WHERE user_id=?`, [userIdA]);
  const accessOrphan = await dbGet(`SELECT count(*) as c FROM access_users WHERE user_id=?`, [userIdA]);
  check("user deleted", userExists.c === 0);
  check("selections cleaned", selOrphan.c === 0);
  check("access_users cleaned", accessOrphan.c === 0);

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
  console.log("\nALL TESTS PASSED");
}

main().catch(e => { console.error(e); process.exit(1); });
