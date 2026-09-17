import "dotenv/config";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { DateTime } from "luxon";
import type { Leader, User } from "../shared/types.ts";

export interface ConfigUser extends User {
  passwordHash: string;
  leaderIds: string[];
}
export interface ConfigLeader extends Leader {
  calendarId: string;
}
interface ConfigOwner {
  id?: string;
  name: string;
  email: string;
  passwordHash: string;
}
export interface AppConfig {
  production: boolean;
  demoEnabled: boolean;
  personalMode: boolean;
  dataDir: string;
  encryptionKey: Buffer;
  users: ConfigUser[];
  leaders: ConfigLeader[];
  baseUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  now: () => number;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, encoded: string): boolean {
  const [method, salt, digest] = encoded.split(":");
  if (method !== "scrypt" || !salt || !/^[a-f0-9]{128}$/i.test(digest || ""))
    return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(digest, "hex"),
  );
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const production =
    overrides.production ?? process.env.NODE_ENV === "production";
  const dataDir = resolve(overrides.dataDir ?? process.env.DATA_DIR ?? "data");
  let encryptionKey = overrides.encryptionKey;
  if (!encryptionKey && process.env.ENCRYPTION_KEY)
    encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY, "base64");
  if (!encryptionKey) {
    if (production)
      throw new Error(
        "ENCRYPTION_KEY wajib diisi untuk produksi (base64, 32 byte).",
      );
    const keyDir = join(homedir(), ".pesan-agenda");
    mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    const keyFile = join(keyDir, "development.key");
    if (!existsSync(keyFile))
      writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
    encryptionKey = readFileSync(keyFile);
  }
  if (encryptionKey.length !== 32)
    throw new Error("ENCRYPTION_KEY harus berisi tepat 32 byte.");
  const raw = process.env.APP_CONFIG_FILE
    ? readFileSync(resolve(process.env.APP_CONFIG_FILE), "utf8")
    : process.env.APP_CONFIG_JSON;
  const parsed: {
    owner?: ConfigOwner;
    users?: ConfigUser[];
    leaders?: ConfigLeader[];
  } = raw ? JSON.parse(raw) : {};
  const leaders = overrides.leaders ?? parsed.leaders ?? [];
  const hasOwner = Object.hasOwn(parsed, "owner");
  let users = overrides.users ?? parsed.users ?? [];
  if (hasOwner) {
    const owner = parsed.owner;
    const nonemptyString = (value: unknown): value is string =>
      typeof value === "string" && value.trim().length > 0;
    if (
      !owner ||
      typeof owner !== "object" ||
      Array.isArray(owner) ||
      (owner.id !== undefined && !nonemptyString(owner.id)) ||
      !nonemptyString(owner.name) ||
      !nonemptyString(owner.email) ||
      !nonemptyString(owner.passwordHash) ||
      !/^scrypt:[a-f0-9]+:[a-f0-9]{128}$/i.test(owner.passwordHash)
    )
      throw new Error("Konfigurasi akun pemilik tidak valid.");
    if (
      (parsed.users !== undefined &&
        (!Array.isArray(parsed.users) || parsed.users.length > 0)) ||
      (overrides.users !== undefined &&
        (!Array.isArray(overrides.users) || overrides.users.length > 0))
    )
      throw new Error(
        "Gunakan konfigurasi owner atau users, bukan keduanya sekaligus.",
      );
    users = [
      {
        id: owner.id ?? "owner",
        name: owner.name,
        email: owner.email,
        passwordHash: owner.passwordHash,
        role: "admin",
        leaderIds: leaders.map((leader) => leader.id),
      },
    ];
  }
  for (const leader of leaders) {
    if (
      !leader.id ||
      !leader.calendarId ||
      !leader.name ||
      !leader.position ||
      !leader.calendarName ||
      !["Bapak", "Ibu"].includes(leader.salutation) ||
      !["Pak", "Bu"].includes(leader.closing) ||
      !DateTime.now().setZone(leader.timeZone).isValid ||
      !Number.isInteger(leader.revision)
    )
      throw new Error("Konfigurasi profil pimpinan tidak valid.");
  }
  for (const user of users) {
    if (
      !user.id ||
      !user.name ||
      !user.email ||
      !["admin", "operator"].includes(user.role) ||
      !/^scrypt:[a-f0-9]+:[a-f0-9]{128}$/i.test(user.passwordHash) ||
      !Array.isArray(user.leaderIds) ||
      user.leaderIds.some((id) => !leaders.some((leader) => leader.id === id))
    )
      throw new Error("Konfigurasi akun atau penugasan tidak valid.");
  }
  if (
    new Set(users.map((user) => user.id)).size !== users.length ||
    new Set(users.map((user) => user.email.toLowerCase())).size !==
      users.length ||
    new Set(leaders.map((leader) => leader.id)).size !== leaders.length
  )
    throw new Error("ID akun, email, atau pimpinan harus unik.");
  const baseUrl =
    overrides.baseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3001";
  if (production && (!users.length || !baseUrl.startsWith("https://")))
    throw new Error(
      "Produksi memerlukan akun terkonfigurasi dan APP_BASE_URL HTTPS.",
    );
  return {
    production,
    personalMode: hasOwner || users.length === 0,
    dataDir,
    encryptionKey,
    users,
    leaders,
    baseUrl,
    demoEnabled:
      !production &&
      (overrides.demoEnabled ?? process.env.DEMO_MODE !== "false"),
    googleClientId:
      overrides.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret:
      overrides.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
    googleRedirectUri:
      overrides.googleRedirectUri ??
      process.env.GOOGLE_REDIRECT_URI ??
      `${baseUrl}/api/google/callback`,
    now: overrides.now ?? Date.now,
  };
}
