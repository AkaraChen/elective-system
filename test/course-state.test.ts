import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveOpenTime, resolveCourseState } from "../src/utils/course-state";

describe("selection window", () => {
  it("uses the global start when the student has no priority batch", () => {
    assert.equal(
      effectiveOpenTime(null, "2026-09-05T00:00:00"),
      "2026-09-05T00:00:00",
    );
  });

  it("lets a priority batch open earlier than the global start", () => {
    assert.equal(
      effectiveOpenTime("2026-09-01T00:00:00", "2026-09-05T00:00:00"),
      "2026-09-01T00:00:00",
    );
  });

  it("never opens later than the global start, even with a later batch", () => {
    assert.equal(
      effectiveOpenTime("2026-09-08T00:00:00", "2026-09-05T00:00:00"),
      "2026-09-05T00:00:00",
    );
  });

  it("stays waiting until the global start without a batch", () => {
    assert.equal(
      resolveCourseState({
        now: "2026-08-24T12:00:00",
        batchOpenTime: null,
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T23:59:59",
        selected: false,
        availableSeats: 10,
      }),
      "waiting",
    );
  });

  it("opens early for a batch student before the global start", () => {
    assert.equal(
      resolveCourseState({
        now: "2026-09-02T08:00:00",
        batchOpenTime: "2026-09-01T00:00:00",
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T23:59:59",
        selected: false,
        availableSeats: 10,
      }),
      "open",
    );
  });

  it("opens after the global start without a batch", () => {
    assert.equal(
      resolveCourseState({
        now: "2026-09-06T08:00:00",
        batchOpenTime: null,
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
        batchOpenTime: null,
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
        batchOpenTime: null,
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
        batchOpenTime: null,
        startTime: "2026-09-05T00:00:00",
        endTime: "2026-09-30T23:59:59",
        selected: true,
        availableSeats: 0,
      }),
      "selected",
    );
  });
});
