import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  loadConfig,
  verifyPassword,
  type AppConfig,
  type ConfigLeader,
  type ConfigUser,
} from "../server/config.ts";

const leader: ConfigLeader = {
  id: "pimpinan-pribadi",
  name: "Pimpinan Uji",
  position: "Kepala",
  salutation: "Bapak",
  closing: "Pak",
  timeZone: "Asia/Jakarta",
  calendarName: "Kalender Uji",
  calendarId: "calendar@example.test",
  revision: 1,
};
const secondLeader = { ...leader, id: "pimpinan-kedua" };
const owner = {
  name: "Pemilik Uji",
  email: "owner@example.test",
  passwordHash: hashPassword("synthetic-owner-test-password"),
};
const existingAdmin: ConfigUser = {
  ...owner,
  id: "existing-admin",
  role: "admin",
  leaderIds: [],
};

function readConfig(config?: unknown, overrides: Partial<AppConfig> = {}) {
  const previousJson = process.env.APP_CONFIG_JSON;
  const previousFile = process.env.APP_CONFIG_FILE;
  try {
    delete process.env.APP_CONFIG_FILE;
    if (config === undefined) delete process.env.APP_CONFIG_JSON;
    else process.env.APP_CONFIG_JSON = JSON.stringify(config);
    return loadConfig({
      production: false,
      encryptionKey: Buffer.alloc(32, 1),
      baseUrl: "http://localhost:3001",
      ...overrides,
    });
  } finally {
    if (previousJson === undefined) delete process.env.APP_CONFIG_JSON;
    else process.env.APP_CONFIG_JSON = previousJson;
    if (previousFile === undefined) delete process.env.APP_CONFIG_FILE;
    else process.env.APP_CONFIG_FILE = previousFile;
  }
}

test("explicit owner becomes the only administrator for all configured leaders", () => {
  const config = readConfig({ owner, leaders: [leader, secondLeader] });
  assert.equal(config.personalMode, true);
  assert.deepEqual(config.users, [
    {
      ...owner,
      id: "owner",
      role: "admin",
      leaderIds: [leader.id, secondLeader.id],
    },
  ]);
  assert.equal(
    verifyPassword(
      "synthetic-owner-test-password",
      config.users[0].passwordHash,
    ),
    true,
  );
  assert.equal(
    verifyPassword("wrong-password", config.users[0].passwordHash),
    false,
  );
});

test("owner supports a custom ID and an empty leader list without inventing accounts or access", () => {
  const config = readConfig({
    owner: { ...owner, id: "my-owner" },
    users: [],
    leaders: [],
  });
  assert.equal(config.personalMode, true);
  assert.equal(config.users.length, 1);
  assert.equal(config.users[0].id, "my-owner");
  assert.deepEqual(config.users[0].leaderIds, []);
});

test("unconfigured demo is personal but does not create login credentials", () => {
  const config = readConfig();
  assert.equal(config.personalMode, true);
  assert.deepEqual(config.users, []);
  assert.deepEqual(config.leaders, []);
});

test("legacy users keep explicit roles and leader assignments, including a single administrator", () => {
  const singleAdmin = readConfig({
    users: [existingAdmin],
    leaders: [leader, secondLeader],
  });
  assert.equal(singleAdmin.personalMode, false);
  assert.deepEqual(singleAdmin.users, [existingAdmin]);

  const operator: ConfigUser = {
    ...existingAdmin,
    id: "existing-operator",
    email: "operator@example.test",
    role: "operator",
    leaderIds: [leader.id],
  };
  const team = readConfig({
    users: [existingAdmin, operator],
    leaders: [leader, secondLeader],
  });
  assert.equal(team.personalMode, false);
  assert.deepEqual(team.users, [existingAdmin, operator]);
  const overridden = readConfig(undefined, {
    users: [existingAdmin],
    leaders: [leader],
    personalMode: true,
  });
  assert.equal(overridden.personalMode, false);
  assert.deepEqual(overridden.users[0].leaderIds, []);
});

test("owner rejects ambiguous existing user configuration", () => {
  assert.throws(
    () => readConfig({ owner, users: [existingAdmin], leaders: [leader] }),
    /owner atau users/,
  );
  assert.throws(
    () => readConfig({ owner, leaders: [leader] }, { users: [existingAdmin] }),
    /owner atau users/,
  );
  assert.throws(
    () =>
      readConfig({ owner, users: [existingAdmin], leaders: [] }, { users: [] }),
    /owner atau users/,
  );
});

test("malformed owner configuration is rejected instead of enabling demo or creating an account", () => {
  for (const invalidOwner of [
    null,
    [],
    "owner",
    {},
    { ...owner, id: " " },
    { ...owner, id: 42 },
    { ...owner, name: "" },
    { ...owner, name: {} },
    { ...owner, email: " " },
    { ...owner, email: [] },
    { ...owner, passwordHash: "plaintext-password" },
    { ...owner, passwordHash: 42 },
  ]) {
    assert.throws(
      () => readConfig({ owner: invalidOwner, leaders: [leader] }),
      /akun pemilik tidak valid/,
    );
  }
});

test("personal production still requires a configured account and HTTPS", () => {
  assert.throws(
    () =>
      readConfig(undefined, {
        production: true,
        baseUrl: "https://example.test",
      }),
    /Produksi memerlukan akun/,
  );
  assert.throws(
    () => readConfig({ owner, leaders: [leader] }, { production: true }),
    /APP_BASE_URL HTTPS/,
  );
  const config = readConfig(
    { owner, leaders: [leader] },
    { production: true, baseUrl: "https://example.test" },
  );
  assert.equal(config.personalMode, true);
  assert.equal(config.demoEnabled, false);
});
