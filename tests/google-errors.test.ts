import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api-error";
import {
  calendarApiError,
  type CalendarApiContext,
} from "../src/pages/google-errors";

const contexts: CalendarApiContext[] = [
  "calendar-list",
  "primary-calendar",
  "events",
];
function legacy(reason: string): unknown {
  return { error: { errors: [{ domain: "usageLimits", reason }] } };
}
function structured(reason: string): unknown {
  return {
    error: {
      status: "PERMISSION_DENIED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason },
      ],
    },
  };
}

test("disabled Calendar API is distinguished in legacy and structured Google responses", () => {
  for (const body of [
    legacy("accessNotConfigured"),
    structured("SERVICE_DISABLED"),
  ]) {
    const error = calendarApiError(403, body, "calendar-list");
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 503);
    assert.deepEqual(error.data, {
      code: "GOOGLE_API_DISABLED",
      httpStatus: 403,
    });
    assert.match(error.message, /Google Calendar API belum diaktifkan/);
    assert.match(error.message, /proyek Client ID ini/);
  }
});

test("insufficient OAuth scopes request both readonly permissions rather than changing calendar ACL", () => {
  for (const body of [
    legacy("insufficientPermissions"),
    structured("ACCESS_TOKEN_SCOPE_INSUFFICIENT"),
  ]) {
    const error = calendarApiError(403, body, "primary-calendar");
    assert.equal(error.status, 403);
    assert.deepEqual(error.data, {
      code: "GOOGLE_SCOPE_DENIED",
      httpStatus: 403,
    });
    assert.match(error.message, /kegiatan serta daftar kalender/);
  }
});

test("quota errors remain temporarily unavailable for both HTTP 403 and 429", () => {
  for (const reason of [
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "dailyLimitExceeded",
    "quotaExceeded",
  ]) {
    for (const status of [403, 429]) {
      const error = calendarApiError(status, legacy(reason), "events");
      assert.equal(error.status, 503);
      assert.deepEqual(error.data, {
        code: "GOOGLE_UNAVAILABLE",
        httpStatus: status,
      });
      assert.match(error.message, /Batas permintaan/);
    }
  }
  for (const body of [
    null,
    structured("RATE_LIMIT_EXCEEDED"),
    structured("QUOTA_EXCEEDED"),
  ]) {
    const error = calendarApiError(429, body, "calendar-list");
    assert.equal(error.status, 503);
    assert.equal(error.data.code, "GOOGLE_UNAVAILABLE");
  }
});

test("404 distinguishes missing or inaccessible calendars from forbidden responses in each context", () => {
  for (const context of contexts) {
    const notFound = calendarApiError(404, legacy("notFound"), context);
    const forbidden = calendarApiError(403, legacy("forbidden"), context);
    assert.equal(notFound.status, 404);
    assert.deepEqual(notFound.data, {
      code: "GOOGLE_CALENDAR_NOT_FOUND",
      httpStatus: 404,
    });
    assert.match(notFound.message, /tidak ditemukan atau tidak dapat diakses/);
    assert.equal(forbidden.status, 403);
    assert.deepEqual(forbidden.data, {
      code: "GOOGLE_ACCESS_DENIED",
      httpStatus: 403,
    });
    assert.notEqual(notFound.message, forbidden.message);
    if (context !== "events") {
      assert.ok(!notFound.message.includes("yang dipilih"));
      assert.ok(!forbidden.message.includes("yang dipilih"));
    }
  }
  assert.match(
    calendarApiError(403, null, "calendar-list").message,
    /^Daftar kalender/,
  );
  assert.match(
    calendarApiError(403, null, "primary-calendar").message,
    /^Kalender utama/,
  );
  assert.match(
    calendarApiError(403, null, "events").message,
    /kalender yang dipilih/,
  );
});

test("explicit organizational policy denials have a separate explanation", () => {
  for (const reason of ["domainPolicy", "admin_policy_enforced"]) {
    const error = calendarApiError(403, legacy(reason), "calendar-list");
    assert.equal(error.status, 403);
    assert.equal(error.data.code, "GOOGLE_ADMIN_POLICY");
    assert.match(error.message, /Kebijakan organisasi/);
  }
});

test("malformed error payloads safely use a status-based fixed fallback", () => {
  const bodies: unknown[] = [
    undefined,
    null,
    "not JSON",
    42,
    [],
    { error: null },
    { error: "broken" },
    { error: [] },
    { error: { errors: null, details: "broken" } },
    { error: { errors: { reason: "accessNotConfigured" } } },
    {
      error: {
        errors: [null, 1, "accessNotConfigured", {}, { reason: 42 }],
        details: [[], { reason: null }],
      },
    },
  ];
  for (const body of bodies) {
    assert.equal(
      calendarApiError(403, body, "calendar-list").data.code,
      "GOOGLE_ACCESS_DENIED",
    );
    const unavailable = calendarApiError(502, body, "events");
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.data, {
      code: "GOOGLE_UNAVAILABLE",
      httpStatus: 502,
    });
  }
});

test("untrusted error text cannot pretend to be a structured Google diagnosis", () => {
  const body = {
    error: {
      message: "SERVICE_DISABLED insufficientPermissions accessNotConfigured",
      reason: "SERVICE_DISABLED",
      details: [{ metadata: { reason: "SERVICE_DISABLED" } }],
    },
  };
  assert.equal(
    calendarApiError(403, body, "calendar-list").data.code,
    "GOOGLE_ACCESS_DENIED",
  );
});

test("responses expose only fixed messages, codes, and HTTP status, never remote messages or metadata", () => {
  const secret = "synthetic-private-token-DO-NOT-ECHO";
  const url = "https://private.invalid/project?access_token=" + secret;
  for (const reason of [
    "SERVICE_DISABLED",
    "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    "QUOTA_EXCEEDED",
    "unknown",
  ]) {
    for (const status of [403, 404, 500]) {
      const body = {
        error: {
          message: `${secret} ${url}`,
          errors: [{ reason: "unknown", message: secret, location: url }],
          details: [
            {
              reason,
              metadata: {
                activationUrl: url,
                token: secret,
                consumer: "projects/private-project-number",
              },
            },
          ],
        },
      };
      const error = calendarApiError(status, body, "calendar-list");
      assert.deepEqual(Object.keys(error.data).sort(), ["code", "httpStatus"]);
      const output = JSON.stringify({
        message: error.message,
        data: error.data,
        status: error.status,
      });
      for (const forbidden of [
        secret,
        url,
        "private-project-number",
        "private.invalid",
      ])
        assert.ok(!output.includes(forbidden));
    }
  }
});

test("HTTP 401 remains an explicit reconnect request even if the body is malformed", () => {
  const error = calendarApiError(401, null, "calendar-list");
  assert.equal(error.status, 401);
  assert.deepEqual(error.data, { code: "GOOGLE_RECONNECT", httpStatus: 401 });
});
