import test from "node:test";
import assert from "node:assert/strict";
import {
  emptySupplement,
  MAX_MESSAGE_LENGTH,
  MAX_SELECTED_EVENTS,
} from "../shared/domain";
import {
  generateCalendarMessage,
  isCalendarSelectable,
  validateCalendarEvents,
} from "../shared/calendar-message";
import type { AgendaEvent, Leader } from "../shared/types";

const leader: Leader = {
  id: "leader-calendar",
  name: "Kepala Kantor",
  position: "Kepala",
  salutation: "Bapak",
  closing: "Pak",
  timeZone: "Asia/Jakarta",
  calendarName: "Agenda Kepala",
  revision: 1,
};
const date = "2026-09-18";
function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    id: "calendar-only",
    sourceTitle: "Pembahasan Program Kerja",
    description: "",
    start: `${date}T10:00:00+07:00`,
    end: `${date}T12:00:00+07:00`,
    allDay: false,
    sourceLocation: "",
    htmlLink: "https://calendar.google.com/",
    sourceVersion: "v2",
    status: "confirmed",
    readable: true,
    supplement: emptySupplement(),
    revision: 0,
    reviewedSourceVersion: "",
    conflicts: [],
    ...overrides,
  };
}

test("calendar message uses complete source description, HTML links, and attachments with no manual values", () => {
  const teamsUrl = "https://teams.microsoft.com/meet/123456789?p=Ab%2BC)&x=1";
  const fileUrl =
    "https://drive.google.com/file/d/sample-invitation/view?resourcekey=A%2FB";
  const source = event({
    sourceLocation: "Ruang Rapat A",
    description:
      '<p>Pembahasan tindak lanjut program.</p><p>Melalui Meeting Teams Join:<br><a href="https://teams.microsoft.com/meet/123456789?p=Ab%2BC)&amp;x=1">Join the meeting</a><br>Meeting ID:<br>123 456 789<br><br>Passcode:<br>A:1&lt;42&gt;)</p><p>Peserta membawa bahan usulan.<br>Baris terakhir tetap dicantumkan.</p>',
    sourceCandidates: [
      { field: "meetingUrl", value: teamsUrl, origin: "conferenceData" },
    ],
    sourceAttachments: [{ title: "Surat undangan.pdf", url: fileUrl }],
  });
  const message = generateCalendarMessage([source], leader, date);
  assert.equal(
    message,
    [
      "Izin Bapak, menyampaikan agenda Bapak pada hari Jumat, 18 September 2026, sebagai berikut:",
      "Pembahasan Program Kerja",
      "Waktu: Pukul 10.00–12.00 WIB",
      "Tempat: Ruang Rapat A",
      `Keterangan kalender:\nPembahasan tindak lanjut program.\n\nMelalui Meeting Teams Join:\nJoin the meeting (${teamsUrl})\nMeeting ID:\n123 456 789\n\nPasscode:\nA:1<42>)\n\nPeserta membawa bahan usulan.\nBaris terakhir tetap dicantumkan.`,
      `Lampiran Google Calendar:\nSurat undangan.pdf: ${fileUrl}`,
      "Demikian disampaikan sebagai pengingat Bapak. Terima kasih, Pak.",
    ].join("\n\n"),
  );
  assert.deepEqual(validateCalendarEvents([source], leader, date), {
    errors: [],
    warnings: [],
  });
  assert.equal(message.split(teamsUrl).length - 1, 1);
  assert.doesNotMatch(
    message,
    /Kehadiran menunggu|Menghadiri|Diwakilkan|Secara daring/,
  );
});

test("source-only generation and selection never consult saved supplement or review status", () => {
  const source = event({
    reviewedSourceVersion: "old-source",
    conflicts: ["Two source links"],
  });
  Object.defineProperty(source, "supplement", {
    get() {
      throw new Error("Manual supplement was read");
    },
  });
  assert.equal(isCalendarSelectable(source), true);
  assert.doesNotThrow(() => generateCalendarMessage([source], leader, date));
  assert.deepEqual(validateCalendarEvents([source], leader, date), {
    errors: [],
    warnings: [],
  });
  const absent = event();
  Reflect.deleteProperty(absent, "supplement");
  assert.deepEqual(validateCalendarEvents([absent], leader, date), {
    errors: [],
    warnings: [],
  });
  assert.match(
    generateCalendarMessage([absent], leader, date),
    /Pukul 10.00–12.00 WIB/,
  );
});

