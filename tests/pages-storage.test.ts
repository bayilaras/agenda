import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { BrowserStorage, type AccountState } from "../src/pages/storage.ts";
import { ApiError } from "../src/api-error.ts";
import type { User } from "../shared/types.ts";

function state(): AccountState {
  return {
    version: 1,
    account: { id: "owner@example.test", email: "owner@example.test" },
    leaders: [],
    supplements: [],
  };
}
function installDatabase() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    value: new IDBFactory(),
    configurable: true,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  };
}

test("IndexedDB account writes persist across instances without mixing identities or preserving extra token fields", async () => {
  const restore = installDatabase();
  try {
    const first = new BrowserStorage("test-persistence"),
      second = new BrowserStorage("test-persistence");
    const owner = {
      id: "owner@example.test",
      email: "owner@example.test",
      name: "Pemilik",
      role: "admin",
      access_token: "must-not-be-stored",
    };
    await first.rememberUser(owner as User);
    await first.update("live:owner@example.test", () => state());
    assert.deepEqual(await second.rememberedUser(), {
      id: owner.id,
      email: owner.email,
      name: owner.name,
      role: "admin",
    });
    assert.deepEqual(await second.read("live:owner@example.test"), state());
    assert.equal(await second.read("live:another@example.test"), null);
    await second.rememberUser(null);
    assert.equal(await first.rememberedUser(), null);
    assert.deepEqual(await first.read("live:owner@example.test"), state());
  } finally {
    restore();
  }
});

test("IndexedDB serializes concurrent read-modify-write operations across independent connections", async () => {
  const restore = installDatabase();
  try {
    const first = new BrowserStorage("test-race"),
      second = new BrowserStorage("test-race");
    await first.update("account", () => state());
    const update = (store: BrowserStorage, email: string) =>
      store.update("account", (current) => {
        assert.ok(current);
        if (current.account.email !== "owner@example.test")
          throw new ApiError("Version conflict", 409);
        current.account.email = email;
        return current;
      });
    const results = await Promise.allSettled([
      update(first, "first@example.test"),
      update(second, "second@example.test"),
    ]);
    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
    assert.equal(
      (await first.read("account"))!.account.email,
      "first@example.test",
    );
  } finally {
    restore();
  }
});

test("IndexedDB aborts all changes when validation throws after mutating a loaded record", async () => {
  const restore = installDatabase();
  try {
    const storage = new BrowserStorage("test-abort");
    await storage.update("account", () => state());
    await assert.rejects(
      storage.update("account", (current) => {
        assert.ok(current);
        current.account.email = "partial-write@example.test";
        throw new ApiError("Later import record conflicts", 409);
      }),
      (error) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(await storage.read("account"), state());
  } finally {
    restore();
  }
});

test("IndexedDB clone failures never report success or corrupt the previous account", async () => {
  const restore = installDatabase();
  try {
    const storage = new BrowserStorage("test-clone-failure");
    await storage.update("account", () => state());
    await assert.rejects(
      storage.update("account", (current) => {
        assert.ok(current);
        Object.assign(current, { impossibleValue: () => undefined });
        return current;
      }),
    );
    assert.deepEqual(await storage.read("account"), state());
  } finally {
    restore();
  }
});

test("Unavailable IndexedDB produces an explicit failure instead of an in-memory false save", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    value: undefined,
    configurable: true,
  });
  try {
    const storage = new BrowserStorage("test-unavailable");
    await assert.rejects(
      storage.update("account", () => state()),
      (error) =>
        error instanceof ApiError &&
        error.status === 503 &&
        error.data.code === "BROWSER_STORAGE_UNAVAILABLE",
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, "indexedDB", previous);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
});
