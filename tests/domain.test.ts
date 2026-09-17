import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  conferencePlatform,
  emptySupplement,
  extractMeetingAccess,
  formatDate,
  formatEventTime,
  generateMessage,
  isSafeHttpsUrl,
  isSelectable,
  parseDescription,
  plainSourceText,
  sortEvents,
  validateEvents,
  validateSupplement,
  zoneLabel,
} from "../shared/domain";
import type { AgendaEvent, Leader } from "../shared/types";

const leader: Leader = {
  id: "leader-1",
  name: "Kepala Kantor",
  position: "Kepala",
  salutation: "Bapak",
  closing: "Pak",
  timeZone: "Asia/Jakarta",
  calendarName: "Agenda Kepala",
  revision: 1,
};
function event(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  const result: AgendaEvent = {
    id: "event-1",
    sourceTitle: "Rapat Koordinasi",
    description: "",
    start: "2026-09-16T13:30:00+07:00",
    end: "2026-09-16T15:00:00+07:00",
    allDay: false,
    sourceLocation: "",
    htmlLink: "https://calendar.google.com/",
    sourceVersion: "v1",
    status: "confirmed",
    readable: true,
    supplement: emptySupplement(),
    revision: 1,
    reviewedSourceVersion: "v1",
    conflicts: [],
    ...overrides,
  };
  result.supplement = {
    ...emptySupplement(result),
    attendance: "attending",
    role: "Menghadiri",
    mode: "online",
    platform: "Zoom Meeting",
    agenda: "Pembahasan program kerja.",
    meetingId: "001 234 5678",
    passcode: "Contoh.2026.",
    accessCode: "required",
    materialsStatus: "unnecessary",
    sourceReviewed: true,
    ...overrides.supplement,
  };
  return result;
}
function errors(value: AgendaEvent, date = "2026-09-16") {
  return validateEvents([value], leader, date).errors;
}

test("the single-event message is exact and preserves credentials and punctuation", () => {
  const value = event();
  value.supplement.timeFormat = "until-finished";
  value.supplement.untilConfirmed = true;
  assert.equal(
    generateMessage([value], leader, "2026-09-16"),
    [
      "Izin Bapak, menyampaikan agenda Bapak pada hari Rabu, 16 September 2026, sebagai berikut:",
      "Menghadiri Rapat Koordinasi",
      "Waktu: Pukul 13.30 WIB–selesai",
      "Pelaksanaan: Secara daring melalui Zoom Meeting",
      "ID Rapat: 001 234 5678",
      "Kode Sandi: Contoh.2026.",
      "Agenda:\nPembahasan program kerja.",
      "Demikian disampaikan sebagai pengingat Bapak. Terima kasih, Pak.",
    ].join("\n\n"),
  );
  assert.deepEqual(errors(value), []);
  value.supplement.passcode = "  00 X.y!  ";
  assert.ok(
    generateMessage([value], leader, "2026-09-16").includes(
      "Kode Sandi:   00 X.y!  \n\n",
    ),
  );
});

test("dates and hours are calculated in the profile timezone", () => {
  assert.equal(formatDate("2026-09-16"), "Rabu, 16 September 2026");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(
    formatEventTime(event(), "Asia/Jayapura"),
    "Pukul 15.30–17.00 WIT",
  );
  assert.equal(
    formatEventTime(event(), "Asia/Makassar"),
    "Pukul 14.30–16.00 WITA",
  );
  assert.equal(zoneLabel("Europe/London"), "Europe/London");
});

