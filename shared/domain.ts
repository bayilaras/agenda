import { DateTime, IANAZone } from "luxon";
import type {
  AgendaEvent,
  Issue,
  Leader,
  Supplement,
  Validation,
} from "./types";

export const TEMPLATE_VERSION = "1.0.0";
export const MAX_COPY_AGE_SECONDS = 120;
export const MAX_SELECTED_EVENTS = 20;
export const MAX_MESSAGE_LENGTH = 40_000;

const LABELS = [
  "Pelaksanaan",
  "ID Rapat",
  "Kode Sandi",
  "Agenda",
  "Bahan Rapat",
  "Keterangan",
  "Format Waktu",
] as const;
const ACCESS_ALIASES: Record<string, "ID Rapat" | "Kode Sandi"> = {
  "meeting id": "ID Rapat",
  passcode: "Kode Sandi",
  password: "Kode Sandi",
};
export interface MeetingAccessCandidate {
  field: "meetingUrl" | "meetingId" | "passcode";
  value: string;
  origin: string;
}
export interface MeetingAccessExtraction {
  candidates: MeetingAccessCandidate[];
  platforms: string[];
  conflicts: string[];
}
const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];
const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
const ROLES = [
  "",
  "Menghadiri",
  "Memimpin",
  "Memberikan Sambutan",
  "Memberikan Arahan",
] as const;
const hasValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const calendarDate = (date: string) => DateTime.fromISO(date, { zone: "UTC" });
const dateValid = (date: unknown): date is string =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  calendarDate(date).isValid;

export function todayInZone(timeZone: string): string {
  return DateTime.now().setZone(timeZone).toISODate() ?? "";
}
export function addDays(date: string, days: number): string {
  return calendarDate(date).plus({ days }).toISODate() ?? "";
}
export function formatDate(date: string): string {
  const value = calendarDate(date);
  return value.isValid
    ? `${DAYS[value.weekday - 1]}, ${value.day} ${MONTHS[value.month - 1]} ${value.year}`
    : "";
}
export function zoneLabel(timeZone: string): string {
  return (
    (
      {
        "Asia/Jakarta": "WIB",
        "Asia/Pontianak": "WIB",
        "Asia/Makassar": "WITA",
        "Asia/Ujung_Pandang": "WITA",
        "Asia/Jayapura": "WIT",
      } as Record<string, string>
    )[timeZone] ?? timeZone
  );
}

function decodeSourceEntities(source: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return source.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (whole, name: string) => {
      if (!name.startsWith("#")) return entities[name.toLowerCase()] ?? whole;
      const code =
        name[1]?.toLowerCase() === "x"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : whole;
    },
  );
}

function withoutHiddenHtml(source: string): string {
  return source
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*$/gi, "");
}

