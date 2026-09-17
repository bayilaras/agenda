import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Draft, SessionInfo, Snapshot } from "../shared/types.ts";
import { createApplication } from "../server/app.ts";
import { hashPassword } from "../server/config.ts";
import type { ConfigLeader } from "../server/config.ts";
import { GoogleCalendar, HttpError, mapGoogleEvent } from "../server/google.ts";
import { emptySupplement } from "../shared/domain.ts";

const leader: ConfigLeader = {
  id: "allowed",
  name: "Pimpinan Uji",
  position: "Kepala",
  salutation: "Bapak",
  closing: "Pak",
  timeZone: "Asia/Jakarta",
  calendarName: "Kalender Uji",
  calendarId: "allowed@example.test",
  revision: 1,
};
const second: ConfigLeader = {
  ...leader,
  id: "forbidden",
  calendarId: "forbidden@example.test",
};
const passwordHash = hashPassword("synthetic-secret-123");

async function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "agenda-api-"));
  let now = Date.parse("2026-09-17T02:00:00Z");
  const service = createApplication({
    dataDir,
    encryptionKey: randomBytes(32),
    production: false,
    demoEnabled: true,
    leaders: [leader, second],
    users: [
      {
        id: "operator-a",
        name: "Operator A",
        email: "operator@example.test",
        role: "operator",
        leaderIds: ["allowed"],
        passwordHash,
      },
      {
        id: "operator-b",
        name: "Operator B",
        email: "second@example.test",
        role: "operator",
        leaderIds: ["allowed"],
        passwordHash,
      },
      {
        id: "admin-a",
        name: "Admin A",
        email: "admin@example.test",
        role: "admin",
        leaderIds: [],
        passwordHash,
      },
    ],
    now: () => now,
  });
  const server = service.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let cookie = "",
    csrf = "";
  async function request(
    path: string,
    method = "GET",
    data?: unknown,
    sendCsrf = true,
  ) {
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: "manual",
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(sendCsrf && csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    const newCookie = response.headers.get("set-cookie");
    if (newCookie) cookie = newCookie.split(";")[0];
    const body = (await response.json()) as Record<string, any>;
    if (typeof body.csrfToken === "string") csrf = body.csrfToken;
    return { status: response.status, body, headers: response.headers };
  }
  async function loginDemo() {
    await request("/api/session");
    return request("/api/auth/demo", "POST", {});
  }
  async function snapshot() {
    const response = await request("/api/agenda/refresh", "POST", {
      leaderId: "kepala-kantor",
      date: "2026-09-17",
    });
    assert.equal(response.status, 200);
    return response.body as Snapshot;
  }
  async function prepare(snap: Snapshot, eventIds = [snap.events[0].id]) {
    return request("/api/messages/prepare", "POST", {
      leaderId: snap.leaderId,
      date: snap.date,
      eventIds,
      snapshotHash: snap.hash,
      revisions: Object.fromEntries(
        snap.events.map((event) => [event.id, event.revision]),
      ),
    });
  }
  return {
    ...service,
    dataDir,
    request,
    loginDemo,
    snapshot,
    prepare,
    advance: (ms: number) => {
      now += ms;
    },
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      service.store.close();
      assert.ok(
        dataDir.startsWith(join(tmpdir(), "agenda-api-")) &&
          dataDir.length > join(tmpdir(), "agenda-api-").length,
      );
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test("authentication, CSRF rotation, object ACL and administrator privileges are enforced", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("/api/leaders")).status, 401);
    const initial = await f.request("/api/session");
    assert.equal((initial.body as SessionInfo).user, null);
    assert.match(initial.headers.get("cache-control")!, /no-store/);
    assert.equal(
      (await f.request("/api/auth/demo", "POST", {}, false)).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/auth/login", "POST", {
          email: "operator@example.test",
          password: "wrong",
        })
      ).status,
      401,
    );
    const loggedIn = await f.request("/api/auth/login", "POST", {
      email: "operator@example.test",
      password: "synthetic-secret-123",
    });
    assert.equal(loggedIn.status, 200);
    assert.notEqual(loggedIn.body.csrfToken, initial.body.csrfToken);
    assert.match(loggedIn.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(loggedIn.headers.get("set-cookie")!, /SameSite=Lax/);
    assert.deepEqual(
      (await f.request("/api/leaders")).body.leaders.map(
        (item: ConfigLeader) => item.id,
      ),
      ["allowed"],
    );
    assert.equal(
      (await f.request("/api/agenda?leaderId=forbidden&date=2026-09-17"))
        .status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/agenda/refresh", "POST", {
          leaderId: "forbidden",
          date: "2026-09-17",
        })
      ).status,
      403,
    );
    assert.equal((await f.request("/api/google/connect")).status, 403);
    assert.equal(
      (await f.request("/api/google/disconnect", "POST", {})).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/agenda/refresh", "POST", {
          leaderId: "allowed",
          date: "2026-09-17",
        })
      ).status,
      503,
    );
    await f.request("/api/auth/logout", "POST", {});
    assert.equal((await f.request("/api/leaders")).status, 401);
    await f.request("/api/auth/login", "POST", {
      email: "admin@example.test",
      password: "synthetic-secret-123",
    });
    assert.deepEqual((await f.request("/api/leaders")).body.leaders, []);
    assert.equal(
      (await f.request("/api/agenda?leaderId=allowed&date=2026-09-17")).status,
      403,
    );
  } finally {
    await f.close();
  }
});