test("all-day and overnight events retain real date ranges", () => {
  const allDay = event({
    allDay: true,
    start: "2026-09-15",
    end: "2026-09-18",
  });
  allDay.supplement.timeFormat = "all-day";
  assert.equal(
    formatEventTime(allDay, leader.timeZone),
    "Seharian (jam tidak dicantumkan di kalender), Selasa, 15 September 2026–Kamis, 17 September 2026",
  );
  assert.ok(
    validateEvents([allDay], leader, "2026-09-16").warnings.some(
      (issue) => issue.code === "W05",
    ),
  );
  assert.deepEqual(errors(allDay), []);
  const overnight = event({
    start: "2026-09-16T23:30:00+07:00",
    end: "2026-09-17T00:30:00+07:00",
  });
  assert.equal(
    formatEventTime(overnight, leader.timeZone),
    "Rabu, 16 September 2026 pukul 23.30–Kamis, 17 September 2026 pukul 00.30 WIB",
  );
  assert.deepEqual(errors(overnight, "2026-09-17"), []);
  assert.ok(
    errors(overnight, "2026-09-18").some((issue) => issue.code === "E08"),
  );
});

test("multiple events sort all-day first then by instant, title and id without mutating input", () => {
  const b = event({ id: "b", sourceTitle: "Rapat B" });
  const a = event({ id: "a", sourceTitle: "Rapat A" });
  const allDay = event({
    id: "all-day",
    allDay: true,
    start: "2026-09-16",
    end: "2026-09-17",
  });
  allDay.supplement.timeFormat = "all-day";
  const input = [b, allDay, a];
  assert.deepEqual(
    sortEvents(input).map((item) => item.id),
    ["all-day", "a", "b"],
  );
  assert.deepEqual(
    input.map((item) => item.id),
    ["b", "all-day", "a"],
  );
  const message = generateMessage(input, leader, "2026-09-16");
  assert.ok(message.includes("1. Menghadiri Rapat Koordinasi"));
  assert.ok(message.includes("2. Menghadiri Rapat A"));
  assert.ok(message.includes("3. Menghadiri Rapat B"));
  assert.equal(message.match(/Izin Bapak/g)?.length, 1);
  assert.equal(message.match(/Demikian disampaikan/g)?.length, 1);
});

test("parser supports case-insensitive multiline labels and flags duplicates without overwriting", () => {
  const parsed = parseDescription(
    "Informasi bebas\nAGENDA:\nPokok pertama\nPokok kedua\nID Rapat: 001 234 5678\nKode Sandi: Contoh.2026.\nKode Sandi: Berbeda\nBahan Rapat:\nDokumen [A].",
  );
  assert.equal(parsed.values.Agenda, "Pokok pertama\nPokok kedua");
  assert.equal(parsed.values["ID Rapat"], "001 234 5678");
  assert.equal(parsed.values["Kode Sandi"], "Contoh.2026.");
  assert.equal(parsed.conflicts.length, 1);
  assert.equal(parsed.values["Bahan Rapat"], "Dokumen [A].");
  assert.ok(parsed.plainText.includes("Informasi bebas"));
  assert.equal(
    parseDescription("Kode Sandi:  00 Abc.  ").values["Kode Sandi"],
    " 00 Abc.  ",
  );
  assert.equal(
    parseDescription("Agenda: Satu\nAgenda: Satu").conflicts.length,
    1,
  );
});

test("source HTML is plain text, script contents removed, and hazardous URLs rejected", () => {
  const source =
    '<script>alert("x")</script><p>Agenda: Diskusi &amp; evaluasi</p><p>Kode Sandi: Abc.01.</p>';
  const parsed = parseDescription(source);
  assert.equal(parsed.values.Agenda, "Diskusi & evaluasi");
  assert.equal(parsed.values["Kode Sandi"], "Abc.01.");
  const encodedCredentials = "<p>Kode Sandi: A&lt;b&gt;C &amp; 01.</p>";
  assert.equal(
    parseDescription(encodedCredentials).values["Kode Sandi"],
    "A<b>C & 01.",
  );
  assert.equal(
    emptySupplement({ description: encodedCredentials }).passcode,
    "A<b>C & 01.",
  );
  assert.ok(!parsed.plainText.includes("alert"));
  assert.equal(plainSourceText("<script>unfinished"), "");
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com\n",
  ])
    assert.equal(isSafeHttpsUrl(url), false);
  assert.equal(isSafeHttpsUrl("https://example.com/join?token=001.Abc"), true);
});

