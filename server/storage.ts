import { DatabaseSync } from "node:sqlite";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function hash(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

/** Sensitive payloads are encrypted individually, including SQLite WAL entries. */
export class Store {
  readonly db: DatabaseSync;
  constructor(
    dataDir: string,
    private readonly key: Buffer,
    private readonly now = Date.now,
  ) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dataDir, "agenda.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL,
   updated_at INTEGER NOT NULL, PRIMARY KEY (namespace,id));
   CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
   object_ref TEXT NOT NULL, fields TEXT NOT NULL, outcome TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  private encrypt(value: unknown, aad: string): string {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(aad));
    const payload = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), payload]
      .map((part) => part.toString("base64"))
      .join(".");
  }
  private decrypt<T>(payload: string, aad: string): T {
    const [iv, tag, ciphertext] = payload
      .split(".")
      .map((part) => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        "utf8",
      ),
    ) as T;
  }
  get<T>(namespace: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT payload FROM records WHERE namespace=? AND id=?")
      .get(namespace, id) as { payload: string } | undefined;
    return row ? this.decrypt<T>(row.payload, `${namespace}:${id}`) : undefined;
  }
  set(namespace: string, id: string, value: unknown): void {
    this.db
      .prepare(
        "INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
      )
      .run(
        namespace,
        id,
        this.encrypt(value, `${namespace}:${id}`),
        this.now(),
      );
  }
  delete(namespace: string, id: string): void {
    this.db
      .prepare("DELETE FROM records WHERE namespace=? AND id=?")
      .run(namespace, id);
  }
  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  audit(
    actor: string,
    action: string,
    objectRef: string,
    fields: string[] = [],
    outcome = "success",
  ): void {
    this.db
      .prepare("INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)")
      .run(
        randomUUID(),
        actor,
        action,
        objectRef,
        JSON.stringify(fields),
        outcome,
        this.now(),
      );
  }
  close(): void {
    this.db.close();
  }
}
