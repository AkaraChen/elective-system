-- KIT-910: global start_time, grade_order, course allowed_grade, user year.
-- Applied idempotently at process start by src/db/migrate.ts (SQLite has no IF NOT EXISTS for ADD COLUMN).

ALTER TABLE courses ADD COLUMN allowed_grade TEXT;
ALTER TABLE users ADD COLUMN year INTEGER;

INSERT OR IGNORE INTO config (key, value) VALUES ('start_time', '2026-09-05T00:00:00');
INSERT OR IGNORE INTO config (key, value) VALUES ('grade_order', 'enrollment');