test("demo workflow prepares canonical text, requires warning review, preserves exact credentials and audits metadata only", async () => {
  const f = await fixture();
  try {
    const session = await f.loginDemo();
    assert.equal(session.body.demo, true);
    const snapshot = await f.snapshot();
    assert.equal(snapshot.events.length, 5);
    assert.equal(snapshot.complete, true);
    const prepared = await f.prepare(snapshot, [
      snapshot.events[2].id,
      snapshot.events[0].id,
    ]);
    assert.equal(prepared.status, 200);
    const draft = prepared.body as Draft;
    assert.deepEqual(draft.errors, []);
    assert.match(draft.plainText, /ID Rapat: 001 234 5678/);
    assert.match(draft.plainText, /Kode Sandi: Contoh\.2026\./);
    assert.ok(
      draft.plainText.indexOf("1. Memimpin") <
        draft.plainText.indexOf("2. Menghadiri"),
    );
    assert.equal(
      (
        await f.request(`/api/messages/${draft.draftId}/copy-result`, "POST", {
          outcome: "success",
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await f.request(`/api/messages/${draft.draftId}/review`, "POST", {
          contentHash: draft.contentHash,
          confirmed: true,
          acknowledgedWarnings: [],
        })
      ).status,
      422,
    );
    const reviewed = await f.request(
      `/api/messages/${draft.draftId}/review`,
      "POST",
      {
        contentHash: draft.contentHash,
        confirmed: true,
        acknowledgedWarnings: draft.warnings.map((item) => item.id),
      },
    );
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.readyToCopy, true);
    assert.equal(
      (
        await f.request(`/api/messages/${draft.draftId}/copy-result`, "POST", {
          outcome: "failed",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await f.request(`/api/messages/${draft.draftId}/copy-result`, "POST", {
          outcome: "manual",
        })
      ).status,
      200,
    );
    const audits = f.store.db.prepare("SELECT * FROM audit_logs").all();
    assert.equal(JSON.stringify(audits).includes("Contoh.2026."), false);
    assert.equal(
      JSON.stringify(
        f.store.db.prepare("SELECT payload FROM records").all(),
      ).includes("Contoh.2026."),
      false,
    );
    assert.equal(
      readFileSync(join(f.dataDir, "agenda.sqlite-wal")).includes(
        Buffer.from("Contoh.2026."),
      ),
      false,
    );
  } finally {
    await f.close();
  }
});

test("saving uses optimistic revisions and survives refresh, invalidating previously reviewed drafts", async () => {
  const f = await fixture();
  try {
    await f.loginDemo();
    const snapshot = await f.snapshot(),
      event = snapshot.events[0];
    const draft = (await f.prepare(snapshot)).body as Draft;
    await f.request(`/api/messages/${draft.draftId}/review`, "POST", {
      contentHash: draft.contentHash,
      confirmed: true,
      acknowledgedWarnings: draft.warnings.map((item) => item.id),
    });
    const supplement = {
      ...event.supplement,
      agenda: "Agenda manual yang telah diperiksa.",
    };
    const body = {
      leaderId: snapshot.leaderId,
      date: snapshot.date,
      expectedRevision: event.revision,
      supplement,
    };
    const saved = await f.request(
      `/api/agenda/${event.id}/supplement`,
      "PATCH",
      body,
    );
    assert.equal(saved.status, 200);
    assert.equal(saved.body.revision, 1);
    const conflict = await f.request(
      `/api/agenda/${event.id}/supplement`,
      "PATCH",
      body,
    );
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.latest.revision, 1);
    const fresh = await f.snapshot();
    assert.equal(fresh.events[0].supplement.agenda, supplement.agenda);
    assert.equal(fresh.events[0].revision, 1);
    assert.equal((await f.prepare(snapshot)).status, 409);
    assert.equal(
      (
        await f.request(`/api/messages/${draft.draftId}/review`, "POST", {
          contentHash: draft.contentHash,
          confirmed: true,
          acknowledgedWarnings: draft.warnings.map((item) => item.id),
        })
      ).status,
      409,
    );
    const invalid = await f.request(
      `/api/agenda/${event.id}/supplement`,
      "PATCH",
      {
        ...body,
        expectedRevision: 1,
        supplement: { ...supplement, meetingUrl: "javascript:alert(1)" },
      },
    );
    assert.equal(invalid.status, 422);
    assert.equal((await f.snapshot()).events[0].revision, 1);
  } finally {
    await f.close();
  }
});

test("incomplete and private events cannot be copied; freshness, selection and hash bounds are enforced", async () => {
  const f = await fixture();
  try {
    await f.loginDemo();
    const snapshot = await f.snapshot();
    const incomplete = (await f.prepare(snapshot, [snapshot.events[1].id]))
      .body as Draft;
    assert.ok(incomplete.errors.length > 0);
    assert.equal(
      (
        await f.request(`/api/messages/${incomplete.draftId}/review`, "POST", {
          contentHash: incomplete.contentHash,
          confirmed: true,
          acknowledgedWarnings: incomplete.warnings.map((item) => item.id),
        })
      ).status,
      422,
    );
    const privateDraft = (await f.prepare(snapshot, [snapshot.events[4].id]))
      .body as Draft;
    assert.ok(privateDraft.errors.some((error) => error.code === "E02"));
    assert.equal(
      (
        await f.request(
          `/api/agenda/${snapshot.events[4].id}/supplement`,
          "PATCH",
          {
            leaderId: snapshot.leaderId,
            date: snapshot.date,
            expectedRevision: 0,
            supplement: emptySupplement(),
          },
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.prepare({ ...snapshot, hash: "outdated" })).status,
      409,
    );
    assert.equal((await f.prepare(snapshot, [])).status, 422);
    const draft = (await f.prepare(snapshot)).body as Draft;
    f.advance(120_001);
    const expired = await f.request(
      `/api/messages/${draft.draftId}/review`,
      "POST",
      {
        contentHash: draft.contentHash,
        confirmed: true,
        acknowledgedWarnings: draft.warnings.map((item) => item.id),
      },
    );
    assert.equal(expired.status, 409);
    assert.equal(expired.body.code, "DRAFT_EXPIRED");
    const weekend = await f.request("/api/agenda/refresh", "POST", {
      leaderId: snapshot.leaderId,
      date: "2026-09-19",
    });
    assert.equal(weekend.status, 200);
    assert.deepEqual(weekend.body.events, []);
  } finally {
    await f.close();
  }
});

test("Google mapping preserves occurrence identity, raw credential values and source freshness", () => {
  const source = {
    id: "instance-moved",
    recurringEventId: "series-a",
    originalStartTime: { dateTime: "2026-09-17T10:00:00+07:00" },
    summary: "Agenda",
    description: "Kode Sandi: A&lt;b&gt;C\nID Rapat: 001 234",
    start: { dateTime: "2026-09-17T13:00:00+07:00" },
    end: { dateTime: "2026-09-17T14:00:00+07:00" },
  };
  const first = mapGoogleEvent(source, leader);
  assert.equal(first.supplement.passcode, "A<b>C");
  assert.equal(first.supplement.meetingId, "001 234");
  assert.equal(
    first.id,
    mapGoogleEvent(
      {
        ...source,
        id: "changed-id",
        start: { dateTime: "2026-09-18T10:00:00+07:00" },
      },
      leader,
    ).id,
  );
  assert.equal(
    first.id,
    mapGoogleEvent(
      { ...source, originalStartTime: { dateTime: "2026-09-17T03:00:00Z" } },
      leader,
    ).id,
  );
  assert.notEqual(
    first.sourceVersion,
    mapGoogleEvent({ ...source, endTimeUnspecified: true }, leader)
      .sourceVersion,
  );
  assert.notEqual(
    first.sourceVersion,
    mapGoogleEvent(
      { ...source, hangoutLink: "https://meet.google.com/abc-defg-hij" },
      leader,
    ).sourceVersion,
  );
  assert.equal(
    mapGoogleEvent({ ...source, visibility: "private" }, leader, "reader")
      .readable,
    false,
  );
});

test("Google completes every page, filters non-agenda types and rejects partial results", async () => {
  const f = await fixture();
  try {
    f.config.googleClientId = "test-id";
    f.config.googleClientSecret = "test-secret";
    f.store.set("google", "tokens", {
      access_token: "synthetic-token",
      refresh_token: "synthetic-refresh",
      expiresAt: f.config.now() + 3600_000,
      scope: "",
    });
    const calls: string[] = [];
    const sample = {
      id: "a",
      summary: "Agenda",
      eventType: "default",
      start: { dateTime: "2026-09-17T10:00:00+07:00" },
      end: { dateTime: "2026-09-17T11:00:00+07:00" },
    };
    const fetcher = (async (url: string | URL | Request) => {
      const address = String(url);
      calls.push(address);
      return Response.json(
        address.includes("pageToken=second")
          ? { items: [{ ...sample, id: "b" }], accessRole: "reader" }
          : {
              items: [
                sample,
                { ...sample, id: "focus", eventType: "focusTime" },
              ],
              nextPageToken: "second",
              accessRole: "reader",
            },
      );
    }) as typeof fetch;
    const google = new GoogleCalendar(f.config, f.store, fetcher);
    const result = await google.events(leader, "2026-09-17");
    assert.equal(result.events.length, 2);
    assert.equal(result.excludedCount, 1);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /allowed%40example\.test/);
    assert.match(calls[0], /timeMin=2026-09-17T00%3A00%3A00/);
    assert.match(calls[1], /pageToken=second/);
    const broken = new GoogleCalendar(f.config, f.store, (async (
      url: string | URL | Request,
    ) =>
      String(url).includes("pageToken=second")
        ? Response.json({}, { status: 403 })
        : Response.json({
            items: [sample],
            nextPageToken: "second",
          })) as typeof fetch);
    await assert.rejects(broken.events(leader, "2026-09-17"), /belum berhasil/);
  } finally {
    await f.close();
  }
});

test("server mapping retains Teams description values and exposes conflicting native Meet sources", () => {
  const teamsUrl =
    "https://teams.microsoft.com/meet/123456789?p=synthetic%2Bpass";
  const meetUrl = "https://meet.google.com/abc-defg-hij";
  const source = {
    id: "conflicting-meeting-sources",
    summary: "Rapat sintetis",
    description: `<p>Microsoft Teams</p><p><a href="${teamsUrl}">Join the meeting now</a></p><p>Meeting ID: 001 234 567</p><p>Passcode: 00.X!?</p>`,
    start: { dateTime: "2026-09-17T10:00:00+07:00" },
    end: { dateTime: "2026-09-17T11:00:00+07:00" },
    conferenceData: {
      conferenceSolution: { name: "Google Meet" },
      entryPoints: [
        { entryPointType: "video", uri: meetUrl, meetingCode: "abc-defg-hij" },
      ],
    },
    hangoutLink: meetUrl,
  };
  const mapped = mapGoogleEvent(source, leader, "owner");
  assert.equal(mapped.supplement.meetingUrl, teamsUrl);
  assert.equal(mapped.supplement.platform, "Microsoft Teams");
  assert.equal(mapped.supplement.meetingId, "001 234 567");
  assert.equal(mapped.supplement.passcode, "00.X!?");
  assert.deepEqual(
    new Set(
      mapped.sourceCandidates
        ?.filter((item) => item.field === "meetingUrl")
        .map((item) => item.value),
    ),
    new Set([teamsUrl, meetUrl]),
  );
  assert.equal(
    mapped.sourceCandidates?.filter(
      (item) => item.field === "meetingUrl" && item.value === meetUrl,
    ).length,
    1,
  );
  assert.ok(mapped.conflicts.some((conflict) => conflict.includes("tautan")));
  assert.ok(mapped.conflicts.some((conflict) => conflict.includes("platform")));
  const redacted = mapGoogleEvent(
    { ...source, visibility: "private" },
    leader,
    "reader",
  );
  assert.equal(redacted.sourceCandidates, undefined);
  assert.equal(redacted.supplement.meetingUrl, "");
  assert.equal(redacted.supplement.meetingId, "");
  assert.equal(redacted.supplement.passcode, "");
});

test("server mapping deduplicates matching description and hangout meeting links", () => {
  const meetUrl = "https://meet.google.com/abc-defg-hij";
  const value = mapGoogleEvent(
    {
      id: "matching-meeting-sources",
      description: `<a href="${meetUrl}">Join Google Meet</a>`,
      hangoutLink: meetUrl,
    },
    leader,
    "owner",
  );
  assert.equal(value.supplement.meetingUrl, meetUrl);
  assert.equal(value.supplement.platform, "Google Meet");
  assert.equal(
    value.sourceCandidates?.filter((item) => item.field === "meetingUrl")
      .length,
    1,
  );
  assert.deepEqual(value.conflicts, []);
});

test("refreshing conflicting meeting sources preserves saved manual access and requests a new review", async () => {
  const f = await fixture();
  try {
    f.config.googleClientId = "test-id";
    f.config.googleClientSecret = "test-secret";
    f.store.set("google", "tokens", {
      access_token: "synthetic-token",
      refresh_token: "synthetic-refresh",
      expiresAt: f.config.now() + 3600_000,
      scope: "",
    });
    const teamsUrl = "https://teams.microsoft.com/meet/123456789?p=synthetic";
    const source = {
      id: "manual-meeting-access",
      summary: "Rapat sintetis",
      description: teamsUrl,
      start: { dateTime: "2026-09-17T10:00:00+07:00" },
      end: { dateTime: "2026-09-17T11:00:00+07:00" },
      hangoutLink: "https://meet.google.com/abc-defg-hij",
    };
    let mapped = mapGoogleEvent(source, leader, "owner");
    f.google.events = async () => ({ events: [mapped], excludedCount: 0 });
    await f.request("/api/session");
    await f.request("/api/auth/login", "POST", {
      email: "operator@example.test",
      password: "synthetic-secret-123",
    });
    const refresh = async () => {
      const response = await f.request("/api/agenda/refresh", "POST", {
        leaderId: leader.id,
        date: "2026-09-17",
      });
      assert.equal(response.status, 200);
      return response.body as Snapshot;
    };
    await refresh();
    const manual = {
      ...mapped.supplement,
      meetingUrl: "https://teams.microsoft.com/meet/987654321?p=manual",
      meetingId: "009 876 543",
      passcode: " 00.Manual! ",
      sourceReviewed: true,
    };
    const saved = await f.request(
      `/api/agenda/${mapped.id}/supplement`,
      "PATCH",
      {
        leaderId: leader.id,
        date: "2026-09-17",
        expectedRevision: 0,
        supplement: manual,
      },
    );
    assert.equal(saved.status, 200);
    mapped = mapGoogleEvent(
      { ...source, hangoutLink: "https://meet.google.com/xyz-abcd-efg" },
      leader,
      "owner",
    );
    const refreshed = (await refresh()).events[0];
    assert.equal(refreshed.supplement.meetingUrl, manual.meetingUrl);
    assert.equal(refreshed.supplement.meetingId, manual.meetingId);
    assert.equal(refreshed.supplement.passcode, manual.passcode);
    assert.equal(refreshed.supplement.sourceReviewed, false);
    assert.ok(
      refreshed.sourceCandidates?.some((item) => item.value === teamsUrl),
    );
    assert.ok(
      refreshed.sourceCandidates?.some(
        (item) => item.value === "https://meet.google.com/xyz-abcd-efg",
      ),
    );
  } finally {
    await f.close();
  }
});

test("live source changes require reconciliation; failed fetches retain supplements; revoked access hides cached data", async () => {
  const f = await fixture();
  try {
    f.config.googleClientId = "test-id";
    f.config.googleClientSecret = "test-secret";
    f.store.set("google", "tokens", {
      access_token: "synthetic-token",
      refresh_token: "synthetic-refresh",
      expiresAt: f.config.now() + 3600_000,
      scope: "",
    });
    let source = mapGoogleEvent(
      {
        id: "actual-instance",
        summary: "Rapat",
        description: "Pelaksanaan: Luring\nAgenda: Agenda awal",
        location: "Ruang rapat",
        start: { dateTime: "2026-09-17T10:00:00+07:00" },
        end: { dateTime: "2026-09-17T11:00:00+07:00" },
      },
      leader,
    );
    f.google.events = async () => ({ events: [source], excludedCount: 0 });
    await f.request("/api/session");
    await f.request("/api/auth/login", "POST", {
      email: "operator@example.test",
      password: "synthetic-secret-123",
    });
    const getSnapshot = async () =>
      (
        await f.request("/api/agenda/refresh", "POST", {
          leaderId: leader.id,
          date: "2026-09-17",
        })
      ).body as Snapshot;
    const snapshot = await getSnapshot();
    const supplement = {
      ...source.supplement,
      attendance: "attending",
      materialsStatus: "unnecessary",
      sourceReviewed: true,
    };
    assert.equal(
      (
        await f.request(`/api/agenda/${source.id}/supplement`, "PATCH", {
          leaderId: leader.id,
          date: snapshot.date,
          expectedRevision: 0,
          supplement,
        })
      ).status,
      200,
    );
    const saved = await getSnapshot(),
      prepared = await f.prepare(saved),
      draft = prepared.body as Draft;
    assert.equal(prepared.status, 200);
    assert.deepEqual(draft.errors, []);
    source = {
      ...source,
      sourceVersion: "changed-source",
      start: "2026-09-17T10:30:00+07:00",
    };
    const changed = await f.prepare(saved);
    assert.equal(changed.status, 409);
    assert.equal(
      changed.body.snapshot.events[0].supplement.agenda,
      "Agenda awal",
    );
    const newSnapshot = changed.body.snapshot as Snapshot;
    const unreviewed = (await f.prepare(newSnapshot)).body as Draft;
    assert.ok(unreviewed.errors.some((error) => error.code === "E08"));
    await f.request(`/api/agenda/${source.id}/supplement`, "PATCH", {
      leaderId: leader.id,
      date: snapshot.date,
      expectedRevision: 1,
      supplement,
    });
    const reconciled = await getSnapshot(),
      newDraft = (await f.prepare(reconciled)).body as Draft;
    assert.deepEqual(newDraft.errors, []);
    await f.request("/api/auth/logout", "POST", {});
    await f.request("/api/auth/login", "POST", {
      email: "second@example.test",
      password: "synthetic-secret-123",
    });
    assert.equal(
      (
        await f.request(`/api/messages/${newDraft.draftId}/review`, "POST", {
          contentHash: newDraft.contentHash,
          confirmed: true,
          acknowledgedWarnings: [],
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await f.request(`/api/agenda/${source.id}/supplement`, "PATCH", {
          leaderId: leader.id,
          date: snapshot.date,
          expectedRevision: 1,
          supplement,
        })
      ).status,
      409,
    );
    f.google.events = async () => {
      throw new HttpError(503, "Temporary outage");
    };
    assert.equal(
      (
        await f.request("/api/agenda/refresh", "POST", {
          leaderId: leader.id,
          date: snapshot.date,
        })
      ).status,
      503,
    );
    const cached = await f.request(
      `/api/agenda?leaderId=${leader.id}&date=${snapshot.date}`,
    );
    assert.equal(cached.status, 200);
    assert.equal(cached.body.complete, false);
    assert.equal(cached.body.events[0].revision, 2);
    f.google.events = async () => {
      throw new HttpError(503, "Revoked", { code: "GOOGLE_ACCESS_DENIED" });
    };
    await f.request("/api/agenda/refresh", "POST", {
      leaderId: leader.id,
      date: snapshot.date,
    });
    const denied = await f.request(
      `/api/agenda?leaderId=${leader.id}&date=${snapshot.date}`,
    );
    assert.equal(denied.status, 503);
    assert.equal(denied.body.events, undefined);
    f.google.events = async () => {
      throw new HttpError(503, "Temporary outage");
    };
    await f.request("/api/agenda/refresh", "POST", {
      leaderId: leader.id,
      date: snapshot.date,
    });
    assert.equal(
      (
        await f.request(
          `/api/agenda?leaderId=${leader.id}&date=${snapshot.date}`,
        )
      ).status,
      503,
    );
  } finally {
    await f.close();
  }
});