test("offline messages omit remote credentials and empty optional sections", () => {
  const value = event();
  value.supplement.mode = "offline";
  value.supplement.location = "Ruang Rapat Utama";
  const text = generateMessage([value], leader, "2026-09-16");
  assert.ok(text.includes("Pelaksanaan: Secara luring di Ruang Rapat Utama"));
  for (const label of [
    "ID Rapat:",
    "Kode Sandi:",
    "Tautan Rapat:",
    "Bahan Rapat:",
    "Keterangan:",
  ])
    assert.ok(!text.includes(label));
  value.supplement.mode = "hybrid";
  value.supplement.location = "";
  assert.ok(errors(value).some((issue) => issue.code === "E04"));
});

test("online routes require known access needs and either verified URL or usable ID", () => {
  const value = event();
  value.supplement.meetingId = "";
  value.supplement.passcode = "";
  value.supplement.meetingUrl = "https://meet.google.com/abc-defg-hij";
  value.supplement.accessCode = "not-required";
  assert.ok(errors(value).some((issue) => issue.code === "E05"));
  value.supplement.accessVerified = true;
  assert.deepEqual(errors(value), []);
  value.supplement.accessCode = "unknown";
  assert.ok(errors(value).some((issue) => issue.field === "accessCode"));
  value.supplement.accessCode = "required";
  assert.deepEqual(errors(value), []); // Operator verified the URL's built-in access.
  value.supplement.meetingUrl = "";
  value.supplement.meetingId = "001 234 5678";
  assert.ok(errors(value).some((issue) => issue.field === "passcode"));
});

test("attendance is independent of Google confirmed and affirmative titles require explicit neutrality", () => {
  const value = event();
  value.supplement.attendance = "undecided";
  value.supplement.role = "";
  assert.deepEqual(errors(value), []);
  const text = generateMessage([value], leader, "2026-09-16");
  assert.ok(text.includes("\n\nRapat Koordinasi\n\n"));
  assert.ok(text.includes("Kehadiran menunggu arahan Bapak."));
  value.supplement.title = "Menghadiri Rapat Koordinasi";
  assert.ok(errors(value).some((issue) => issue.code === "E06"));
  value.supplement.title = "Rapat Koordinasi";
  value.supplement.attendance = "represented";
  assert.ok(errors(value).some((issue) => issue.field === "representative"));
  value.supplement.representative = "Sekretaris";
  assert.deepEqual(errors(value), []);
  assert.ok(
    generateMessage([value], leader, "2026-09-16").includes(
      "Diwakilkan oleh Sekretaris.",
    ),
  );
  value.supplement.attendance = "attending";
  value.supplement.role = "Menghadiri";
  value.supplement.title = "Menghadiri Rapat Koordinasi";
  assert.ok(
    !generateMessage([value], leader, "2026-09-16").includes(
      "Menghadiri Menghadiri",
    ),
  );
});

test("time format, definite end and until-finished require appropriate source confirmation", () => {
  const value = event();
  value.supplement.timeFormat = "until-finished";
  assert.ok(errors(value).some((issue) => issue.field === "untilConfirmed"));
  value.supplement.untilConfirmed = true;
  assert.deepEqual(errors(value), []);
  assert.ok(
    validateEvents([value], leader, "2026-09-16").warnings.some(
      (issue) => issue.code === "W09",
    ),
  );
  value.end = value.start;
  assert.ok(errors(value).some((issue) => issue.code === "E07"));
  value.end = "2026-09-16T15:00:00+07:00";
  value.supplement.timeFormat = "all-day";
  assert.ok(errors(value).some((issue) => issue.code === "E07"));
});