/** Returns safe plain text only. Never interprets or executes source HTML. */
export function plainSourceText(source: string): string {
  return decodeSourceEntities(
    withoutHiddenHtml(source)
      .replace(/\r\n?/g, "\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  );
}

function descriptionLabel(line: string) {
  const match = /^[ \t]*([^:]+?)[ \t]*:[ \t]?(.*)$/.exec(line);
  if (!match) return undefined;
  const name = match[1].trim().replace(/\s+/g, " ").toLocaleLowerCase("id");
  const canonical =
    LABELS.find((item) => item.toLocaleLowerCase("id") === name) ??
    ACCESS_ALIASES[name];
  return canonical
    ? {
        canonical,
        scalar: Object.hasOwn(ACCESS_ALIASES, name),
        value: match[2],
      }
    : undefined;
}

function invitationFooter(line: string): boolean {
  return /^(?:need help\??|join (?:the )?meeting(?: now)?|meeting options|for organizers|dial in by phone|find a local number|reset dial-in pin|privacy and security|learn more|microsoft teams|_{3,}|-{3,})(?:\s|:|$)/i.test(
    line.trim(),
  );
}

function readDescription(description: string) {
  const plainText = plainSourceText(description);
  const values: Record<string, string> = {};
  const entries: { label: string; value: string }[] = [];
  const conflicts: string[] = [];
  let label: string | undefined;
  let lines: string[] = [];
  const record = (name: string, value: string) => {
    entries.push({ label: name, value });
    if (Object.hasOwn(values, name)) {
      const conflict = `Label ${name} berulang; pilih nilai yang benar.`;
      if (!conflicts.includes(conflict)) conflicts.push(conflict);
    } else values[name] = value;
  };
  const flush = () => {
    if (!label) return;
    // Empty separating lines are structure; spaces inside the actual value are preserved.
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines[0] === "") lines.shift();
    record(label, lines.join("\n"));
    label = undefined;
    lines = [];
  };
  const sourceLines = plainText.split("\n");
  for (let index = 0; index < sourceLines.length; index++) {
    const line = sourceLines[index];
    const item = descriptionLabel(line);
    if (!item) {
      if (label) lines.push(line);
      continue;
    }
    flush();
    if (item.scalar) {
      let value = item.value;
      if (!value.trim()) {
        let next = index + 1;
        while (next < sourceLines.length && !sourceLines[next].trim()) next++;
        const nextIsHeader =
          next < sourceLines.length &&
          /^[\p{L}][\p{L} \t-]{1,60}:[ \t]+/u.test(sourceLines[next].trim());
        if (
          next < sourceLines.length &&
          !nextIsHeader &&
          !descriptionLabel(sourceLines[next]) &&
          !invitationFooter(sourceLines[next]) &&
          !/^https:\/\//i.test(sourceLines[next].trim())
        ) {
          value = sourceLines[next];
          index = next;
        }
      }
      record(item.canonical, value);
    } else {
      label = item.canonical;
      lines = [item.value];
    }
  }
  flush();
  return { plainText, values, conflicts, entries };
}

export function parseDescription(description: string): {
  values: Record<string, string>;
  conflicts: string[];
  plainText: string;
} {
  const { values, conflicts, plainText } = readDescription(description);
  return { values, conflicts, plainText };
}

/** Recognizes meeting join URLs, never help, sign-in, or shortener URLs. */
export function conferencePlatform(value: string): string {
  if (!isSafeHttpsUrl(value)) return "";
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    (host === "teams.microsoft.com" || host === "teams.live.com") &&
    /^\/(?:l\/meetup-join\/[^/]+(?:\/[^/]+)?|meet\/\d+)\/?$/i.test(url.pathname)
  )
    return "Microsoft Teams";
  if (
    (host === "zoom.us" || host.endsWith(".zoom.us")) &&
    /^\/(?:j\/\d+|my\/[^/]+|wc\/join\/\d+)\/?$/i.test(url.pathname)
  )
    return "Zoom Meeting";
  if (
    host === "meet.google.com" &&
    /^\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[^/]+)\/?$/i.test(url.pathname)
  )
    return "Google Meet";
  return "";
}

function normalizedPlatform(value: string): string {
  if (/^microsoft teams(?: meeting)?$/i.test(value)) return "Microsoft Teams";
  if (/^zoom(?: meeting)?$/i.test(value)) return "Zoom Meeting";
  if (/^google meet$/i.test(value)) return "Google Meet";
  return value;
}

