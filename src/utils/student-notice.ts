export type NoticeSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'，。！？；：、（）【】《》]+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：、）)\]\}]+$/;

export function linkifyStudentNotice(notice: string): NoticeSegment[] {
  const segments: NoticeSegment[] = [];
  let cursor = 0;

  for (const match of notice.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    const matched = match[0];
    const url = matched.replace(TRAILING_PUNCTUATION, "");
    const suffix = matched.slice(url.length);

    if (index > cursor) {
      segments.push({ type: "text", value: notice.slice(cursor, index) });
    }
    if (url) {
      segments.push({ type: "link", value: url });
    }
    if (suffix) {
      segments.push({ type: "text", value: suffix });
    }
    cursor = index + matched.length;
  }

  if (cursor < notice.length) {
    segments.push({ type: "text", value: notice.slice(cursor) });
  }

  return segments;
}