test("missing optional source details stay absent rather than becoming manual requirements or guesses", () => {
  const source = event({
    description: "",
    sourceLocation: "",
    status: "tentative",
  });
  source.supplement = {
    ...emptySupplement(),
    title: "Manual title",
    attendance: "absent",
    role: "Memimpin",
    timeFormat: "until-finished",
    agenda: "Manual agenda",
    location: "Manual place",
    passcode: "Manual secret",
    notes: "Manual note",
  };
  const text = generateCalendarMessage([source], leader, date);
  assert.match(
    text,
    /Pembahasan Program Kerja\n\nWaktu: Pukul 10.00–12.00 WIB/,
  );
  assert.doesNotMatch(
    text,
    /Manual|Tempat:|Keterangan kalender:|Akses rapat|Lampiran|selesai|Memimpin/,
  );
  assert.deepEqual(validateCalendarEvents([source], leader, date, 8), {
    errors: [],
    warnings: [],
  });
});

test("native access candidates retain multiple alternatives and exact credentials without silent choice", () => {
  const teams = "https://teams.microsoft.com/meet/123456789?p=Code)";
  const meet = "https://meet.google.com/abc-defg-hij";
  const source = event({
    description: `Melalui Teams:\n${teams}\nMeeting ID: 123 456 789`,
    sourceCandidates: [
      { field: "meetingUrl", value: teams, origin: "description" },
      { field: "meetingUrl", value: meet, origin: "conferenceData" },
      { field: "meetingUrl", value: meet, origin: "hangoutLink" },
      { field: "meetingId", value: "123 456 789", origin: "description" },
      { field: "meetingId", value: "987 654 321", origin: "conferenceData" },
      { field: "passcode", value: "  A:1.<ABC>)  ", origin: "conferenceData" },
    ],
    conflicts: ["Two meeting links"],
  });
  const text = generateCalendarMessage([source], leader, date);
  assert.equal(text.split(teams).length - 1, 1);
  assert.equal(text.split(meet).length - 1, 1);
  assert.equal(text.split("123 456 789").length - 1, 1);
  assert.match(text, /ID Rapat: 987 654 321/);
  assert.ok(text.includes("Kode Sandi:   A:1.<ABC>)  \n\n"));
  assert.deepEqual(validateCalendarEvents([source], leader, date).errors, []);
});

test("safe source HTML becomes plain text without double decoding or changing credential punctuation", () => {
  const source = event({
    description:
      '<style>hidden style</style><script>hidden script</script><p>Passcode: Raw<42>)</p><p>Entity: &amp;lt;one&amp;gt;</p><p><a href="javascript:alert(1)">Read me</a> <a href="https://example.com/?p=Code]&amp;q=%2B">Reference</a></p><!--hidden comment--><svg>hidden svg</svg>',
  });
  const text = generateCalendarMessage([source], leader, date);
  assert.ok(text.includes("Passcode: Raw<42>)"));
  assert.ok(text.includes("Entity: &lt;one&gt;"));
  assert.ok(
    text.includes("Read me Reference (https://example.com/?p=Code]&q=%2B)"),
  );
  assert.doesNotMatch(text, /hidden|javascript:|<script|<p>/);
});

test("attachments dedupe source links and do not pretend to extract or attach PDF content", () => {
  const url = "https://drive.google.com/file/d/example/view";
  const source = event({
    sourceAttachments: [
      { title: "Surat <b>Undangan</b>.pdf", url },
      { title: "Duplicate.pdf", url },
      { title: "Unsafe.pdf", url: "javascript:alert(1)" },
    ],
  });
  const text = generateCalendarMessage([source], leader, date);
  assert.ok(
    text.includes(`Lampiran Google Calendar:\nSurat Undangan.pdf: ${url}`),
  );
  assert.equal(text.split(url).length - 1, 1);
  assert.doesNotMatch(text, /Duplicate|Unsafe|terlampir|javascript/);
  source.description = `Surat: ${url}`;
  assert.doesNotMatch(
    generateCalendarMessage([source], leader, date),
    /Lampiran Google Calendar:/,
  );
});

test("private and cancelled source events cannot be selected or leak into generated text", () => {
  for (const source of [
    event({ readable: false }),
    event({ status: "cancelled" }),
  ]) {
    source.description = "SECRET CONTENT";
    assert.equal(isCalendarSelectable(source), false);
    assert.ok(
      validateCalendarEvents([source], leader, date).errors.some(
        (issue) => issue.code === "E02",
      ),
    );
    assert.doesNotMatch(
      generateCalendarMessage([source], leader, date),
      /SECRET CONTENT|Pembahasan Program Kerja/,
    );
  }
});

