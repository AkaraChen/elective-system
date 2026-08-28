import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  asEndInstant,
  asStartInstant,
  defaultEndTime,
  defaultStartTime,
  isValidLocalDateTime,
  laterInstant,
  nowLocal,
  parseLocalDateTime,
  toLocalISO,
} from "../src/utils/time";

describe("local time helpers", () => {
  it("uses the Chinese calendar year for default dates", () => {
    assert.equal(defaultStartTime(new Date("2026-12-31T15:59:59Z")), "2026-09-05T00:00:00");
    assert.equal(defaultStartTime(new Date("2026-12-31T16:00:00Z")), "2027-09-05T00:00:00");
  });

  it("default end time is Sept 30 of the Chinese calendar year at 23:59:59", () => {
    assert.equal(defaultEndTime(new Date("2030-12-31T16:00:00Z")), "2031-09-30T23:59:59");
  });

  it("parses date-only values as midnight in China", () => {
    const d = parseLocalDateTime("2026-09-05");
    assert.ok(d);
    assert.equal(d.toISOString(), "2026-09-04T16:00:00.000Z");
  });

  it("formats dates in China regardless of the process timezone", () => {
    const local = parseLocalDateTime("2026-09-05")!;
    assert.equal(toLocalISO(local), "2026-09-05T00:00:00");
  });

  it("crosses the day boundary at Chinese midnight", () => {
    assert.equal(nowLocal(new Date("2026-08-28T15:59:59Z")), "2026-08-28T23:59:59");
    assert.equal(nowLocal(new Date("2026-08-28T16:00:00Z")), "2026-08-29T00:00:00");
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
