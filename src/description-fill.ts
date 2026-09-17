import { emptySupplement } from "../shared/domain";
import type { AgendaEvent, Supplement } from "../shared/types";

const textFields = [
  "platform",
  "meetingUrl",
  "meetingId",
  "passcode",
  "agenda",
  "materials",
  "notes",
] as const;
const accessFields = new Set<keyof Supplement>([
  "mode",
  "platform",
  "meetingUrl",
  "meetingId",
  "passcode",
]);

/** Fill empty inputs only; saved/manual choices always remain the user's choices. */
export function fillFromDescription(event: AgendaEvent, current: Supplement) {
  const value = { ...current };
  const fields: (keyof Supplement)[] = [];
  if (!event.readable) return { value, fields, accessConflict: false };
  const suggested = emptySupplement({
    description: event.description,
    sourceLocation: event.sourceLocation,
  });
  const platformKey = (name: string) =>
    name
      .trim()
      .toLowerCase()
      .replace(/^microsoft\s+/, "")
      .replace(/\s+meeting$/, "");
  const accessConflict = Boolean(
    (current.meetingUrl.trim() &&
      suggested.meetingUrl &&
      current.meetingUrl !== suggested.meetingUrl) ||
    (current.platform.trim() &&
      suggested.platform &&
      platformKey(current.platform) !== platformKey(suggested.platform)),
  );
  for (const field of textFields) {
    if (
      (current.mode === "offline" || accessConflict) &&
      accessFields.has(field)
    )
      continue;
    if (!current[field].trim() && suggested[field].trim()) {
      value[field] = suggested[field];
      fields.push(field);
    }
  }
  // A saved venue can mean hybrid participation; do not infer online-only here.
  if (
    !current.mode &&
    suggested.mode &&
    !current.location.trim() &&
    !accessConflict
  ) {
    value.mode = suggested.mode;
    fields.push("mode");
  }
  if (fields.length) value.sourceReviewed = false;
  if (fields.some((field) => accessFields.has(field)))
    value.accessVerified = false;
  return { value, fields, accessConflict };
}
