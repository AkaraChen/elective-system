import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateHeaderValue } from "node:http";
import { asciiHeaderJson } from "../src/utils/hx-trigger";

describe("HX-Trigger header encoding", () => {
  const payload = {
    toast: { message: "以下ID不存在，已忽略：99999", type: "warning" },
  };

  it("rejects a raw Chinese JSON header the way Node does", () => {
    assert.throws(
      () => validateHeaderValue("HX-Trigger", JSON.stringify(payload)),
      (err: NodeJS.ErrnoException) => err.code === "ERR_INVALID_CHAR",
    );
  });

  it("keeps HX-Trigger ASCII so Node accepts it and JSON round-trips the toast", () => {
    const header = asciiHeaderJson(payload);
    assert.match(header, /^[\x00-\x7F]*$/);
    validateHeaderValue("HX-Trigger", header);
    assert.equal(JSON.parse(header).toast.message, payload.toast.message);
    assert.equal(JSON.parse(header).toast.type, "warning");
  });
});