export function extractMeetingAccess(
  description: string,
): MeetingAccessExtraction {
  const parsed = readDescription(description);
  const candidates: MeetingAccessCandidate[] = [];
  const platforms: string[] = [];
  const conflicts = [...parsed.conflicts];
  const addPlatform = (platform: string) => {
    if (platform && !platforms.includes(platform)) platforms.push(platform);
  };
  const add = (
    field: MeetingAccessCandidate["field"],
    value: string,
    origin: string,
  ) => {
    if (
      hasValue(value) &&
      !candidates.some((item) => item.field === field && item.value === value)
    )
      candidates.push({ field, value, origin });
  };
  for (const entry of parsed.entries) {
    if (entry.label === "ID Rapat")
      add("meetingId", entry.value, "Keterangan Google Calendar · ID rapat");
    if (entry.label === "Kode Sandi")
      add("passcode", entry.value, "Keterangan Google Calendar · kode sandi");
  }
  const addUrl = (value: string, origin: string) => {
    const platform = conferencePlatform(value);
    if (platform) {
      add("meetingUrl", value, origin);
      addPlatform(platform);
    }
  };
  // Read href without loading a DOM or following any URL, before HTML attributes are discarded.
  const html = withoutHiddenHtml(description);
  for (const match of html.matchAll(
    /<a(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/gi,
  )) {
    const attributes = match[0].slice(2, -1);
    for (const attribute of attributes.matchAll(
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
    )) {
      if (attribute[1].toLowerCase() !== "href") continue;
      addUrl(
        decodeSourceEntities(
          attribute[2] ?? attribute[3] ?? attribute[4] ?? "",
        ),
        "Keterangan Google Calendar · tautan HTML",
      );
      break;
    }
  }
  for (const match of parsed.plainText.matchAll(/https:\/\/[^\s<>"']+/gi)) {
    // Preserve the source token exactly, including query credentials and punctuation.
    addUrl(match[0], "Keterangan Google Calendar · tautan teks");
  }
  if (
    /^\s*Microsoft Teams(?: meeting)?(?:\s*[|·]?\s*Need help\??)?\s*$/im.test(
      parsed.plainText,
    )
  )
    addPlatform("Microsoft Teams");
  const explicitPlatform = /\bmelalui\s+([^\n]+)/i
    .exec(parsed.values.Pelaksanaan ?? "")?.[1]
    ?.trim();
  if (explicitPlatform) addPlatform(normalizedPlatform(explicitPlatform));
  for (const field of ["meetingUrl", "meetingId", "passcode"] as const) {
    if (candidates.filter((item) => item.field === field).length > 1)
      conflicts.push(
        `Keterangan memuat beberapa ${field === "meetingUrl" ? "tautan rapat" : field === "meetingId" ? "ID rapat" : "kode sandi"} berbeda. Pilih nilai yang benar.`,
      );
  }
  if (platforms.length > 1)
    conflicts.push(
      "Keterangan menyebut beberapa platform rapat berbeda. Pilih platform dan jalur bergabung yang benar.",
    );
  if (
    /^(?:secara\s+)?luring\b/i.test(parsed.values.Pelaksanaan ?? "") &&
    candidates.some((item) => item.field === "meetingUrl")
  )
    conflicts.push(
      "Pelaksanaan luring berbeda dengan kandidat tautan rapat daring. Periksa cara pelaksanaan pada sumber.",
    );
  return { candidates, platforms, conflicts };
}

export function emptySupplement(event: Partial<AgendaEvent> = {}): Supplement {
  const { values } = parseDescription(event.description ?? "");
  const access = extractMeetingAccess(event.description ?? "");
  const uniqueValue = (field: MeetingAccessCandidate["field"]) => {
    const entries = access.candidates.filter((item) => item.field === field);
    return entries.length === 1 ? entries[0].value : "";
  };
  const execution = values.Pelaksanaan ?? "";
  const executionMode = /^(?:secara\s+)?(daring|luring|hibrida)\b/i
    .exec(execution)?.[1]
    ?.toLowerCase();
  const explicitPlatform =
    /\bmelalui\s+(.+)/i.exec(execution)?.[1]?.trim() ?? "";
  const platform =
    access.platforms.length > 1
      ? ""
      : explicitPlatform || access.platforms[0] || "";
  return {
    title: event.sourceTitle ?? "",
    attendance: "undecided",
    role: "",
    representative: "",
    timeFormat: event.allDay
      ? "all-day"
      : /sampai\s+selesai|[–-]\s*selesai/i.test(values["Format Waktu"] ?? "")
        ? "until-finished"
        : "range",
    untilConfirmed: false,
    mode:
      executionMode === "daring"
        ? "online"
        : executionMode === "luring"
          ? "offline"
          : executionMode === "hibrida"
            ? "hybrid"
            : !execution.trim() &&
                !event.sourceLocation?.trim() &&
                access.platforms.length === 1
              ? "online"
              : "",
    location: event.sourceLocation ?? "",
    platform,
    meetingUrl: uniqueValue("meetingUrl"),
    meetingId: uniqueValue("meetingId"),
    passcode: uniqueValue("passcode"),
    accessCode: "unknown",
    accessVerified: false,
    agenda: values.Agenda ?? "",
    materialsStatus: "unchecked",
    materials: values["Bahan Rapat"] ?? "",
    materialLinks: [],
    includeMaterials: false,
    notes: values.Keterangan ?? "",
    sourceReviewed: false,
  };
}

export function isSelectable(event: AgendaEvent): boolean {
  return (
    event.status !== "cancelled" &&
    event.readable &&
    event.supplement.attendance !== "absent"
  );
}
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function effectiveTitle(event: AgendaEvent): string {
  return event.supplement.title.trim() || event.sourceTitle.trim();
}
export function sortEvents(events: AgendaEvent[]): AgendaEvent[] {
  return [...events].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    const startA = DateTime.fromISO(a.start, { zone: "UTC" }).toMillis();
    const startB = DateTime.fromISO(b.start, { zone: "UTC" }).toMillis();
    return (
      (Number.isFinite(startA - startB)
        ? startA - startB
        : compareText(a.start, b.start)) ||
      compareText(effectiveTitle(a), effectiveTitle(b)) ||
      compareText(a.id, b.id)
    );
  });
}

export function formatEventTime(event: AgendaEvent, timeZone: string): string {
  if (event.allDay) {
    const lastDay = addDays(event.end, -1);
    const base = "Seharian (jam tidak dicantumkan di kalender)";
    return lastDay && lastDay !== event.start
      ? `${base}, ${formatDate(event.start)}–${formatDate(lastDay)}`
      : base;
  }
  const start = DateTime.fromISO(event.start, { zone: timeZone }).setZone(
    timeZone,
  );
  const end = DateTime.fromISO(event.end, { zone: timeZone }).setZone(timeZone);
  if (!start.isValid) return "";
  const zone = zoneLabel(timeZone);
  const crossDay = end.isValid && start.toISODate() !== end.toISODate();
  if (event.supplement.timeFormat === "until-finished") {
    const range = crossDay
      ? ` (mulai ${formatDate(start.toISODate()!)}; rentang kalender sampai ${formatDate(end.toISODate()!)})`
      : "";
    return `Pukul ${start.toFormat("HH.mm")} ${zone}–selesai${range}`;
  }
  if (!end.isValid) return "";
  if (crossDay)
    return `${formatDate(start.toISODate()!)} pukul ${start.toFormat("HH.mm")}–${formatDate(end.toISODate()!)} pukul ${end.toFormat("HH.mm")} ${zone}`;
  return `Pukul ${start.toFormat("HH.mm")}–${end.toFormat("HH.mm")} ${zone}`;
}

export function isSafeHttpsUrl(value: string): boolean {
  if (value !== value.trim() || /[\u0000-\u0020\u007f]/.test(value))
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !!url.hostname &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

const TEXT_LIMITS: Partial<Record<keyof Supplement, number>> = {
  title: 500,
  representative: 300,
  location: 1000,
  platform: 300,
  meetingUrl: 2048,
  meetingId: 256,
  passcode: 256,
  agenda: 6000,
  materials: 4000,
  notes: 4000,
};
const ENUMS = {
  attendance: ["undecided", "attending", "represented", "absent"],
  role: ROLES,
  timeFormat: ["range", "until-finished", "all-day"],
  mode: ["", "online", "offline", "hybrid"],
  accessCode: ["required", "not-required", "unknown"],
  materialsStatus: ["unchecked", "available", "unavailable", "unnecessary"],
} as const;
const BOOLEANS = [
  "untilConfirmed",
  "accessVerified",
  "includeMaterials",
  "sourceReviewed",
] as const;

/** Strict request-shape validation, shared with the server. Does not alter values. */
export function validateSupplement(value: unknown): Issue[] {
  const issues: Issue[] = [];
  const add = (field: string, message: string) =>
    issues.push({ id: `E07:${field}`, code: "E07", field, message });
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    add("supplement", "Isian pelengkap harus berupa objek yang lengkap.");
    return issues;
  }
  const data = value as Record<string, unknown>;
  const allowed = new Set([
    ...Object.keys(TEXT_LIMITS),
    ...Object.keys(ENUMS),
    ...BOOLEANS,
    "materialLinks",
  ]);
  for (const key of Object.keys(data))
    if (!allowed.has(key)) add(key, `Kolom ${key} tidak dikenal.`);
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    if (typeof data[field] !== "string")
      add(field, `Kolom ${field} harus berupa teks.`);
    else if ((data[field] as string).length > limit)
      add(
        field,
        `Kolom ${field} melebihi batas ${limit.toLocaleString("id-ID")} karakter; isi tidak dipotong.`,
      );
  }
  for (const [field, choices] of Object.entries(ENUMS))
    if (!(choices as readonly unknown[]).includes(data[field]))
      add(field, `Pilihan ${field} tidak valid.`);
  for (const field of BOOLEANS)
    if (typeof data[field] !== "boolean")
      add(field, `Konfirmasi ${field} harus berupa benar atau salah.`);
  if (hasValue(data.meetingUrl) && !isSafeHttpsUrl(data.meetingUrl))
    add("meetingUrl", "Tautan rapat harus berupa URL HTTPS yang valid.");
  if (!Array.isArray(data.materialLinks))
    add("materialLinks", "Tautan bahan harus berupa daftar.");
  else {
    if (data.materialLinks.length > 10)
      add("materialLinks", "Maksimum 10 tautan bahan.");
    data.materialLinks.forEach((link: unknown, index: number) => {
      const field = `materialLinks.${index}`;
      if (!link || typeof link !== "object" || Array.isArray(link))
        return add(field, "Setiap tautan bahan harus memiliki judul dan URL.");
      const item = link as Record<string, unknown>;
      if (Object.keys(item).some((key) => key !== "title" && key !== "url"))
        add(field, "Tautan bahan memiliki kolom yang tidak dikenal.");
      if (!hasValue(item.title) || item.title.length > 300)
        add(
          `${field}.title`,
          "Judul tautan bahan wajib diisi, maksimum 300 karakter.",
        );
      if (
        !hasValue(item.url) ||
        item.url.length > 2048 ||
        !isSafeHttpsUrl(item.url)
      )
        add(
          `${field}.url`,
          "Tautan bahan harus berupa URL HTTPS yang valid, maksimum 2.048 karakter.",
        );
    });
  }
  return issues;
}