test("all-day, overnight, timezone, and uncertain source times ignore manual time overrides", () => {
  const allDay = event({
    allDay: true,
    start: "2026-09-17",
    end: "2026-09-20",
  });
  allDay.supplement.timeFormat = "until-finished";
  assert.match(
    generateCalendarMessage([allDay], leader, date),
    /Seharian \(jam tidak dicantumkan di kalender\), Kamis, 17 September 2026–Sabtu, 19 September 2026/,
  );
  assert.deepEqual(validateCalendarEvents([allDay], leader, date), {
    errors: [],
    warnings: [],
  });
  const overnight = event({
    start: "2026-09-17T23:30:00+07:00",
    end: "2026-09-18T00:30:00+07:00",
  });
  assert.match(
    generateCalendarMessage([overnight], leader, date),
    /Kamis, 17 September 2026 pukul 23.30–Jumat, 18 September 2026 pukul 00.30 WIB/,
  );
  assert.deepEqual(
    validateCalendarEvents([overnight], leader, date).errors,
    [],
  );
  assert.match(
    generateCalendarMessage(
      [event()],
      { ...leader, timeZone: "Asia/Jayapura" },
      date,
    ),
    /Pukul 12.00–14.00 WIT/,
  );
  const uncertain = generateCalendarMessage(
    [event({ endTimeUnspecified: true })],
    leader,
    date,
  );
  assert.match(
    uncertain,
    /Pukul 10.00 WIB \(jam selesai belum ditentukan di kalender\)/,
  );
  assert.doesNotMatch(uncertain, /12.00|–selesai/);
});

test("validation blocks malformed context, selection, missing title, and invalid source times", () => {
  assert.ok(
    validateCalendarEvents([], leader, date).errors.some(
      (issue) => issue.field === "selection",
    ),
  );
  assert.ok(
    validateCalendarEvents(
      [event()],
      { ...leader, timeZone: "Invalid/Zone" },
      date,
    ).errors.some((issue) => issue.field === "context"),
  );
  assert.ok(
    validateCalendarEvents([event()], leader, "2026-02-30").errors.some(
      (issue) => issue.field === "context",
    ),
  );
  assert.ok(
    validateCalendarEvents([event(), event()], leader, date).errors.some(
      (issue) => issue.field === "selection",
    ),
  );
  assert.ok(
    validateCalendarEvents(
      Array.from({ length: MAX_SELECTED_EVENTS + 1 }, (_, i) =>
        event({ id: `event-${i}` }),
      ),
      leader,
      date,
    ).errors.some((issue) => issue.field === "selection"),
  );
  assert.ok(
    validateCalendarEvents(
      [event({ sourceTitle: "  " })],
      leader,
      date,
    ).errors.some((issue) => issue.field === "title"),
  );
  for (const source of [
    event({ start: "invalid" }),
    event({ end: `${date}T09:00:00+07:00` }),
    event({ start: date }),
    event({ allDay: true }),
    event({
      start: "2026-09-19T10:00:00+07:00",
      end: "2026-09-19T12:00:00+07:00",
    }),
  ])
    assert.ok(
      validateCalendarEvents([source], leader, date).errors.some(
        (issue) => issue.field === "timeFormat",
      ),
    );
});

test("source text is never truncated and long messages are blocked with a clear size error", () => {
  const description = `${"Utuh. ".repeat(MAX_MESSAGE_LENGTH)}\nPENUTUP HARUS UTUH`;
  const source = event({ description });
  const text = generateCalendarMessage([source], leader, date);
  assert.ok(text.includes(description));
  assert.ok(text.includes("PENUTUP HARUS UTUH"));
  assert.ok(
    validateCalendarEvents([source], leader, date).errors.some(
      (issue) =>
        issue.field === "message" &&
        issue.message.includes("isi tidak dipotong"),
    ),
  );
});

test("source order is stable and independent of manual titles", () => {
  const a = event({ id: "a", sourceTitle: "A sumber" });
  const b = event({ id: "b", sourceTitle: "B sumber" });
  a.supplement.title = "Z manual";
  b.supplement.title = "A manual";
  const text = generateCalendarMessage([b, a], leader, date);
  assert.ok(text.indexOf("1. A sumber") < text.indexOf("2. B sumber"));
  assert.doesNotMatch(text, /manual/);
});