test("overlap uses half-open intervals and ignores uncertain or all-day durations", () => {
  const first = event();
  const second = event({
    id: "second",
    start: "2026-09-16T14:00:00+07:00",
    end: "2026-09-16T16:00:00+07:00",
  });
  assert.equal(
    validateEvents([first, second], leader, "2026-09-16").warnings.filter(
      (issue) => issue.code === "W04",
    ).length,
    1,
  );
  second.start = first.end;
  assert.ok(
    !validateEvents([first, second], leader, "2026-09-16").warnings.some(
      (issue) => issue.code === "W04",
    ),
  );
  second.start = "2026-09-16T14:00:00+07:00";
  first.supplement.timeFormat = "until-finished";
  first.supplement.untilConfirmed = true;
  assert.ok(
    !validateEvents([first, second], leader, "2026-09-16").warnings.some(
      (issue) => issue.code === "W04",
    ),
  );
});

test("only selected data blocks validation, selection constraints and stable warnings are explicit", () => {
  const selected = event();
  const unselected = event({ id: "unselected" });
  unselected.supplement.agenda = "";
  assert.deepEqual(
    validateEvents([selected], leader, "2026-09-16", 2).errors,
    [],
  );
  assert.ok(
    validateEvents([selected], leader, "2026-09-16", 2).warnings.some(
      (issue) => issue.id === "W07:context:selection" && issue.acknowledgement,
    ),
  );
  assert.ok(
    validateEvents([], leader, "2026-09-16").errors.some(
      (issue) => issue.code === "E01",
    ),
  );
  assert.ok(
    validateEvents(
      [selected],
      { ...leader, timeZone: "Invalid/Zone" },
      "2026-09-16",
    ).errors.some((issue) => issue.code === "E01"),
  );
  selected.status = "cancelled";
  assert.equal(isSelectable(selected), false);
  selected.status = "confirmed";
  selected.supplement.attendance = "absent";
  assert.equal(isSelectable(selected), false);
});

test("source conflicts block until reconciliation is saved against the current version", () => {
  const value = event({ description: "Kode Sandi: Satu\nKode Sandi: Dua" });
  value.supplement.sourceReviewed = false;
  assert.ok(errors(value).some((issue) => issue.code === "E08"));
  value.supplement.sourceReviewed = true;
  assert.deepEqual(errors(value), []);
  value.sourceVersion = "v2";
  assert.ok(errors(value).some((issue) => issue.code === "E08"));
  value.reviewedSourceVersion = "v2";
  assert.deepEqual(errors(value), []);
});

test("materials omission does not invent promises and attachment wording requires acknowledgement", () => {
  const value = event();
  value.supplement.materialsStatus = "unavailable";
  value.supplement.includeMaterials = false;
  assert.ok(
    !generateMessage([value], leader, "2026-09-16").includes("Bahan Rapat:"),
  );
  assert.ok(
    !generateMessage([value], leader, "2026-09-16").includes("kemudian"),
  );
  assert.equal(
    validateEvents([value], leader, "2026-09-16").warnings.find(
      (issue) => issue.code === "W02",
    )?.acknowledgement,
    "Bahan tidak perlu dicantumkan",
  );
  value.supplement.includeMaterials = true;
  value.supplement.materials = "Bahan terlampir dalam undangan.";
  value.supplement.materialLinks = [
    { title: "Dokumen", url: "https://example.com/document" },
  ];
  const codes = validateEvents([value], leader, "2026-09-16").warnings.map(
    (issue) => issue.code,
  );
  assert.ok(codes.includes("W08"));
  assert.ok(codes.includes("W10"));
});

