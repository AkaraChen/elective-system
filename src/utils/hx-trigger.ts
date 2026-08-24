/** JSON for HTTP headers. Node rejects non-ASCII header values (ERR_INVALID_CHAR). */
export function asciiHeaderJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => {
    return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
  });
}
