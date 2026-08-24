import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asEndInstant,
  asStartInstant,
  defaultStartTime,
  isValidLocalDateTime,
  laterInstant,
  parseLocalDateTime,
  toLocalISO,
} from "../src/utils/time";

describe("local time helpers", () => {
  it("default start time is Sept 5 of the local calendar year at 00:00:00", () => {
    assert.equal(defaultStartTime(new Date(2026, 7, 24, 21, 0, 0)), "2026-09-05T00:00:00");
    assert.equal(defaultStartTime(new Date(2025, 11, 31, 23, 59, 59)), "2025-09-05T00:00:00");
  });

  it("parses date-only values as local midnight, not UTC", () => {
    const d = parseLocalDateTime("2026-09-05");
    assert.ok(d);
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 8);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 0);
    assert.equal(d.getMinutes(), 0);
    assert.equal(d.getSeconds(), 0);
  });

  it("keeps date-only values at local midnight instead of Date.parse UTC", () => {
    const local = parseLocalDateTime("2026-09-05")!;
    assert.equal(toLocalISO(local), "2026-09-05T00:00:00");
    const utcParsed = new Date("2026-09-05");
    if (local.getTimezoneOffset() !== 0) {
      assert.notEqual(utcParsed.getTime(), local.getTime());
    }
  });

  it("normalizes start/end instants without a Z suffix", () => {
    assert.equal(asStartInstant("2026-09-05"), "2026-09-05T00:00:00");
    assert.equal(asEndInstant("2026-09-05"), "2026-09-05T23:59:59");
    assert.equal(laterInstant("2026-08-01T00:00:00", "2026-09-05"), "2026-09-05T00:00:00");
    assert.equal(isValidLocalDateTime("2026-09-05T08:30"), true);
    assert.equal(isValidLocalDateTime("not-a-date"), false);
    assert.equal(isValidLocalDateTime("2026-13-01"), false);
  });
});