test("strict input and length limits reject malformed data without truncating", () => {
  const value = event();
  value.supplement.passcode = "x".repeat(257);
  assert.ok(errors(value).some((issue) => issue.field === "passcode"));
  assert.equal(value.supplement.passcode.length, 257);
  assert.ok(
    validateSupplement({ ...emptySupplement(), passcode: 123 }).some(
      (issue) => issue.field === "passcode",
    ),
  );
  assert.ok(
    validateSupplement({ ...emptySupplement(), unexpected: "value" }).some(
      (issue) => issue.field === "unexpected",
    ),
  );
  assert.ok(
    validateSupplement({
      ...emptySupplement(),
      materialLinks: [{ title: "Bad", url: "javascript:alert(1)" }],
    }).some((issue) => issue.field === "materialLinks.0.url"),
  );
  const many = Array.from({ length: 21 }, (_, index) =>
    event({ id: `event-${index}` }),
  );
  assert.ok(
    validateEvents(many, leader, "2026-09-16").errors.some(
      (issue) => issue.field === "selection",
    ),
  );
  const long = Array.from({ length: 8 }, (_, index) => {
    const item = event({ id: `long-${index}` });
    item.supplement.agenda = "A".repeat(6000);
    return item;
  });
  assert.ok(
    validateEvents(long, leader, "2026-09-16").errors.some(
      (issue) => issue.field === "message",
    ),
  );
});

test("brackets and template-like text that belong to source data remain unchanged", () => {
  const value = event();
  value.supplement.agenda = "Tinjauan {Rencana} dan [Lampiran A].";
  assert.deepEqual(errors(value), []);
  assert.ok(
    generateMessage([value], leader, "2026-09-16").includes(
      "Tinjauan {Rencana} dan [Lampiran A].",
    ),
  );
  value.supplement.meetingId = "[ID rapat sesuai sumber]";
  assert.ok(
    errors(value).some(
      (issue) => issue.code === "E09" && issue.field === "meetingId",
    ),
  );
  value.supplement.meetingId = "001 234 5678";
  value.supplement.passcode = "[kode sandi persis sumber]";
  assert.ok(
    errors(value).some(
      (issue) => issue.code === "E09" && issue.field === "passcode",
    ),
  );
});

test("Teams invitation aliases fill only explicit access facts and keep credentials exact", () => {
  const description = [
    "Microsoft Teams",
    "Need help?",
    "Join the meeting now",
    "https://teams.microsoft.com/meet/1234567890123?p=Test.00%2BToken)&context=Demo]",
    "Meeting ID:",
    "001 234 567 890",
    "Passcode:",
    "  AbC.01!  ",
    "",
    "For organizers:",
    "Meeting options",
    "Do not forward this invitation.",
  ].join("\n");
  const parsed = parseDescription(description);
  assert.equal(parsed.values["ID Rapat"], "001 234 567 890");
  assert.equal(parsed.values["Kode Sandi"], "  AbC.01!  ");
  const supplement = emptySupplement({
    sourceTitle: "Rapat program kerja",
    description,
  });
  assert.equal(supplement.meetingId, "001 234 567 890");
  assert.equal(supplement.passcode, "  AbC.01!  ");
  assert.equal(
    supplement.meetingUrl,
    "https://teams.microsoft.com/meet/1234567890123?p=Test.00%2BToken)&context=Demo]",
  );
  assert.equal(supplement.platform, "Microsoft Teams");
  assert.equal(supplement.mode, "online");
  assert.equal(supplement.attendance, "undecided");
  assert.equal(supplement.agenda, "");
  assert.equal(supplement.accessCode, "unknown");
  assert.equal(supplement.accessVerified, false);
  assert.equal(supplement.sourceReviewed, false);
});

test("English access aliases consume a single value line and do not capture unknown headers or footers", () => {
  const parsed = parseDescription(
    "Meeting ID:  001 22  \nUnknown field: retained in source\npAsScOdE:\n\n A:1. \n\nUnknown footer: remain outside code\nFree text",
  );
  assert.equal(parsed.values["ID Rapat"], " 001 22  ");
  assert.equal(parsed.values["Kode Sandi"], " A:1. ");
  assert.ok(parsed.plainText.includes("Unknown footer: remain outside code"));
  assert.equal(parseDescription("Password: A:1").values["Kode Sandi"], "A:1");
  assert.equal(
    parseDescription("Passcode:\nShortlink: https://example.com").values[
      "Kode Sandi"
    ],
    "",
  );
  assert.equal(
    parseDescription("Passcode:\nNeed help?\nOther text").values["Kode Sandi"],
    "",
  );
  assert.equal(
    parseDescription("Passcode:\nMeeting ID: 001").values["Kode Sandi"],
    "",
  );
  assert.equal(parseDescription("Password:\nA:1").values["Kode Sandi"], "A:1");
});

