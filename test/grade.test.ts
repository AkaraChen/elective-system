import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAllowedGrades,
  isGradeAllowed,
  parseAllowedGrades,
  parseYear,
  serializeAllowedGrades,
  studentCohort,
} from "../src/utils/grade";

describe("student cohort", () => {
  it("uses the four-digit year directly without converting it to an ordinal grade", () => {
    assert.equal(studentCohort(2026), 2026);
    assert.equal(studentCohort(1000), 1000);
    assert.equal(studentCohort(null), null);
    assert.equal(studentCohort(26), null);
  });
});

describe("allowed grades", () => {
  it("parses, sorts, and deduplicates four-digit years", () => {
    assert.deepEqual(parseAllowedGrades("2026,2024"), [2024, 2026]);
    assert.deepEqual(parseAllowedGrades("2026、2024"), [2024, 2026]);
    assert.deepEqual(parseAllowedGrades(" 2026 2026 2024 "), [2024, 2026]);
    assert.equal(parseAllowedGrades(""), null);
    assert.equal(parseAllowedGrades("3,2026"), null);
    assert.equal(parseAllowedGrades("2026.5"), null);
    assert.equal(parseAllowedGrades("abcd"), null);
  });

  it("matches the student's four-digit cohort and formats every value with 级", () => {
    assert.equal(isGradeAllowed(2025, null), true);
    assert.equal(isGradeAllowed(2025, ""), true);
    assert.equal(isGradeAllowed(2025, "2024,2026"), false);
    assert.equal(isGradeAllowed(2026, "2024,2026"), true);
    assert.equal(isGradeAllowed(null, "2024,2026"), false);
    assert.equal(isGradeAllowed(2026, "3"), false);
    assert.equal(serializeAllowedGrades([2026, 2024]), "2024,2026");
    assert.equal(formatAllowedGrades("2024,2026"), "2024级、2026级");
  });

  it("accepts exactly four digits for a student year", () => {
    assert.equal(parseYear("2026"), 2026);
    assert.equal(parseYear(2026), 2026);
    assert.equal(parseYear(" 2026 "), 2026);
    assert.equal(parseYear(""), null);
    assert.equal(parseYear("026"), null);
    assert.equal(parseYear("2026.5"), null);
    assert.equal(parseYear("2026abc"), null);
  });
});
