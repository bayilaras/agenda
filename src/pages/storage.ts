import type { Supplement, User } from "../../shared/types";
import { ApiError } from "../api-error";
import type { BrowserLeader } from "./types";

export interface StoredSupplement {
  leaderId: string;
  calendarId: string;
  eventId: string;
  value: Supplement;
  revision: number;
  reviewedSourceVersion: string;
  sourceVersionAtSave: string;
  updatedAt: string;
}

export interface AccountState {
  version: 1;
  account: { id: string; email: string };
  leaders: BrowserLeader[];
  supplements: StoredSupplement[];
}

/** Updates must be atomic across tabs. The mutator is synchronous on purpose. */
export interface RuntimeStorage {
  onExternalChange?(listener: (accountKey: string) => void): () => void;
  rememberedUser(): Promise<User | null>;
  rememberUser(user: User | null): Promise<void>;
  read(accountKey: string): Promise<AccountState | null>;
  update(
    accountKey: string,
    change: (current: AccountState | null) => AccountState,
  ): Promise<AccountState>;
}

function unavailable(): ApiError {
  return new ApiError(
    "Penyimpanan browser tidak tersedia. Izinkan penyimpanan situs atau gunakan browser biasa; perubahan belum disimpan.",
    503,
    { code: "BROWSER_STORAGE_UNAVAILABLE" },
  );
}

/** Only identities, profiles and supplements are stored; never Google tokens. */
export class BrowserStorage implements RuntimeStorage {
  private database?: Promise<IDBDatabase>;
  private channel?: BroadcastChannel;
  private listeners = new Set<(accountKey: string) => void>();

  constructor(private readonly name = "pesan-agenda-browser-v1") {}

  onExternalChange(listener: (accountKey: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private initializeChannel(): void {
    if (
      this.channel ||
      typeof window === "undefined" ||
      typeof BroadcastChannel === "undefined"
    )
      return;
    this.channel = new BroadcastChannel(`${this.name}:changes`);
    this.channel.onmessage = (event) => {
      const message = event.data;
      if (message?.kind === "account" && typeof message.key === "string")
        for (const listener of this.listeners) listener(message.key);
    };
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(unavailable());
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.name, 1);
      } catch {
        reject(unavailable());
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("accounts"))
          db.createObjectStore("accounts");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
      };
      request.onsuccess = () => {
        const db = request.result;
        this.initializeChannel();
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => reject(unavailable());
      request.onblocked = () =>
        reject(
          new ApiError(
            "Penyimpanan sedang diperbarui di tab lain. Tutup tab Pesan Agenda lainnya lalu muat ulang.",
            503,
            { code: "BROWSER_STORAGE_BLOCKED" },
          ),
        );
    });
    return this.database;
  }

  private async get<T>(store: string, key: string): Promise<T | null> {
    const db = await this.open();
    return new Promise<T | null>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction(store, "readonly");
      } catch {
        reject(unavailable());
        return;
      }
      const request = transaction.objectStore(store).get(key);
      let result: T | null = null;
      request.onsuccess = () => {
        result = request.result ?? null;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => reject(unavailable());
    });
  }

  rememberedUser(): Promise<User | null> {
    return this.get<User>("meta", "last-user");
  }

  async rememberUser(user: User | null): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction("meta", "readwrite");
        const store = transaction.objectStore("meta");
        if (user)
          store.put(
            { id: user.id, name: user.name, email: user.email, role: "admin" },
            "last-user",
          );
        else store.delete("last-user");
      } catch {
        reject(unavailable());
        return;
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(unavailable());
    });
  }

  read(accountKey: string): Promise<AccountState | null> {
    return this.get<AccountState>("accounts", accountKey);
  }

  async update(
    accountKey: string,
    change: (current: AccountState | null) => AccountState,
  ): Promise<AccountState> {
    const db = await this.open();
    return new Promise<AccountState>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = db.transaction("accounts", "readwrite");
      } catch {
        reject(unavailable());
        return;
      }
      const store = transaction.objectStore("accounts");
      const request = store.get(accountKey);
      let result: AccountState;
      let mutationError: unknown;
      request.onsuccess = () => {
        try {
          result = structuredClone(change(request.result ?? null));
          store.put(result, accountKey);
        } catch (error) {
          mutationError = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => {
        this.channel?.postMessage({ kind: "account", key: accountKey });
        resolve(result);
      };
      transaction.onerror = transaction.onabort = () =>
        reject(mutationError ?? unavailable());
    });
  }
}