test("canonical Indonesian multiline parsing remains compatible alongside scalar aliases", () => {
  const parsed = parseDescription(
    "Agenda:\nBaris pertama.\nBaris kedua.\nKeterangan:\nBaris keterangan.\nLanjutan.\nMeeting ID: 001 002\nPassword: Kode.\nFooter",
  );
  assert.equal(parsed.values.Agenda, "Baris pertama.\nBaris kedua.");
  assert.equal(parsed.values.Keterangan, "Baris keterangan.\nLanjutan.");
  assert.equal(parsed.values["ID Rapat"], "001 002");
  assert.equal(parsed.values["Kode Sandi"], "Kode.");
  assert.equal(
    parseDescription("Kode Sandi:\nA\nB").values["Kode Sandi"],
    "A\nB",
  );
});

test("HTML anchor targets provide join URLs, are decoded once, and dedupe against visible text", () => {
  const primary =
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_TEST%40thread.v2/0?context=%7B%22Tid%22%3A%22demo%22%7D&p=Test.)]&x=%2B";
  const description = `<p>Microsoft Teams</p><a href="${primary.replace(/&/g, "&amp;")}">Join the meeting now</a><p>${primary.replace(/&/g, "&amp;")}</p><p>Meeting ID: 001 234</p><p>Passcode: A&lt;b&gt;C &amp; 01.</p>`;
  const access = extractMeetingAccess(description);
  assert.equal(
    access.candidates.filter((item) => item.field === "meetingUrl").length,
    1,
  );
  assert.equal(
    access.candidates.find((item) => item.field === "meetingUrl")?.value,
    primary,
  );
  assert.equal(
    access.candidates.find((item) => item.field === "passcode")?.value,
    "A<b>C & 01.",
  );
  assert.deepEqual(access.platforms, ["Microsoft Teams"]);
  assert.deepEqual(access.conflicts, []);
  assert.equal(emptySupplement({ description }).passcode, "A<b>C & 01.");
});

test("query credentials retain raw and encoded punctuation exactly for Teams and Zoom", () => {
  for (const url of [
    "https://teams.microsoft.com/meet/123456789?p=Code)",
    "https://teams.microsoft.com/meet/123456789?p=Code]",
    "https://teams.microsoft.com/meet/123456789?p=Code%29%5D&c=Keep.",
    "https://us02web.zoom.us/j/123456789?pwd=AbC.)]%2B&omn=001",
  ]) {
    assert.equal(extractMeetingAccess(url).candidates[0]?.value, url);
    assert.equal(
      extractMeetingAccess(`<a href='${url.replace(/&/g, "&amp;")}'>Join</a>`)
        .candidates[0]?.value,
      url,
    );
  }
});

test("shortlinks, Teams help/options, unsafe URLs and spoofed hosts are never used as join URLs", () => {
  const primary = "https://teams.microsoft.com/meet/123456789?p=Demo";
  const description = `<a href="https://aka.ms/JoinTeamsMeeting">Need help?</a><a href="https://tinyurl.com/example">Shortlink</a><a href="${primary}">Join meeting now</a><a href="https://teams.microsoft.com/meetingOptions/?id=demo">Meeting options</a>`;
  assert.deepEqual(
    extractMeetingAccess(description).candidates.map((item) => item.value),
    [primary],
  );
  for (const url of [
    "javascript:alert(1)",
    "http://teams.microsoft.com/meet/123",
    "https://teams.microsoft.com.evil.example/meet/123",
    "https://zoom.us.evil.example/j/123",
    "https://teams.microsoft.com/v2/",
    "https://teams.microsoft.com/meet/options",
    "https://zoom.us/signin",
    "https://meet.google.com/new",
    "https://aka.ms/JoinTeamsMeeting",
  ])
    assert.equal(conferencePlatform(url), "");
  assert.equal(
    conferencePlatform("https://teams.live.com/meet/123456789?p=Demo"),
    "Microsoft Teams",
  );
  assert.equal(
    conferencePlatform("https://zoom.us/j/123456789?pwd=AbC.01"),
    "Zoom Meeting",
  );
  assert.equal(
    conferencePlatform("https://us04web.zoom.us/my/example"),
    "Zoom Meeting",
  );
  assert.equal(
    conferencePlatform("https://meet.google.com/abc-defg-hij"),
    "Google Meet",
  );
});

