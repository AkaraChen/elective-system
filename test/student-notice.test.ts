import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linkifyStudentNotice } from "../src/utils/student-notice";

describe("student notice links", () => {
  it("turns HTTP URLs into links without swallowing surrounding punctuation", () => {
    assert.deepEqual(
      linkifyStudentNotice("查看 https://example.com/help。备用 http://example.org/a?q=1，结束"),
      [
        { type: "text", value: "查看 " },
        { type: "link", value: "https://example.com/help" },
        { type: "text", value: "。备用 " },
        { type: "link", value: "http://example.org/a?q=1" },
        { type: "text", value: "，结束" },
      ],
    );
  });
});