export function validateEvents(
  events: AgendaEvent[],
  leader: Leader,
  date: string,
  totalSelectable = events.length,
): Validation {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const add = (
    target: Issue[],
    code: string,
    field: string,
    message: string,
    event?: AgendaEvent,
    acknowledgement?: string,
    suffix = "",
  ) => {
    target.push({
      id: `${code}:${event?.id ?? "context"}:${field}${suffix ? `:${suffix}` : ""}`,
      code,
      field,
      message,
      ...(event ? { eventId: event.id } : {}),
      ...(acknowledgement ? { acknowledgement } : {}),
    });
  };
  const contextValid =
    leader &&
    hasValue(leader.id) &&
    hasValue(leader.name) &&
    ["Bapak", "Ibu"].includes(leader.salutation) &&
    ["Pak", "Bu"].includes(leader.closing) &&
    IANAZone.isValidZone(leader.timeZone) &&
    dateValid(date);
  if (!contextValid)
    add(
      errors,
      "E01",
      "context",
      "Pilih pimpinan, tanggal, dan zona waktu profil yang valid.",
    );
  if (!events.length)
    add(
      errors,
      "E01",
      "selection",
      "Pilih setidaknya satu kegiatan untuk pesan.",
    );
  if (events.length > MAX_SELECTED_EVENTS)
    add(
      errors,
      "E07",
      "selection",
      "Maksimum 20 kegiatan per pesan. Bagi pilihan ke beberapa pesan.",
    );
  if (new Set(events.map((event) => event.id)).size !== events.length)
    add(
      errors,
      "E07",
      "selection",
      "Kegiatan yang sama tidak boleh dipilih lebih dari sekali.",
    );
  if (contextValid && date < todayInZone(leader.timeZone))
    add(
      warnings,
      "W06",
      "date",
      "Tanggal pesan sudah lampau.",
      undefined,
      "Saya tetap menggunakan tanggal lampau ini",
    );
  if (events.length > 0 && events.length < totalSelectable)
    add(
      warnings,
      "W07",
      "selection",
      "Pesan hanya mencakup sebagian kegiatan yang dapat dipilih.",
      undefined,
      "Saya telah memeriksa pilihan kegiatan",
    );

  for (const event of events) {
    const s = event.supplement;
    const structure = validateSupplement(s);
    for (const issue of structure)
      errors.push({
        ...issue,
        id: `${issue.code}:${event.id}:${issue.field}`,
        eventId: event.id,
      });
    if (structure.length) continue;
    if (!isSelectable(event))
      add(
        errors,
        "E02",
        "selection",
        "Kegiatan dibatalkan, tidak dapat dibaca, atau berstatus Tidak hadir sehingga tidak dapat dipilih.",
        event,
      );
    if (!hasValue(event.sourceTitle))
      add(
        errors,
        "E03",
        "title",
        "Judul sumber kosong. Perbaiki judul di Google Calendar lalu muat ulang.",
        event,
        undefined,
        "source",
      );
    if (!hasValue(effectiveTitle(event)))
      add(errors, "E03", "title", "Judul kegiatan wajib tersedia.", event);
    if (effectiveTitle(event).length > 500)
      add(
        errors,
        "E07",
        "title",
        "Judul pesan melebihi batas 500 karakter. Sesuaikan redaksi secara manual.",
        event,
      );
    if (!hasValue(s.agenda))
      add(
        errors,
        "E03",
        "agenda",
        "Pokok agenda wajib diisi dari sumber yang telah diperiksa.",
        event,
      );
    // Only known demonstration values are placeholders. Brackets in real source data remain legitimate.
    const placeholders: Partial<Record<keyof Supplement, readonly string[]>> = {
      meetingId: ["[ID rapat sesuai sumber]"],
      passcode: ["[kode sandi persis sumber]"],
      title: ["{judul_pesan}"],
      agenda: ["{pokok_agenda}"],
    };
    for (const [field, candidates] of Object.entries(placeholders)) {
      const value = s[field as keyof Supplement];
      if (
        typeof value === "string" &&
        candidates.some(
          (candidate) => candidate.toLowerCase() === value.trim().toLowerCase(),
        )
      )
        add(
          errors,
          "E09",
          field,
          "Nilai masih berupa contoh atau variabel template. Isi nilai sebenarnya yang telah diperiksa.",
          event,
        );
    }
    if (!s.mode)
      add(errors, "E03", "mode", "Pilih mode pelaksanaan kegiatan.", event);
    if ((s.mode === "offline" || s.mode === "hybrid") && !hasValue(s.location))
      add(
        errors,
        "E04",
        "location",
        "Kegiatan luring atau hibrida memerlukan tempat fisik.",
        event,
      );
    if (s.mode === "online" || s.mode === "hybrid") {
      if (!hasValue(s.platform))
        add(
          errors,
          "E03",
          "platform",
          "Platform rapat daring wajib diisi.",
          event,
        );
      if (s.accessCode === "unknown")
        add(
          errors,
          "E05",
          "accessCode",
          "Kebutuhan kode rapat belum diketahui. Periksa jalur bergabung.",
          event,
        );
      const reviewedLink =
        hasValue(s.meetingUrl) &&
        isSafeHttpsUrl(s.meetingUrl) &&
        s.accessVerified;
      const usableId =
        hasValue(s.meetingId) &&
        (s.accessCode === "not-required" ||
          (s.accessCode === "required" && hasValue(s.passcode)));
      if (!reviewedLink && !usableId)
        add(
          errors,
          "E05",
          "meetingUrl",
          "Isi tautan rapat yang telah diperiksa, atau ID rapat beserta kode yang diperlukan.",
          event,
        );
      if (s.accessCode === "required" && !hasValue(s.passcode) && !reviewedLink)
        add(
          errors,
          "E05",
          "passcode",
          "Kode sandi wajib diisi untuk jalur ID rapat ini.",
          event,
        );
    }
    if (s.attendance === "represented" && !hasValue(s.representative))
      add(
        errors,
        "E06",
        "representative",
        "Isi nama perwakilan untuk kegiatan yang diwakilkan.",
        event,
      );
    if (
      s.attendance !== "attending" &&
      (s.role !== "" ||
        /^(menghadiri|memimpin|memberikan\s+sambutan|memberikan\s+arahan)\b/i.test(
          effectiveTitle(event),
        ))
    )
      add(
        errors,
        "E06",
        "title",
        "Gunakan judul netral dan Tanpa awalan saat kehadiran belum diputuskan atau diwakilkan.",
        event,
      );

    const start = DateTime.fromISO(event.start, {
      zone: event.allDay ? "UTC" : (leader?.timeZone ?? "UTC"),
    });
    const end = DateTime.fromISO(event.end, {
      zone: event.allDay ? "UTC" : (leader?.timeZone ?? "UTC"),
    });
    if (!start.isValid || !end.isValid)
      add(
        errors,
        "E03",
        "timeFormat",
        "Waktu sumber tidak lengkap atau tidak valid. Perbaiki di Google Calendar.",
        event,
      );
    else if (end <= start)
      add(
        errors,
        "E07",
        "timeFormat",
        "Waktu selesai sumber harus sesudah waktu mulai.",
        event,
        undefined,
        "end-order",
      );
    if (
      event.allDay
        ? !dateValid(event.start) ||
          !dateValid(event.end) ||
          s.timeFormat !== "all-day"
        : dateValid(event.start) ||
          dateValid(event.end) ||
          s.timeFormat === "all-day"
    )
      add(
        errors,
        "E07",
        "timeFormat",
        "Format waktu harus sesuai tipe acara sumber.",
        event,
        undefined,
        "source-type",
      );
    if (s.timeFormat === "until-finished" && !s.untilConfirmed)
      add(
        errors,
        "E07",
        "untilConfirmed",
        "Konfirmasikan bahwa sumber menyebut sampai selesai.",
        event,
      );
    if (
      event.endTimeUnspecified &&
      s.timeFormat === "range" &&
      !s.sourceReviewed
    )
      add(
        errors,
        "E08",
        "sourceReviewed",
        "Kalender menandai jam selesai belum pasti. Periksa sumber dan format waktu.",
        event,
        undefined,
        "uncertain-end",
      );
    if (
      event.reviewedSourceVersion &&
      event.reviewedSourceVersion !== event.sourceVersion
    )
      add(
        errors,
        "E08",
        "sourceReviewed",
        "Sumber berubah setelah pemeriksaan terakhir. Periksa dan simpan pelengkap kembali.",
        event,
        undefined,
        "source-version",
      );
    if (
      hasValue(event.sourceLocation) &&
      s.location !== event.sourceLocation &&
      !s.sourceReviewed
    )
      add(
        errors,
        "E08",
        "location",
        "Tempat pelengkap berbeda dari lokasi sumber. Periksa perbedaan dan konfirmasikan sumber.",
        event,
      );
    if (
      (event.conflicts.length > 0 ||
        extractMeetingAccess(event.description).conflicts.length > 0) &&
      !s.sourceReviewed
    )
      add(
        errors,
        "E08",
        "sourceReviewed",
        "Ada kandidat sumber yang bertentangan. Pilih nilai yang benar dan konfirmasikan pemeriksaan sumber.",
        event,
        undefined,
        "source-candidates",
      );
    if (contextValid && start.isValid && end.isValid) {
      const dayStart = DateTime.fromISO(date, {
        zone: event.allDay ? "UTC" : leader.timeZone,
      });
      if (!(start < dayStart.plus({ days: 1 }) && end > dayStart))
        add(
          errors,
          "E08",
          "timeFormat",
          "Kegiatan tidak beririsan dengan tanggal pilihan. Muat ulang dan periksa pilihan.",
          event,
        );
    }

    if (s.attendance === "undecided")
      add(
        warnings,
        "W03",
        "attendance",
        "Kehadiran pimpinan belum diputuskan; pesan memakai judul netral dan keterangan menunggu arahan.",
        event,
        "Tetap sertakan sebagai agenda menunggu arahan",
      );
    if (s.materialsStatus === "unchecked")
      add(
        warnings,
        "W01",
        "materialsStatus",
        "Bahan rapat belum diperiksa.",
        event,
        s.includeMaterials
          ? "Saya telah memeriksa redaksi bahan yang dicantumkan"
          : "Bahan tidak perlu dicantumkan",
      );
    if (s.materialsStatus === "unavailable")
      add(
        warnings,
        "W02",
        "materialsStatus",
        "Bahan rapat belum tersedia.",
        event,
        s.includeMaterials
          ? "Saya telah memeriksa keterangan bahan yang dicantumkan"
          : "Bahan tidak perlu dicantumkan",
      );
    if (s.includeMaterials && s.materialLinks.length)
      add(
        warnings,
        "W08",
        "materialLinks",
        "Akses penerima ke tautan bahan perlu diperiksa. Sistem tidak memeriksa izin file.",
        event,
        "Akses bahan sudah saya periksa",
      );
    if (
      /\b(?:terlampir|dilampirkan)\b/i.test(
        [s.includeMaterials ? s.materials : "", s.notes, s.agenda].join("\n"),
      )
    )
      add(
        warnings,
        "W10",
        "materials",
        "Redaksi menyebut lampiran. Salin Pesan hanya menyalin teks dan tidak melampirkan file.",
        event,
        "Saya telah memeriksa redaksi lampiran dan memahami bahwa file tidak ikut disalin",
      );
    if (event.allDay)
      add(
        warnings,
        "W05",
        "timeFormat",
        "Kegiatan seharian tidak memiliki jam pasti di kalender.",
        event,
        "Saya telah memeriksa kegiatan seharian ini",
      );
    if (
      !event.allDay &&
      (s.timeFormat === "until-finished" || event.endTimeUnspecified)
    )
      add(
        warnings,
        "W09",
        "timeFormat",
        "Durasi belum pasti; bentrok belum dapat dipastikan.",
        event,
        "Saya memahami bahwa durasi dan bentrok belum dapat dipastikan",
      );
  }
  const definite = sortEvents(
    events.filter(
      (event) =>
        !event.allDay &&
        !event.endTimeUnspecified &&
        event.supplement.timeFormat === "range",
    ),
  );
  for (let i = 0; i < definite.length; i++)
    for (let j = i + 1; j < definite.length; j++) {
      const a = definite[i],
        b = definite[j];
      if (
        DateTime.fromISO(a.start) < DateTime.fromISO(b.end) &&
        DateTime.fromISO(b.start) < DateTime.fromISO(a.end)
      )
        add(
          warnings,
          "W04",
          "timeFormat",
          `Waktu bertumpang tindih dengan “${effectiveTitle(b)}”. Periksa rencana kehadiran.`,
          a,
          "Saya telah memeriksa bentrok waktu ini",
          b.id,
        );
    }
  if (
    contextValid &&
    errors.length === 0 &&
    generateMessage(events, leader, date).length > MAX_MESSAGE_LENGTH
  )
    add(
      errors,
      "E07",
      "message",
      "Pesan melebihi 40.000 karakter. Bagi pilihan ke beberapa pesan; isi tidak dipotong.",
    );
  return { errors, warnings };
}

