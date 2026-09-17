import test from "node:test";
import assert from "node:assert/strict";
import { emptySupplement } from "../shared/domain.ts";
import type {
  AgendaEvent,
  Draft,
  SessionInfo,
  Snapshot,
  User,
} from "../shared/types.ts";
import { ApiError } from "../src/api-error.ts";
import { BrowserRuntime, type BrowserBackup } from "../src/pages/runtime.ts";
import type { AccountState, RuntimeStorage } from "../src/pages/storage.ts";
import type {
  BrowserLeader,
  CalendarGateway,
  CalendarOption,
} from "../src/pages/types.ts";

class MemoryStorage implements RuntimeStorage {
  accounts = new Map<string, AccountState>();
  remembered: User | null = null;
  failure = false;
  private queue = Promise.resolve();
  async rememberedUser() {
    return structuredClone(this.remembered);
  }
  async rememberUser(user: User | null) {
    this.remembered = structuredClone(user);
  }
  async read(key: string) {
    return structuredClone(this.accounts.get(key) ?? null);
  }
  update(
    key: string,
    change: (current: AccountState | null) => AccountState,
  ): Promise<AccountState> {
    const operation = this.queue.then(() => {
      if (this.failure) throw new ApiError("Simulated quota failure", 503);
      const next = change(structuredClone(this.accounts.get(key) ?? null));
      this.accounts.set(key, structuredClone(next));
      return structuredClone(next);
    });
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }
}

const DATE = "2026-09-17";
const OWNER: User = {
  id: "owner@example.test",
  email: "owner@example.test",
  name: "Pemilik Uji",
  role: "admin",
};
const SECOND: User = {
  id: "second@example.test",
  email: "second@example.test",
  name: "Pemilik Kedua",
  role: "admin",
};
const LEADER: BrowserLeader = {
  id: "leader-a",
  name: "Pimpinan Uji",
  position: "Kepala",
  salutation: "Bapak",
  closing: "Pak",
  timeZone: "Asia/Jakarta",
  calendarName: "Kalender Uji",
  calendarId: "calendar@example.test",
  revision: 1,
};

function source(): AgendaEvent {
  const event: AgendaEvent = {
    id: "event-a",
    sourceTitle: "Rapat Uji",
    description: "Pelaksanaan: Luring\nAgenda:\nPembahasan rencana kerja.",
    start: `${DATE}T08:30:00+07:00`,
    end: `${DATE}T09:30:00+07:00`,
    allDay: false,
    sourceLocation: "Ruang Rapat",
    htmlLink: "",
    sourceVersion: "v1",
    status: "confirmed",
    readable: true,
    supplement: emptySupplement(),
    revision: 0,
    reviewedSourceVersion: "v1",
    conflicts: [],
  };
  event.supplement = {
    ...emptySupplement(event),
    attendance: "attending",
    role: "Menghadiri",
    sourceReviewed: true,
    materialsStatus: "unnecessary",
  };
  return event;
}

class FakeGoogle implements CalendarGateway {
  configured = true;
  active = false;
  user = structuredClone(OWNER);
  rows = [source()];
  fail: Error | null = null;
  loads = 0;
  pending?: Promise<void>;
  async initialize() {}
  isConnected() {
    return this.active;
  }
  getUser() {
    return this.active ? structuredClone(this.user) : null;
  }
  async connect() {
    this.active = true;
    return {
      user: structuredClone(this.user),
      calendars: await this.calendars(),
    };
  }
  async disconnect() {
    this.active = false;
  }
  forget() {
    this.active = false;
  }
  async calendars(): Promise<CalendarOption[]> {
    return [
      {
        id: LEADER.calendarId,
        summary: LEADER.calendarName,
        timeZone: LEADER.timeZone,
        accessRole: "owner",
        primary: true,
      },
    ];
  }
  async events() {
    this.loads++;
    const result = structuredClone(this.rows);
    if (this.pending) await this.pending;
    if (this.fail) throw this.fail;
    return { events: result, excludedCount: 0 };
  }
}

