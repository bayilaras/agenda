import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserGoogle,
  GOOGLE_SCOPES,
  mapBrowserGoogleEvent,
  type GoogleOAuth2,
} from "../src/pages/google";
import { ApiError } from "../src/api-error";
import type { BrowserLeader } from "../src/pages/types";

const leader: BrowserLeader = {
  id: "leader",
  name: "Pemilik",
  position: "Kepala",
  salutation: "Bapak",
  closing: "Pak",
  calendarId: "calendar@example.test",
  calendarName: "Agenda",
  timeZone: "Asia/Jakarta",
  revision: 1,
};
const primary = {
  id: "owner@example.test",
  summary: "Kalender Pemilik",
  timeZone: "Asia/Jakarta",
  accessRole: "owner",
  primary: true,
};
const source = {
  id: "event-one",
  summary: "Rapat",
  description:
    "<p>ID Rapat: 001 234</p><p>Kode Sandi: A&lt;b&gt;C &amp; 01.</p>",
  start: { dateTime: "2026-09-17T08:00:00+07:00" },
  end: { dateTime: "2026-09-17T09:00:00+07:00" },
};
const validToken = {
  access_token: "synthetic-memory-token",
  expires_in: 3600,
  scope: GOOGLE_SCOPES.join(" "),
};
type TokenConfig = Parameters<GoogleOAuth2["initTokenClient"]>[0];
function oauthMock(
  options: {
    auto?: boolean;
    token?: Parameters<TokenConfig["callback"]>[0];
    error?: string;
    revoke?: "fail" | "throw";
  } = {},
) {
  const configs: TokenConfig[] = [];
  const prompts: string[] = [];
  const revoked: string[] = [];
  const oauth2: GoogleOAuth2 = {
    initTokenClient(config) {
      configs.push(config);
      return {
        requestAccessToken(request) {
          prompts.push(request.prompt);
          if (options.auto !== false)
            queueMicrotask(() =>
              options.error
                ? config.error_callback({ type: options.error })
                : config.callback(options.token ?? validToken),
            );
        },
      };
    },
    revoke(token, callback) {
      revoked.push(token);
      if (options.revoke === "throw") throw new Error("offline");
      callback(
        options.revoke === "fail"
          ? { successful: false, error: "invalid_request" }
          : { successful: true },
      );
    },
  };
  return { oauth2, configs, prompts, revoked };
}
function fetchMock(
  handler?: (
    url: URL,
    init: RequestInit | undefined,
  ) => Response | Promise<Response> | undefined,
) {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      `Bearer ${validToken.access_token}`,
    );
    assert.equal(init?.credentials, "omit");
    const custom = await handler?.(url, init);
    if (custom) return custom;
    if (url.pathname.endsWith("/calendarList/primary"))
      return Response.json(primary);
    if (url.pathname.endsWith("/calendarList"))
      return Response.json({ items: [primary] });
    if (url.pathname.endsWith("/events"))
      return Response.json({ items: [source], accessRole: "owner" });
    throw new Error("Unexpected URL");
  };
  return { fetcher, urls };
}
function code(expected: string, status?: number) {
  return (error: unknown) =>
    error instanceof ApiError &&
    error.data.code === expected &&
    (status === undefined || error.status === status);
}

test("Google popup starts synchronously with readonly scopes; account namespace stays stable", async () => {
  const mock = oauthMock();
  let name = "Kalender Pemilik";
  const network = fetchMock((url) =>
    url.pathname.endsWith("/primary")
      ? Response.json({ ...primary, summary: name })
      : undefined,
  );
  const google = new BrowserGoogle("test.apps.googleusercontent.com", {
    ...mock,
    ...network,
  });
  const connection = google.connect();
  assert.deepEqual(mock.prompts, ["select_account"]);
  assert.equal(mock.configs[0].scope, GOOGLE_SCOPES.join(" "));
  assert.equal(mock.configs[0].include_granted_scopes, false);
  const session = await connection;
  assert.ok(google.isConnected());
  assert.equal(session.user.role, "admin");
  assert.equal(session.user.email, primary.id);
  assert.match(session.user.id, /^google-[0-9a-f]{64}$/);
  const id = session.user.id;
  name = "Nama kalender berubah";
  assert.equal((await google.connect()).user.id, id);
  assert.equal(google.getUser()?.name, name);
  google.forget();
  assert.equal(google.getUser(), null);
  assert.equal(google.isConnected(), false);
});