test("multiple providers and repeated access labels remain explicit candidates and block source review", () => {
  const description =
    "https://teams.microsoft.com/meet/123456789?p=Demo\nhttps://meet.google.com/abc-defg-hij\nMeeting ID: 001\nID Rapat: 002\nPasscode: First.\nPassword: Second.";
  const access = extractMeetingAccess(description);
  assert.equal(access.candidates.length, 6);
  assert.deepEqual(access.platforms, ["Microsoft Teams", "Google Meet"]);
  assert.ok(access.conflicts.length >= 4);
  const supplement = emptySupplement({ description });
  assert.equal(supplement.meetingUrl, "");
  assert.equal(supplement.meetingId, "");
  assert.equal(supplement.passcode, "");
  assert.equal(supplement.platform, "");
  assert.equal(supplement.mode, "");
  const value = event({ description });
  value.supplement.sourceReviewed = false;
  assert.ok(
    errors(value).some(
      (issue) => issue.code === "E08" && issue.field === "sourceReviewed",
    ),
  );
});

test("inferred online mode respects physical location, explicit execution, and unrelated title wording", () => {
  const url = "https://teams.microsoft.com/meet/123456789?p=Demo";
  assert.equal(
    emptySupplement({ description: url, sourceLocation: "Ruang Rapat A" }).mode,
    "",
  );
  assert.equal(
    emptySupplement({ description: `Pelaksanaan: Luring\n${url}` }).mode,
    "offline",
  );
  assert.equal(
    emptySupplement({
      description: `Pelaksanaan: Hibrida\n${url}`,
      sourceLocation: "Ruang Rapat A",
    }).mode,
    "hybrid",
  );
  assert.equal(
    emptySupplement({ description: `Pelaksanaan: Menunggu keputusan\n${url}` })
      .mode,
    "",
  );
  assert.equal(
    emptySupplement({ sourceTitle: "Pembahasan Microsoft Teams dan Zoom" })
      .platform,
    "",
  );
  assert.equal(
    emptySupplement({ sourceTitle: "Pembahasan Microsoft Teams dan Zoom" })
      .mode,
    "",
  );
  assert.ok(
    extractMeetingAccess(
      `Pelaksanaan: Secara daring melalui Zoom Meeting\n${url}`,
    ).conflicts.some((message) => message.includes("platform")),
  );
});

test("hidden HTML links are ignored while real meeting links are extracted safely", () => {
  const hidden = "https://teams.microsoft.com/meet/111111111?p=Hidden";
  const visible = "https://meet.google.com/abc-defg-hij";
  const description = `<!-- <a href="${hidden}">Hidden</a> --><script><a href="${hidden}">Hidden</a></script><a href="${visible}">Join</a><p>Passcode: Demo.01</p>`;
  assert.deepEqual(
    extractMeetingAccess(description)
      .candidates.filter((item) => item.field === "meetingUrl")
      .map((item) => item.value),
    [visible],
  );
  assert.ok(!plainSourceText(description).includes("Hidden"));
  const attributes = `<a data-href="${hidden}" title=" href='${hidden}'" href="${visible}">Join</a>`;
  assert.deepEqual(
    extractMeetingAccess(attributes).candidates.map((item) => item.value),
    [visible],
  );
});