async function fixture(
  storage = new MemoryStorage(),
  gateway = new FakeGoogle(),
) {
  let time = Date.parse(`${DATE}T07:00:00+07:00`);
  const runtime = new BrowserRuntime({ storage, gateway, now: () => time });
  const request = <T = any>(url: string, body?: unknown, method?: string) =>
    runtime.request<T>(url, body, method);
  await request("/api/session");
  await request("/api/google/connect", {});
  const current = await request<{ leaders: BrowserLeader[] }>("/api/leaders");
  if (!current.leaders.length) await request("/api/browser/leaders", LEADER);
  const refresh = () =>
    request<Snapshot>("/api/agenda/refresh", {
      leaderId: LEADER.id,
      date: DATE,
    });
  const save = (snapshot: Snapshot, notes = "Catatan tersimpan") =>
    request<AgendaEvent>(
      `/api/agenda/${snapshot.events[0].id}/supplement`,
      {
        leaderId: LEADER.id,
        date: DATE,
        expectedRevision: snapshot.events[0].revision,
        supplement: { ...snapshot.events[0].supplement, notes },
      },
      "PATCH",
    );
  const prepare = (snapshot: Snapshot) =>
    request<Draft>("/api/messages/prepare", {
      leaderId: snapshot.leaderId,
      date: snapshot.date,
      eventIds: [snapshot.events[0].id],
      snapshotHash: snapshot.hash,
      revisions: Object.fromEntries(
        snapshot.events.map((event) => [event.id, event.revision]),
      ),
    });
  const review = (
    draft: Draft,
    acknowledgedWarnings = draft.warnings.map((issue) => issue.id),
  ) =>
    request("/api/messages/" + draft.draftId + "/review", {
      contentHash: draft.contentHash,
      confirmed: true,
      acknowledgedWarnings,
    });
  return {
    runtime,
    storage,
    gateway,
    request,
    refresh,
    save,
    prepare,
    review,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

function status(expected: number, code?: string) {
  return (error: unknown) =>
    error instanceof ApiError &&
    error.status === expected &&
    (!code || error.data.code === code);
}

test("Pages demo works without Google SDK and reports browser storage explicitly", async () => {
  const gateway = new FakeGoogle();
  gateway.configured = false;
  gateway.initialize = async () => {
    throw new Error("SDK offline");
  };
  const runtime = new BrowserRuntime({ gateway, storage: new MemoryStorage() });
  const initial = await runtime.request<SessionInfo>("/api/session");
  assert.equal(initial.storageMode, "browser");
  assert.equal(initial.user, null);
  const session = await runtime.request<SessionInfo>("/api/auth/demo", {});
  assert.equal(session.demo, true);
  assert.equal(session.connected, true);
  assert.equal(session.googleConfigured, false);
  const snapshot = await runtime.request<Snapshot>("/api/agenda/refresh", {
    leaderId: "kepala-kantor",
    date: DATE,
  });
  assert.equal(snapshot.events.length, 5);
  assert.equal(snapshot.excludedCount, 1);
  assert.equal(gateway.loads, 0);
});

test("Pages reload remembers identity and local profiles, but never a live token or source snapshot", async () => {
  const f = await fixture();
  await f.refresh();
  const other = new BrowserRuntime({
    storage: f.storage,
    gateway: new FakeGoogle(),
  });
  const session = await other.request<SessionInfo>("/api/session");
  assert.equal(session.user?.id, OWNER.id);
  assert.equal(session.connected, false);
  const list = await other.request<{ leaders: BrowserLeader[] }>(
    "/api/leaders",
  );
  assert.equal(list.leaders[0].id, LEADER.id);
  await assert.rejects(
    other.request("/api/agenda/refresh", { leaderId: LEADER.id, date: DATE }),
    status(503, "GOOGLE_DISCONNECTED"),
  );
  assert.deepEqual(
    Object.keys(f.storage.accounts.get(`live:${OWNER.id}`)!).sort(),
    ["account", "leaders", "supplements", "version"],
  );
});

test("Pages account changes and demo keep profiles and supplements isolated", async () => {
  const f = await fixture();
  await f.save(await f.refresh(), "Pribadi milik akun A");
  await f.request("/api/auth/demo", {});
  const demoList = await f.request("/api/leaders");
  assert.equal(demoList.leaders[0].id, "kepala-kantor");
  f.gateway.user = SECOND;
  await f.request("/api/google/connect", {});
  assert.deepEqual((await f.request("/api/leaders")).leaders, []);
  await f.request("/api/browser/leaders", LEADER);
  assert.equal((await f.refresh()).events[0].supplement.notes, "");
  f.gateway.user = OWNER;
  await f.request("/api/google/connect", {});
  assert.equal(
    (await f.refresh()).events[0].supplement.notes,
    "Pribadi milik akun A",
  );
});

test("Pages transactional revision checks prevent two tabs from overwriting a saved supplement", async () => {
  const storage = new MemoryStorage();
  const a = await fixture(storage),
    b = await fixture(storage);
  const snapA = await a.refresh(),
    snapB = await b.refresh();
  const results = await Promise.allSettled([
    a.save(snapA, "Versi A"),
    b.save(snapB, "Versi B"),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find(
    (result) => result.status === "rejected",
  ) as PromiseRejectedResult;
  assert.equal(rejected.reason.status, 409);
  assert.equal(rejected.reason.data.latest.revision, 1);
  const latest = await a.refresh();
  assert.equal(latest.events[0].revision, 1);
  assert.equal(latest.events[0].supplement.notes, "Versi A");
});

test("Pages prepare refetches Google and rejects changed sources with a replacement snapshot", async () => {
  const f = await fixture();
  const snapshot = await f.refresh();
  await f.save(snapshot);
  const current = await f.refresh();
  f.gateway.rows[0].sourceVersion = "v2";
  f.gateway.rows[0].start = `${DATE}T10:00:00+07:00`;
  await assert.rejects(f.prepare(current), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    const next = error.data.snapshot as Snapshot;
    assert.equal(next.events[0].sourceVersion, "v2");
    assert.equal(next.events[0].supplement.sourceReviewed, false);
    assert.equal(next.events[0].supplement.notes, "Catatan tersimpan");
    return true;
  });
});

test("Pages draft uses canonical text, requires acknowledgements, and expires after 120 seconds", async () => {
  const f = await fixture();
  const draft = await f.prepare(await f.refresh());
  assert.deepEqual(draft.errors, []);
  assert.match(draft.plainText, /Rapat Uji/);
  assert.match(draft.plainText, /08\.30.*09\.30/);
  assert.equal(draft.readyToCopy, false);
  if (draft.warnings.length)
    await assert.rejects(f.review(draft, []), status(422));
  const reviewed = await f.review(draft);
  assert.equal(reviewed.readyToCopy, true);
  const loads = f.gateway.loads;
  f.advance(120_001);
  await assert.rejects(f.review(draft), status(409, "DRAFT_EXPIRED"));
  assert.equal(f.gateway.loads, loads);
});

test("Pages review rejects revoked access or offline fetch even when a cached draft exists", async () => {
  const f = await fixture();
  const draft = await f.prepare(await f.refresh());
  f.gateway.fail = new ApiError("Google access revoked", 401, {
    code: "GOOGLE_AUTH_REQUIRED",
  });
  await assert.rejects(f.review(draft), status(401));
  await assert.rejects(
    f.request(`/api/messages/${draft.draftId}/copy-result`, {
      outcome: "success",
    }),
    status(422),
  );
  f.gateway.fail = new ApiError("Network unavailable", 503);
  await assert.rejects(f.review(draft), status(503));
  f.gateway.active = false;
  await assert.rejects(f.review(draft), status(503, "GOOGLE_DISCONNECTED"));
});

test("Pages draft review detects a profile edited by another tab", async () => {
  const storage = new MemoryStorage();
  const a = await fixture(storage),
    b = await fixture(storage);
  const draft = await a.prepare(await a.refresh());
  await b.request("/api/browser/leaders", {
    ...LEADER,
    name: "Profil Diperbarui",
    revision: 2,
  });
  await assert.rejects(a.review(draft), status(409, "DRAFT_CHANGED"));
});

test("Pages failed refresh prevents supplement save from stale cached source", async () => {
  const f = await fixture();
  const snapshot = await f.refresh();
  f.gateway.fail = new ApiError("Calendar fetch failed", 503);
  await assert.rejects(f.refresh(), status(503));
  await assert.rejects(f.save(snapshot), status(503, "SOURCE_INCOMPLETE"));
  assert.equal(
    f.storage.accounts.get(`live:${OWNER.id}`)!.supplements.length,
    0,
  );
});

test("Pages in-flight request from a previous account cannot populate the new account", async () => {
  const f = await fixture();
  let resume!: () => void;
  f.gateway.pending = new Promise((resolve) => {
    resume = resolve;
  });
  const pending = f.refresh();
  await new Promise((resolve) => setImmediate(resolve));
  f.gateway.user = SECOND;
  await f.request("/api/google/connect", {});
  resume();
  await assert.rejects(pending, status(409, "CONTEXT_CHANGED"));
  assert.deepEqual((await f.request("/api/leaders")).leaders, []);
});

test("Pages storage failure does not acknowledge a supplement save", async () => {
  const f = await fixture();
  const snapshot = await f.refresh();
  f.storage.failure = true;
  await assert.rejects(f.save(snapshot), status(503));
  f.storage.failure = false;
  assert.equal((await f.refresh()).events[0].revision, 0);
});

test("Pages backup restores profiles and exact supplement values without tokens or calendar snapshots", async () => {
  const f = await fixture();
  await f.save(
    await f.refresh(),
    "Spasi, kode 001, dan tanda titik. Tetap utuh.",
  );
  const { backup } = await f.request<{ backup: BrowserBackup }>(
    "/api/browser/backup/export",
    {},
  );
  assert.deepEqual(Object.keys(backup).sort(), [
    "account",
    "exportedAt",
    "format",
    "leaders",
    "supplements",
    "version",
  ]);
  assert.ok(!JSON.stringify(backup).includes("access_token"));
  const destination = await fixture();
  await destination.request("/api/browser/backup/import", { backup });
  const restored = await destination.refresh();
  assert.equal(
    restored.events[0].supplement.notes,
    "Spasi, kode 001, dan tanda titik. Tetap utuh.",
  );
  assert.equal(restored.events[0].revision, 1);
  await destination.request("/api/browser/backup/import", { backup });
  assert.equal(
    destination.storage.accounts.get(`live:${OWNER.id}`)!.supplements.length,
    1,
  );
});

test("Pages backup rejects another account, unknown token fields, orphan records and duplicate IDs", async () => {
  const f = await fixture();
  await f.save(await f.refresh());
  const { backup } = await f.request<{ backup: BrowserBackup }>(
    "/api/browser/backup/export",
    {},
  );
  await assert.rejects(
    f.request("/api/browser/backup/import", {
      backup: { ...backup, account: { id: SECOND.id, email: SECOND.email } },
    }),
    status(403),
  );
  await assert.rejects(
    f.request("/api/browser/backup/import", {
      backup: { ...backup, access_token: "must-never-import" },
    }),
    status(422),
  );
  await assert.rejects(
    f.request("/api/browser/backup/import", {
      backup: {
        ...backup,
        supplements: [{ ...backup.supplements[0], leaderId: "missing" }],
      },
    }),
    status(422),
  );
  await assert.rejects(
    f.request("/api/browser/backup/import", {
      backup: { ...backup, leaders: [LEADER, LEADER] },
    }),
    status(422),
  );
});

test("Pages backup conflict aborts the entire merge without adding preceding profiles", async () => {
  const f = await fixture();
  const { backup } = await f.request<{ backup: BrowserBackup }>(
    "/api/browser/backup/export",
    {},
  );
  const before = structuredClone(f.storage.accounts.get(`live:${OWNER.id}`));
  const conflict = {
    ...backup,
    leaders: [
      { ...LEADER, id: "new-profile" },
      { ...LEADER, name: "Conflicting Name" },
    ],
  };
  await assert.rejects(
    f.request("/api/browser/backup/import", { backup: conflict }),
    status(409),
  );
  assert.deepEqual(f.storage.accounts.get(`live:${OWNER.id}`), before);
});

test("Pages calendar mapping cannot discard existing supplements accidentally", async () => {
  const f = await fixture();
  await f.save(await f.refresh());
  await assert.rejects(
    f.request("/api/browser/leaders", {
      ...LEADER,
      calendarId: "other@example.test",
      revision: 2,
    }),
    status(409),
  );
  assert.equal(
    (await f.request("/api/leaders")).leaders[0].calendarId,
    LEADER.calendarId,
  );
});

test("Pages returning to a tab with an expired token clears volatile drafts and signals the UI", async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const page = new EventTarget(),
    windowEvents = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    value: windowEvents,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: page,
    configurable: true,
  });
  let f: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    f = await fixture();
    const draft = await f.prepare(await f.refresh());
    await f.review(draft);
    let expired = 0;
    windowEvents.addEventListener("agenda:session-expired", () => {
      expired++;
    });
    f.gateway.active = false;
    page.dispatchEvent(new Event("visibilitychange"));
    assert.equal(expired, 1);
    assert.equal(
      (await f.request<SessionInfo>("/api/session")).connected,
      false,
    );
    await assert.rejects(
      f.request(`/api/messages/${draft.draftId}/copy-result`, {
        outcome: "success",
      }),
      status(404),
    );
  } finally {
    await f?.request("/api/auth/logout", {});
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
