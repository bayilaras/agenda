import { DateTime, IANAZone } from "luxon";
import {
  formatDate,
  formatEventTime,
  MAX_MESSAGE_LENGTH,
  MAX_SELECTED_EVENTS,
  plainSourceText,
  zoneLabel,
} from "./domain";
import type { AgendaEvent, Issue, Leader, Validation } from "./types";

const hasText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const dateValid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  DateTime.fromISO(value, { zone: "UTC" }).isValid;

// Decode HTML entities once without interpreting literal angle brackets in a
// password or other calendar text as markup.
function decodeEntities(value: string): string {
  return plainSourceText(value.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
}

function safeSourceUrl(value: string): boolean {
  if (value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value))
    return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** Plain text only: retain paragraphs and visible link targets, never fetch HTML. */
export function calendarDescriptionText(value: unknown): string {
  if (typeof value !== "string") return "";
  const source = value
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*$/gi, "");
  const withLinks = source.replace(
    /<a\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)<\/a\s*>/gi,
    (_whole, attributes: string, body: string) => {
      const match =
        /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(
          attributes,
        );
      const rawTarget = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
      const target = decodeEntities(rawTarget);
      if (!safeSourceUrl(target)) return body;
      if (calendarDescriptionText(body).trim() === target) return body;
      // The final pass decodes both the label and href once, preserving &amp;
      // and percent-encoded credential data exactly as rendered by Calendar.
      return `${body} (${rawTarget})`;
    },
  );
  return decodeEntities(
    withLinks
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/li\s*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(
        /<\/(p|div|h[1-6]|tr|section|article|blockquote|ul|ol)\s*>/gi,
        "\n\n",
      )
      .replace(/<\/(td|th)\s*>/gi, "\t")
      .replace(
        /<\/?(?:a|abbr|address|area|article|aside|b|bdi|bdo|blockquote|body|br|caption|center|cite|code|col|colgroup|dd|del|details|dfn|div|dl|dt|em|figcaption|figure|font|footer|h[1-6]|header|hr|html|i|img|input|ins|kbd|label|li|main|mark|nav|ol|p|pre|q|s|samp|section|small|span|strike|strong|sub|summary|sup|table|tbody|td|tfoot|th|thead|time|tr|u|ul|var|wbr)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi,
        "",
      ),
  )
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

export function isCalendarSelectable(event: AgendaEvent): boolean {
  return event.readable === true && event.status !== "cancelled";
}

function sourceOrder(a: AgendaEvent, b: AgendaEvent): number {
  const compare = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const delta =
    DateTime.fromISO(a.start, { zone: "UTC" }).toMillis() -
    DateTime.fromISO(b.start, { zone: "UTC" }).toMillis();
  return (
    (Number.isFinite(delta) ? delta : compare(a.start, b.start)) ||
    compare(a.sourceTitle, b.sourceTitle) ||
    compare(a.id, b.id)
  );
}

function sourceTime(event: AgendaEvent, timeZone: string): string {
  if (!event.allDay && event.endTimeUnspecified) {
    const start = DateTime.fromISO(event.start, { zone: timeZone }).setZone(
      timeZone,
    );
    return start.isValid
      ? `Pukul ${start.toFormat("HH.mm")} ${zoneLabel(timeZone)} (jam selesai belum ditentukan di kalender)`
      : "";
  }
  return formatEventTime(
    {
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      supplement: { timeFormat: event.allDay ? "all-day" : "range" },
    } as AgendaEvent,
    timeZone,
  );
}

export function generateCalendarMessage(
  events: AgendaEvent[],
  leader: Leader,
  date: string,
): string {
  const selected = events.filter(isCalendarSelectable).sort(sourceOrder);
  const blocks = selected.map((event, index) => {
    const title = calendarDescriptionText(event.sourceTitle).trim();
    const parts = [selected.length > 1 ? `${index + 1}. ${title}` : title];
    const time = sourceTime(event, leader.timeZone);
    if (time) parts.push(`Waktu: ${time}`);
    const location = calendarDescriptionText(event.sourceLocation);
    if (hasText(location)) parts.push(`Tempat: ${location}`);
    const description = calendarDescriptionText(event.description);
    if (hasText(description))
      parts.push(`Keterangan kalender:\n${description}`);

    const present = `${description}\n${location}`;
    const rendered = new Set<string>();
    const access: string[] = [];
    const labels = {
      meetingUrl: "Tautan Rapat",
      meetingId: "ID Rapat",
      passcode: "Kode Sandi",
    };
    for (const candidate of event.sourceCandidates ?? []) {
      if (!hasText(candidate.value) || !Object.hasOwn(labels, candidate.field))
        continue;
      if (candidate.field === "meetingUrl" && !safeSourceUrl(candidate.value))
        continue;
      const key = `${candidate.field}:${candidate.value}`;
      if (rendered.has(key) || present.includes(candidate.value)) continue;
      rendered.add(key);
      access.push(`${labels[candidate.field]}: ${candidate.value}`);
    }
    if (access.length)
      parts.push(`Akses rapat dari Google Calendar:\n${access.join("\n")}`);

    const attachments: string[] = [];
    const seenUrls = new Set<string>();
    for (const attachment of event.sourceAttachments ?? []) {
      if (
        !safeSourceUrl(attachment.url) ||
        seenUrls.has(attachment.url) ||
        present.includes(attachment.url)
      )
        continue;
      seenUrls.add(attachment.url);
      const name = calendarDescriptionText(attachment.title);
      attachments.push(
        hasText(name) ? `${name}: ${attachment.url}` : attachment.url,
      );
    }
    if (attachments.length)
      parts.push(`Lampiran Google Calendar:\n${attachments.join("\n")}`);
    return parts.join("\n\n");
  });
  return [
    `Izin ${leader.salutation}, menyampaikan agenda ${leader.salutation} pada hari ${formatDate(date)}, sebagai berikut:`,
    ...blocks,
    `Demikian disampaikan sebagai pengingat ${leader.salutation}. Terima kasih, ${leader.closing}.`,
  ].join("\n\n");
}