export function generateMessage(
  events: AgendaEvent[],
  leader: Leader,
  date: string,
): string {
  const blocks = sortEvents(events).map((event, index) => {
    const s = event.supplement;
    let title = effectiveTitle(event);
    if (
      s.attendance === "attending" &&
      s.role &&
      !title
        .toLocaleLowerCase("id")
        .startsWith(`${s.role.toLocaleLowerCase("id")} `) &&
      title.toLocaleLowerCase("id") !== s.role.toLocaleLowerCase("id")
    )
      title = `${s.role} ${title}`;
    const parts = [events.length > 1 ? `${index + 1}. ${title}` : title];
    const time = formatEventTime(event, leader.timeZone);
    if (time) parts.push(`Waktu: ${time}`);
    const execution =
      s.mode === "online"
        ? `Secara daring melalui ${s.platform}`
        : s.mode === "offline"
          ? `Secara luring di ${s.location}`
          : s.mode === "hybrid"
            ? `Secara hibrida di ${s.location} dan daring melalui ${s.platform}`
            : "";
    if (execution) parts.push(`Pelaksanaan: ${execution}`);
    if (s.mode === "online" || s.mode === "hybrid") {
      if (hasValue(s.meetingId)) parts.push(`ID Rapat: ${s.meetingId}`);
      if (hasValue(s.passcode)) parts.push(`Kode Sandi: ${s.passcode}`);
      if (hasValue(s.meetingUrl)) parts.push(`Tautan Rapat: ${s.meetingUrl}`);
    }
    if (hasValue(s.agenda))
      parts.push(`Agenda:\n${s.agenda.replace(/\r\n?/g, "\n")}`);
    if (s.includeMaterials && s.materialsStatus !== "unnecessary") {
      const materials = [
        s.materials.replace(/\r\n?/g, "\n"),
        ...s.materialLinks.map((link) => `${link.title}: ${link.url}`),
      ]
        .filter(hasValue)
        .join("\n");
      if (materials) parts.push(`Bahan Rapat:\n${materials}`);
    }
    const notes = [s.notes.replace(/\r\n?/g, "\n")].filter(hasValue);
    if (s.attendance === "undecided")
      notes.push(`Kehadiran menunggu arahan ${leader.salutation}.`);
    if (s.attendance === "represented" && hasValue(s.representative))
      notes.push(`Diwakilkan oleh ${s.representative}.`);
    if (notes.length) parts.push(`Keterangan:\n${notes.join("\n")}`);
    return parts.join("\n\n");
  });
  return [
    `Izin ${leader.salutation}, menyampaikan agenda ${leader.salutation} pada hari ${formatDate(date)}, sebagai berikut:`,
    ...blocks,
    `Demikian disampaikan sebagai pengingat ${leader.salutation}. Terima kasih, ${leader.closing}.`,
  ].join("\n\n");
}
