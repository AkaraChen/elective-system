import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatAllowedGrades,
  isGradeAllowed,
  parseAllowedGrades,
  parseGrade,
  serializeAllowedGrades,
  studentGrade,
} from "../src/utils/grade";

describe("student grade", () => {
  it("uses the four-digit grade identifier directly", () => {
    assert.equal(studentGrade(2026), 2026);
    assert.equal(studentGrade(1000), 1000);
    assert.equal(studentGrade(null), null);
    assert.equal(studentGrade(26), null);
  });
});

describe("allowed grades", () => {
  it("parses, sorts, and deduplicates four-digit grade identifiers", () => {
    assert.deepEqual(parseAllowedGrades("2026,2024"), [2024, 2026]);
    assert.deepEqual(parseAllowedGrades("2026、2024"), [2024, 2026]);
    assert.deepEqual(parseAllowedGrades(" 2026 2026 2024 "), [2024, 2026]);
    assert.equal(parseAllowedGrades(""), null);
    assert.equal(parseAllowedGrades("3,2026"), null);
    assert.equal(parseAllowedGrades("2026.5"), null);
    assert.equal(parseAllowedGrades("abcd"), null);
  });

  it("matches the student's grade and formats every value with 级", () => {
    assert.equal(isGradeAllowed(2025, null), true);
    assert.equal(isGradeAllowed(2025, ""), true);
    assert.equal(isGradeAllowed(null, null), false);
    assert.equal(isGradeAllowed(2025, "2024,2026"), false);
    assert.equal(isGradeAllowed(2026, "2024,2026"), true);
    assert.equal(isGradeAllowed(null, "2024,2026"), false);
    assert.equal(isGradeAllowed(2026, "3"), false);
    assert.equal(serializeAllowedGrades([2026, 2024]), "2024,2026");
    assert.equal(formatAllowedGrades("2024,2026"), "2024级、2026级");
  });

  it("accepts exactly four digits for a student grade", () => {
    assert.equal(parseGrade("2026"), 2026);
    assert.equal(parseGrade(2026), 2026);
    assert.equal(parseGrade(" 2026 "), 2026);
    assert.equal(parseGrade(""), null);
    assert.equal(parseGrade("026"), null);
    assert.equal(parseGrade("2026.5"), null);
    assert.equal(parseGrade("2026abc"), null);
  });
});