export function validateCalendarEvents(
  events: AgendaEvent[],
  leader: Leader,
  date: string,
  _totalSelectable = events.length,
): Validation {
  const errors: Issue[] = [];
  const add = (
    code: string,
    field: string,
    message: string,
    event?: AgendaEvent,
  ) =>
    errors.push({
      id: `${code}:${event?.id ?? "context"}:${field}`,
      code,
      field,
      message,
      ...(event ? { eventId: event.id } : {}),
    });
  const contextValid =
    leader &&
    hasText(leader.id) &&
    hasText(leader.name) &&
    ["Bapak", "Ibu"].includes(leader.salutation) &&
    ["Pak", "Bu"].includes(leader.closing) &&
    IANAZone.isValidZone(leader.timeZone) &&
    dateValid(date);
  if (!contextValid)
    add(
      "E01",
      "context",
      "Pilih pimpinan, tanggal, dan zona waktu profil yang valid.",
    );
  if (!events.length)
    add("E01", "selection", "Pilih setidaknya satu kegiatan untuk pesan.");
  if (events.length > MAX_SELECTED_EVENTS)
    add(
      "E07",
      "selection",
      "Maksimum 20 kegiatan per pesan. Bagi pilihan ke beberapa pesan.",
    );
  if (new Set(events.map((event) => event.id)).size !== events.length)
    add(
      "E07",
      "selection",
      "Kegiatan yang sama tidak boleh dipilih lebih dari sekali.",
    );
  for (const event of events) {
    if (
      !hasText(event.id) ||
      !isCalendarSelectable(event) ||
      !["confirmed", "tentative"].includes(event.status)
    )
      add(
        "E02",
        "selection",
        "Kegiatan dibatalkan atau tidak dapat dibaca sehingga tidak dapat dipilih.",
        event,
      );
    if (!hasText(calendarDescriptionText(event.sourceTitle)))
      add(
        "E03",
        "title",
        "Judul sumber kosong. Perbaiki judul di Google Calendar lalu muat ulang.",
        event,
      );
    const zone = event.allDay ? "UTC" : contextValid ? leader.timeZone : "UTC";
    const start = DateTime.fromISO(event.start, { zone });
    const end = DateTime.fromISO(event.end, { zone });
    const sourceTypeValid =
      typeof event.allDay === "boolean" &&
      (event.allDay
        ? dateValid(event.start) && dateValid(event.end)
        : typeof event.start === "string" &&
          typeof event.end === "string" &&
          event.start.includes("T") &&
          event.end.includes("T"));
    if (!start.isValid || !end.isValid || !sourceTypeValid)
      add(
        "E03",
        "timeFormat",
        "Waktu sumber tidak lengkap atau tidak valid. Perbaiki di Google Calendar.",
        event,
      );
    else if (end <= start)
      add(
        "E07",
        "timeFormat",
        "Waktu selesai sumber harus sesudah waktu mulai.",
        event,
      );
    else if (contextValid) {
      const dayStart = DateTime.fromISO(date, { zone });
      if (!(start < dayStart.plus({ days: 1 }) && end > dayStart))
        add(
          "E08",
          "timeFormat",
          "Kegiatan tidak beririsan dengan tanggal pilihan. Muat ulang dan periksa pilihan.",
          event,
        );
    }
  }
  if (
    contextValid &&
    !errors.length &&
    generateCalendarMessage(events, leader, date).length > MAX_MESSAGE_LENGTH
  )
    add(
      "E07",
      "message",
      "Pesan melebihi 40.000 karakter. Bagi pilihan ke beberapa pesan; isi tidak dipotong.",
    );
  return { errors, warnings: [] };
}
