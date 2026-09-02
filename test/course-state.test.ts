import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveOpenTime, resolveCourseState } from "../src/utils/course-state";

describe("selection window", () => {
  it("uses the later of global start and course open as effective open", () => {
    assert.equal(
      effectiveOpenTime("2026-08-01T00:00:00", "2026-09-05T00:00:00"),
      "2026-09-05T00:00:00",
    );
  });

  it("stays waiting until global start even if the course already opened", () => {
    assert.equal(
      resolveCourseState({
        now: "2026-08-24T12:00:00",
        openTime: "2026-08-01T00:00:00",
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T23:59:59",
        selected: false,
        availableSeats: 10,
      }),
      "waiting",
    );
  });

  it("opens after both global start and course open", () => {
    assert.equal(
      resolveCourseState({
        now: "2026-09-06T08:00:00",
        openTime: "2026-08-01T00:00:00",
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T23:59:59",
        selected: false,
        availableSeats: 10,
      }),
      "open",
    );
  });

  it("closes at the exact configured end second", () => {
    assert.equal(
      resolveCourseState({
        now: "2026-09-30T12:34:55",
        openTime: "2026-08-01T00:00:00",
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T12:34:56",
        selected: false,
        availableSeats: 10,
      }),
      "open",
    );
    assert.equal(
      resolveCourseState({
        now: "2026-09-30T12:34:56",
        openTime: "2026-08-01T00:00:00",
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T12:34:56",
        selected: false,
        availableSeats: 10,
      }),
      "closed",
    );
  });

  it("keeps selected state above window and seat checks", () => {
    assert.equal(
      resolveCourseState({
        now: "2026-10-01T00:00:00",
        openTime: "2026-08-01T00:00:00",
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T23:59:59",
        selected: true,
        availableSeats: 0,
      }),
      "selected",
    );
  });
});
