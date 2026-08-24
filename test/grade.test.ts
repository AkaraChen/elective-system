import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  academicYear,
  isGradeAllowed,
  parseAllowedGrades,
  parseYear,
  serializeAllowedGrades,
  studentGrade,
} from "../src/utils/grade";

describe("academic year (local September boundary)", () => {
  it("stays on the previous year before September", () => {
    assert.equal(academicYear(new Date(2026, 7, 24)), 2025);
  });

  it("advances on September 1 local time", () => {
    assert.equal(academicYear(new Date(2026, 8, 1, 0, 0, 0)), 2026);
  });
});

describe("studentGrade", () => {
  it("computes grade from enrollment year", () => {
    assert.equal(studentGrade(2024, "enrollment", new Date(2026, 8, 5)), 3);
    assert.equal(studentGrade(2024, "enrollment", new Date(2026, 7, 24)), 2);
  });

  it("computes grade from graduation year with 3-year program", () => {
    assert.equal(studentGrade(2027, "graduation", new Date(2026, 8, 5)), 3);
    assert.equal(studentGrade(2027, "graduation", new Date(2025, 8, 5)), 2);
    assert.equal(studentGrade(2027, "graduation", new Date(2024, 8, 5)), 1);
  });

  it("returns null for missing or out-of-range years", () => {
    assert.equal(studentGrade(null, "enrollment", new Date(2026, 8, 5)), null);
    assert.equal(studentGrade(1980, "enrollment", new Date(2026, 8, 5)), null);
  });
});

describe("allowed grades", () => {
  it("parses multiple grade numbers including Chinese separators", () => {
    assert.deepEqual(parseAllowedGrades("1,3"), [1, 3]);
    assert.deepEqual(parseAllowedGrades("1、3"), [1, 3]);
    assert.deepEqual(parseAllowedGrades(" 2 2 1 "), [1, 2]);
    assert.equal(parseAllowedGrades(""), null);
    assert.equal(parseAllowedGrades("a,1"), null);
  });

  it("treats empty allowed_grade as unrestricted", () => {
    assert.equal(isGradeAllowed(2, null), true);
    assert.equal(isGradeAllowed(2, ""), true);
    assert.equal(isGradeAllowed(2, "1,3"), false);
    assert.equal(isGradeAllowed(1, "1,3"), true);
    assert.equal(isGradeAllowed(null, "1,3"), false);
    assert.equal(serializeAllowedGrades([3, 1]), "1,3");
  });

  it("parses student year bounds", () => {
    assert.equal(parseYear("2024"), 2024);
    assert.equal(parseYear(""), null);
    assert.equal(parseYear("1899"), null);
  });
});