test("missing configuration or Google library never opens a popup or sends Calendar requests", async () => {
  const missing = new BrowserGoogle("");
  await missing.initialize();
  assert.equal(missing.configured, false);
  await assert.rejects(missing.connect(), code("GOOGLE_NOT_CONFIGURED"));
  const unavailable = new BrowserGoogle("client", {
    loadLibrary: async () => {},
  });
  await assert.rejects(
    unavailable.initialize(),
    code("GOOGLE_LIBRARY_UNAVAILABLE"),
  );
  await assert.rejects(
    unavailable.connect(),
    code("GOOGLE_LIBRARY_UNAVAILABLE"),
  );
});

test("default browser fetch preserves the native API receiver through login and calendar reads", async () => {
  const originalFetch = globalThis.fetch;
  const network = fetchMock();
  globalThis.fetch = function (this: unknown, input, init) {
    if (this !== undefined && this !== globalThis)
      throw new TypeError("Illegal invocation");
    return network.fetcher(input, init);
  };
  try {
    // Deliberately omit the injected fetcher: the production constructor must
    // preserve the native browser receiver instead of assigning the gateway.
    const google = new BrowserGoogle("client", { ...oauthMock() });
    const session = await google.connect();
    assert.equal(session.user.email, primary.id);
    assert.equal((await google.calendars()).length, 1);
    assert.equal((await google.events(leader, "2026-09-17")).events.length, 1);
    assert.equal(network.urls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("popup close after a valid token callback does not cancel calendar retrieval", async () => {
  const oauth = oauthMock({ auto: false });
  let finishCalendarList: ((response: Response) => void) | undefined;
  const network = fetchMock((url) =>
    url.pathname.endsWith("/calendarList")
      ? new Promise<Response>((resolve) => {
          finishCalendarList = resolve;
        })
      : undefined,
  );
  const google = new BrowserGoogle("client", { ...oauth, ...network });
  const connection = google.connect();
  oauth.configs[0].callback(validToken);
  assert.ok(
    finishCalendarList,
    "Calendar retrieval starts after authorization",
  );
  oauth.configs[0].error_callback({ type: "popup_closed" });
  finishCalendarList(Response.json({ items: [primary] }));
  const session = await connection;
  assert.equal(session.user.email, primary.id);
  assert.equal(google.isConnected(), true);
});

test("granular consent cannot grant only one of the two required readonly scopes", async () => {
  let requests = 0;
  const google = new BrowserGoogle("client", {
    ...oauthMock({ token: { ...validToken, scope: GOOGLE_SCOPES[0] } }),
    fetcher: async () => {
      requests++;
      return Response.json({});
    },
  });
  await assert.rejects(google.connect(), code("GOOGLE_SCOPE_DENIED", 403));
  assert.equal(requests, 0);
  assert.equal(google.isConnected(), false);
  assert.equal(google.getUser(), null);
});

test("denied consent, blocked popup, closed popup and popup timeout provide actionable failures", async () => {
  for (const [options, expected] of [
    [{ token: { error: "access_denied" } }, "GOOGLE_CONSENT_DENIED"],
    [{ error: "popup_failed_to_open" }, "GOOGLE_POPUP_BLOCKED"],
    [{ error: "popup_closed" }, "GOOGLE_POPUP_CLOSED"],
    [{ auto: false }, "GOOGLE_POPUP_TIMEOUT"],
  ] as const) {
    const google = new BrowserGoogle("client", {
      ...oauthMock(options),
      popupTimeoutMs: 5,
    });
    await assert.rejects(google.connect(), code(expected));
    assert.equal(google.isConnected(), false);
  }
});

test("expired tokens require explicit reconnection without automatic refresh", async () => {
  let now = 10_000;
  const oauth = oauthMock();
  const network = fetchMock();
  const google = new BrowserGoogle("client", {
    ...oauth,
    ...network,
    now: () => now,
  });
  await google.connect();
  const requests = network.urls.length;
  now += 3_600_000;
  assert.equal(google.isConnected(), false);
  assert.equal(google.getUser()?.email, primary.id);
  await assert.rejects(
    google.events(leader, "2026-09-17"),
    code("GOOGLE_RECONNECT", 401),
  );
  assert.equal(network.urls.length, requests);
  assert.equal(oauth.prompts.length, 1);
  await google.connect();
  assert.equal(oauth.prompts.length, 2);
  assert.equal(google.isConnected(), true);
});

test("calendar list follows every page on each call and skips calendars without readable details", async () => {
  const secondary = {
    ...primary,
    id: "shared@example.test",
    primary: false,
    summary: "Kalender bersama",
    accessRole: "reader",
  };
  const network = fetchMock((url) => {
    if (!url.pathname.endsWith("/calendarList")) return;
    return url.searchParams.has("pageToken")
      ? Response.json({
          items: [
            secondary,
            { id: "busy", summary: "Busy", accessRole: "freeBusyReader" },
          ],
        })
      : Response.json({ items: [primary], nextPageToken: "page-2" });
  });
  const google = new BrowserGoogle("client", { ...oauthMock(), ...network });
  const session = await google.connect();
  assert.deepEqual(
    session.calendars.map((item) => item.id),
    [primary.id, secondary.id],
  );
  assert.deepEqual(
    (await google.calendars()).map((item) => item.id),
    [primary.id, secondary.id],
  );
  assert.equal(
    network.urls.filter((url) => url.pathname.endsWith("/calendarList")).length,
    4,
  );
});

test("events use timezone day boundaries across DST, paginate completely, and exclude special event types", async () => {
  const network = fetchMock((url) => {
    if (!url.pathname.endsWith("/events")) return;
    assert.equal(
      url.searchParams.get("timeMin"),
      "2026-03-08T00:00:00.000-05:00",
    );
    assert.equal(
      url.searchParams.get("timeMax"),
      "2026-03-09T00:00:00.000-04:00",
    );
    assert.equal(url.searchParams.get("singleEvents"), "true");
    return url.searchParams.has("pageToken")
      ? Response.json({
          items: [
            {
              ...source,
              id: "later",
              start: { dateTime: "2026-03-08T16:00:00-04:00" },
              end: { dateTime: "2026-03-08T17:00:00-04:00" },
            },
          ],
          accessRole: "owner",
        })
      : Response.json({
          items: [
            {
              ...source,
              start: { dateTime: "2026-03-08T12:00:00-04:00" },
              end: { dateTime: "2026-03-08T13:00:00-04:00" },
            },
            { id: "focus", eventType: "focusTime" },
            { id: "birthday", eventType: "birthday" },
          ],
          accessRole: "owner",
          nextPageToken: "page-2",
        });
  });
  const google = new BrowserGoogle("client", { ...oauthMock(), ...network });
  await google.connect();
  const result = await google.events(
    { ...leader, timeZone: "America/New_York" },
    "2026-03-08",
  );
  assert.equal(result.events.length, 2);
  assert.equal(result.excludedCount, 2);
  assert.ok(result.events[0].start < result.events[1].start);
  assert.equal(result.events[0].supplement.passcode, "A<b>C & 01.");
  assert.equal(result.events[0].supplement.meetingId, "001 234");
});

test("pagination repetition, excessive pages and incomplete pages fail closed without partial events", async () => {
  for (const kind of ["cycle", "limit", "malformed"] as const) {
    const network = fetchMock((url) => {
      if (!url.pathname.endsWith("/events")) return;
      const page = Number(url.searchParams.get("pageToken") ?? "0");
      if (kind === "malformed" && page > 0)
        return Response.json({ items: {}, accessRole: "owner" });
      return Response.json({
        items: [source],
        accessRole: "owner",
        nextPageToken: kind === "cycle" ? "1" : String(page + 1),
      });
    });
    const google = new BrowserGoogle("client", {
      ...oauthMock(),
      ...network,
      maxPages: 2,
    });
    await google.connect();
    await assert.rejects(
      google.events(leader, "2026-09-17"),
      code("GOOGLE_INCOMPLETE"),
    );
    assert.equal(
      network.urls.filter((url) => url.pathname.endsWith("/events")).length,
      2,
    );
  }
});

test("calendar pagination errors prevent the account becoming connected", async () => {
  const network = fetchMock((url) =>
    url.pathname.endsWith("/calendarList")
      ? Response.json({ items: [primary], nextPageToken: "loop" })
      : undefined,
  );
  const google = new BrowserGoogle("client", { ...oauthMock(), ...network });
  await assert.rejects(google.connect(), code("GOOGLE_INCOMPLETE"));
  assert.equal(google.isConnected(), false);
  assert.equal(google.getUser(), null);
});

test("private data are redacted for readers; recurring occurrence IDs normalize timezone offsets", async () => {
  const privateSource = {
    ...source,
    visibility: "private",
    location: "Private location",
    htmlLink: "https://calendar.google.com/event?private=1",
    conferenceData: {
      entryPoints: [
        {
          entryPointType: "video",
          passcode: "private",
          uri: "https://example.test/meeting",
        },
      ],
    },
  };
  const redacted = await mapBrowserGoogleEvent(privateSource, leader, "reader");
  assert.equal(redacted.readable, false);
  assert.equal(redacted.description, "");
  assert.equal(redacted.sourceLocation, "");
  assert.equal(redacted.htmlLink, "");
  assert.equal(redacted.supplement.passcode, "");
  assert.equal(redacted.sourceCandidates, undefined);
  assert.equal(
    (await mapBrowserGoogleEvent(privateSource, leader, "owner")).readable,
    true,
  );
  const occurrence = {
    ...source,
    recurringEventId: "series",
    originalStartTime: { dateTime: "2026-09-17T08:00:00+07:00" },
  };
  const first = await mapBrowserGoogleEvent(occurrence, leader, "owner");
  const moved = await mapBrowserGoogleEvent(
    {
      ...occurrence,
      id: "new-instance-id",
      originalStartTime: { dateTime: "2026-09-17T01:00:00Z" },
      summary: "Changed",
    },
    leader,
    "owner",
  );
  assert.equal(first.id, moved.id);
  assert.notEqual(first.sourceVersion, moved.sourceVersion);
});

test("conference candidates preserve raw characters and do not substitute a Google code for a Zoom ID", async () => {
  const value = await mapBrowserGoogleEvent(
    {
      ...source,
      conferenceData: {
        conferenceSolution: { name: "Google Meet" },
        entryPoints: [
          {
            entryPointType: "video",
            uri: "https://meet.google.com/aaa-bbbb-ccc",
            meetingCode: "aaa-bbbb-ccc",
            passcode: " 00.X! ",
          },
        ],
      },
    },
    leader,
    "owner",
  );
  assert.equal(value.supplement.meetingId, "001 234");
  assert.equal(value.supplement.passcode, "A<b>C & 01.");
  assert.ok(
    value.sourceCandidates?.some(
      (candidate) =>
        candidate.field === "passcode" && candidate.value === " 00.X! ",
    ),
  );
  assert.ok(value.conflicts.length >= 2);
});

test("Teams description and native Meet expose both sources without replacing inferred access", async () => {
  const teamsUrl =
    "https://teams.microsoft.com/meet/123456789?p=synthetic%2Bpass";
  const meetUrl = "https://meet.google.com/abc-defg-hij";
  const value = await mapBrowserGoogleEvent(
    {
      ...source,
      description: `<p>Microsoft Teams</p><p><a href="${teamsUrl}">Join the meeting now</a></p><p>Meeting ID: 001 234 567</p><p>Passcode: 00.X!?</p>`,
      conferenceData: {
        conferenceSolution: { name: "Google Meet" },
        entryPoints: [
          {
            entryPointType: "video",
            uri: meetUrl,
            meetingCode: "abc-defg-hij",
          },
        ],
      },
      hangoutLink: meetUrl,
    },
    leader,
    "owner",
  );
  assert.equal(value.supplement.meetingUrl, teamsUrl);
  assert.equal(value.supplement.platform, "Microsoft Teams");
  assert.equal(value.supplement.meetingId, "001 234 567");
  assert.equal(value.supplement.passcode, "00.X!?");
  assert.deepEqual(
    new Set(
      value.sourceCandidates
        ?.filter((item) => item.field === "meetingUrl")
        .map((item) => item.value),
    ),
    new Set([teamsUrl, meetUrl]),
  );
  assert.equal(
    value.sourceCandidates?.filter(
      (item) => item.field === "meetingUrl" && item.value === meetUrl,
    ).length,
    1,
  );
  assert.ok(value.conflicts.some((conflict) => conflict.includes("tautan")));
  assert.ok(value.conflicts.some((conflict) => conflict.includes("platform")));
  assert.equal(value.supplement.sourceReviewed, false);
  assert.equal(value.supplement.accessVerified, false);
});

test("matching description and hangout links are deduplicated without a false conflict", async () => {
  const meetUrl = "https://meet.google.com/abc-defg-hij";
  const value = await mapBrowserGoogleEvent(
    {
      ...source,
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

test("a differing hangout link remains selectable even without conference entry points", async () => {
  const teamsUrl = "https://teams.microsoft.com/meet/123456789?p=synthetic";
  const meetUrl = "https://meet.google.com/xyz-abcd-efg";
  const value = await mapBrowserGoogleEvent(
    {
      ...source,
      description: teamsUrl,
      hangoutLink: meetUrl,
    },
    leader,
    "owner",
  );
  assert.equal(value.supplement.meetingUrl, teamsUrl);
  assert.ok(
    value.sourceCandidates?.some(
      (item) => item.field === "meetingUrl" && item.value === meetUrl,
    ),
  );
  assert.ok(value.conflicts.some((conflict) => conflict.includes("tautan")));
});

test("revoked tokens clear connection; access denial and quota failures stay distinct", async () => {
  for (const [status, reason, expected, expectedStatus] of [
    [401, "authError", "GOOGLE_RECONNECT", 401],
    [403, "forbidden", "GOOGLE_ACCESS_DENIED", 403],
    [403, "rateLimitExceeded", "GOOGLE_UNAVAILABLE", 503],
  ] as const) {
    const network = fetchMock((url) =>
      url.pathname.endsWith("/events")
        ? Response.json({ error: { errors: [{ reason }] } }, { status })
        : undefined,
    );
    const google = new BrowserGoogle("client", { ...oauthMock(), ...network });
    await google.connect();
    await assert.rejects(
      google.events(leader, "2026-09-17"),
      code(expected, expectedStatus),
    );
    if (status === 401) assert.equal(google.isConnected(), false);
  }
});

test("disabled Calendar API during login is reported as project setup, not a selected-calendar permission", async () => {
  const network = fetchMock(() =>
    Response.json(
      {
        error: {
          errors: [{ reason: "accessNotConfigured" }],
          details: [{ reason: "SERVICE_DISABLED" }],
          message: "Private provider diagnostic must not reach the interface",
        },
      },
      { status: 403 },
    ),
  );
  const google = new BrowserGoogle("client", { ...oauthMock(), ...network });
  await assert.rejects(google.connect(), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.data.code, "GOOGLE_API_DISABLED");
    assert.equal(error.data.httpStatus, 403);
    assert.equal(error.status, 503);
    assert.match(error.message, /Google Calendar API/);
    assert.doesNotMatch(
      error.message,
      /kalender yang dipilih|Private provider/,
    );
    return true;
  });
  assert.equal(google.isConnected(), false);
  assert.equal(google.getUser(), null);
});

test("network timeout rejects the read instead of showing a partial calendar", async () => {
  const network = fetchMock((url, init) =>
    url.pathname.endsWith("/events")
      ? new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        })
      : undefined,
  );
  const google = new BrowserGoogle("client", {
    ...oauthMock(),
    ...network,
    requestTimeoutMs: 15,
  });
  await google.connect();
  await assert.rejects(
    google.events(leader, "2026-09-17"),
    code("GOOGLE_UNAVAILABLE"),
  );
});

test("disconnect always clears memory, including failed Google revocation", async () => {
  for (const revoke of [undefined, "fail", "throw"] as const) {
    const oauth = oauthMock({ revoke });
    const google = new BrowserGoogle("client", { ...oauth, ...fetchMock() });
    await google.connect();
    if (revoke)
      await assert.rejects(
        google.disconnect(),
        code("GOOGLE_REVOKE_UNCONFIRMED"),
      );
    else await google.disconnect();
    assert.deepEqual(oauth.revoked, [validToken.access_token]);
    assert.equal(google.isConnected(), false);
    assert.equal(google.getUser(), null);
  }
});

test("late popup and in-flight events cannot restore a forgotten session", async () => {
  const oauth = oauthMock({ auto: false });
  const google = new BrowserGoogle("client", { ...oauth, ...fetchMock() });
  const connection = google.connect();
  const rejected = assert.rejects(connection, code("GOOGLE_RECONNECT"));
  google.forget();
  oauth.configs[0].callback(validToken);
  await rejected;
  assert.equal(google.isConnected(), false);
  let finishFetch: ((response: Response) => void) | undefined;
  const network = fetchMock((url) =>
    url.pathname.endsWith("/events")
      ? new Promise<Response>((resolve) => {
          finishFetch = resolve;
        })
      : undefined,
  );
  const connected = new BrowserGoogle("client", { ...oauthMock(), ...network });
  await connected.connect();
  const events = connected.events(leader, "2026-09-17");
  const failed = assert.rejects(events, code("GOOGLE_RECONNECT"));
  connected.forget();
  finishFetch!(Response.json({ items: [source], accessRole: "owner" }));
  await failed;
});
