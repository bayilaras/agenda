import { DateTime, IANAZone } from "luxon";
import {
  generateCalendarMessage,
  isCalendarSelectable,
  validateCalendarEvents,
} from "../../shared/calendar-message";
import {
  emptySupplement,
  generateMessage,
  isSelectable,
  MAX_COPY_AGE_SECONDS,
  MAX_SELECTED_EVENTS,
  sortEvents,
  TEMPLATE_VERSION,
  validateEvents,
  validateSupplement,
} from "../../shared/domain";
import type {
  AgendaEvent,
  CompositionMode,
  Draft,
  SessionInfo,
  Snapshot,
  Supplement,
  User,
} from "../../shared/types";
import { ApiError } from "../api-error";
import { BrowserGoogle } from "./google";
import {
  BrowserStorage,
  type AccountState,
  type RuntimeStorage,
  type StoredSupplement,
} from "./storage";
import type { BrowserLeader, CalendarGateway, CalendarOption } from "./types";

const DEMO_USER: User = {
  id: "demo-browser",
  name: "Pemilik Demo",
  email: "demo@example.invalid",
  role: "admin",
};
const DEMO_LEADERS: BrowserLeader[] = [
  {
    id: "kepala-kantor",
    name: "Dr. Arif Pratama, S.H., M.H.",
    position: "Kepala Kantor Wilayah",
    salutation: "Bapak",
    closing: "Pak",
    timeZone: "Asia/Jakarta",
    calendarName: "Agenda Kepala Kantor Wilayah",
    calendarId: "demo-kepala-kantor",
    revision: 1,
  },
  {
    id: "kepala-bagian",
    name: "Dra. Ratna Puspitasari, M.Si.",
    position: "Kepala Bagian Tata Usaha",
    salutation: "Ibu",
    closing: "Bu",
    timeZone: "Asia/Jakarta",
    calendarName: "Agenda Kepala Bagian Tata Usaha",
    calendarId: "demo-kepala-bagian",
    revision: 1,
  },
];
const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
const MAX_PROFILES = 100;
const MAX_SUPPLEMENTS = 10_000;
type JsonObject = Record<string, unknown>;
interface Context {
  key: string;
  generation: number;
  user: User;
  demo: boolean;
}
interface StoredDraft {
  draft: Draft;
  key: string;
  leaderId: string;
  date: string;
  eventIds: string[];
  revisions: Record<string, number>;
  snapshotHash: string;
  profileHash: string;
}
export interface BrowserBackup {
  format: "pesan-agenda-browser";
  version: 1;
  exportedAt: string;
  account: { id: string; email: string };
  leaders: BrowserLeader[];
  supplements: StoredSupplement[];
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max = 1024): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function onlyKeys(value: JsonObject, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
function fail(message: string, status = 422, data: JsonObject = {}): never {
  throw new ApiError(message, status, data);
}
function validDate(input: unknown): string {
  if (
    typeof input !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
    !DateTime.fromISO(input, { zone: "UTC" }).isValid
  )
    fail("Tanggal harus valid dalam format YYYY-MM-DD.");
  return input;
}
function iso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length < 40 &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
function profile(input: unknown, allowZeroRevision = false): BrowserLeader {
  if (
    !object(input) ||
    !onlyKeys(input, [
      "id",
      "name",
      "position",
      "salutation",
      "closing",
      "timeZone",
      "calendarName",
      "calendarId",
      "revision",
    ]) ||
    !text(input.id, 128) ||
    !/^[\w-]+$/.test(input.id) ||
    !text(input.name, 300) ||
    !text(input.position, 300) ||
    !["Bapak", "Ibu"].includes(String(input.salutation)) ||
    !["Pak", "Bu"].includes(String(input.closing)) ||
    !text(input.timeZone, 100) ||
    !IANAZone.isValidZone(input.timeZone) ||
    !text(input.calendarName, 300) ||
    !text(input.calendarId) ||
    !Number.isSafeInteger(input.revision) ||
    Number(input.revision) < (allowZeroRevision ? 0 : 1)
  )
    fail(
      "Profil pimpinan tidak valid. Periksa nama, jabatan, kalender, zona waktu, dan revisinya.",
    );
  return structuredClone(input) as unknown as BrowserLeader;
}
function supplementalKey(
  item: Pick<StoredSupplement, "leaderId" | "calendarId" | "eventId">,
): string {
  return JSON.stringify([item.leaderId, item.calendarId, item.eventId]);
}
function checkStorageSize(state: AccountState): void {
  // Reserve metadata space so every stored account fits the backup/import limit.
  if (
    new TextEncoder().encode(JSON.stringify(state)).byteLength >
    MAX_BACKUP_BYTES - 1024
  )
    fail(
      "Penyimpanan lokal mencapai batas 5 MB. Perubahan belum disimpan; ekspor cadangan data Anda.",
      413,
    );
}
async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function same(left: unknown, right: unknown): boolean {
  // Compare values independent of property order in manually imported JSON files.
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : object(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function demoEvents(leader: BrowserLeader, date: string): AgendaEvent[] {
  if (DateTime.fromISO(date, { zone: leader.timeZone }).weekday > 5) return [];
  const rows = [
    [
      "08:30",
      "09:15",
      "Briefing dan arahan pelaksanaan tugas",
      "Ruang Rapat Utama, Lantai 2",
      "Pelaksanaan: Luring\nAgenda:\nEvaluasi layanan pertanahan dan penetapan prioritas kerja hari ini.\nBahan Rapat:\nRingkasan capaian layanan dan tindak lanjut pekan berjalan.",
    ],
    [
      "10:00",
      "11:00",
      "Rapat pembahasan kerja sama antarinstansi",
      "",
      "Pelaksanaan: Daring\nKeterangan:\nUndangan koordinasi melalui Zoom Meeting. Pokok agenda dan akses rapat perlu dikonfirmasi kepada penyelenggara.",
    ],
    [
      "13:30",
      "14:30",
      "Koordinasi Gugus Tugas Reforma Agraria",
      "Ruang Rapat Reforma Agraria, Lantai 3",
      "Pelaksanaan: Hibrida\nID Rapat: 001 234 5678\nKode Sandi: Contoh.2026.\nAgenda:\nPembahasan progres penataan aset dan akses serta tindak lanjut usulan lokasi prioritas.\nBahan Rapat:\nMatriks pelaksanaan reforma agraria triwulan III.",
    ],
    [
      "15:00",
      "15:45",
      "Penelaahan dokumen dan laporan kinerja",
      "Ruang Kerja Pimpinan",
      "Pelaksanaan: Luring\nAgenda:\nPenelaahan konsep laporan kinerja dan dokumen yang memerlukan arahan pimpinan.",
    ],
    ["16:00", "17:00", "Waktu sibuk — kegiatan privat", "", ""],
  ];
  return rows.map(([start, end, title, location, description], index) => {
    const id = `demo-${leader.id}-${date}-${index}`;
    const event: AgendaEvent = {
      id,
      sourceTitle: title,
      description,
      start: DateTime.fromISO(`${date}T${start}`, {
        zone: leader.timeZone,
      }).toISO()!,
      end: DateTime.fromISO(`${date}T${end}`, {
        zone: leader.timeZone,
      }).toISO()!,
      allDay: false,
      sourceLocation: location,
      htmlLink: "",
      sourceVersion: `demo-v1:${id}`,
      status: "confirmed",
      readable: index !== 4,
      supplement: emptySupplement(),
      revision: 0,
      reviewedSourceVersion: "",
      conflicts: [],
    };
    event.supplement = emptySupplement(event);
    if (index === 0 || index === 2) {
      Object.assign(event.supplement, {
        attendance: "attending",
        role: index === 0 ? "Memimpin" : "Menghadiri",
        materialsStatus: "available",
        includeMaterials: true,
        sourceReviewed: true,
      });
      event.reviewedSourceVersion = event.sourceVersion;
    }
    if (index === 1)
      Object.assign(event.supplement, {
        mode: "online",
        platform: "Zoom Meeting",
        agenda: "",
        accessCode: "unknown",
      });
    if (index === 2)
      Object.assign(event.supplement, {
        mode: "hybrid",
        platform: "Zoom Meeting",
        meetingId: "001 234 5678",
        passcode: "Contoh.2026.",
        accessCode: "required",
        accessVerified: true,
      });
    if (index === 3)
      Object.assign(event.supplement, {
        mode: "offline",
        materialsStatus: "unavailable",
        includeMaterials: false,
      });
    return event;
  });
}

/** Browser-only equivalent of the local API. There is no password or server session. */
export class BrowserRuntime {
  private readonly gateway: CalendarGateway;
  private readonly storage: RuntimeStorage;
  private readonly now: () => number;
  private initialization?: Promise<void>;
  private currentUser: User | null = null;
  private demo = false;
  private generation = 0;
  private calendarOptions: CalendarOption[] = [];
  private snapshots = new Map<string, Snapshot>();
  private drafts = new Map<string, StoredDraft>();
  private refreshSequence = new Map<string, number>();
  private stopWatchingConnection?: () => void;

  constructor(options: {
    gateway: CalendarGateway;
    storage?: RuntimeStorage;
    now?: () => number;
  }) {
    this.gateway = options.gateway;
    this.storage = options.storage ?? new BrowserStorage();
    this.now = options.now ?? Date.now;
    this.storage.onExternalChange?.((key) => {
      if (
        !this.currentUser ||
        key !== (this.demo ? "demo:v1" : `live:${this.currentUser.id}`)
      )
        return;
      this.generation++;
      this.snapshots.clear();
      this.drafts.clear();
      this.refreshSequence.clear();
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("agenda:data-changed"));
    });
  }

  private initialize(): Promise<void> {
    this.initialization ??= (async () => {
      // Loading the Google SDK must not prevent the offline demonstration.
      void this.gateway.initialize().catch(() => undefined);
      const remembered = await this.storage.rememberedUser();
      if (
        remembered &&
        text(remembered.id) &&
        text(remembered.email) &&
        text(remembered.name, 300)
      )
        this.currentUser = {
          id: remembered.id,
          email: remembered.email,
          name: remembered.name,
          role: "admin",
        };
    })();
    return this.initialization;
  }

  private session(): SessionInfo {
    return {
      user: this.currentUser,
      csrfToken: "",
      demo: this.demo,
      demoAvailable: true,
      personalMode: true,
      googleConfigured: this.gateway.configured,
      connected: this.demo || this.connected(),
      storageMode: "browser",
    };
  }

  private connected(): boolean {
    return (
      this.gateway.isConnected() &&
      this.gateway.getUser()?.id === this.currentUser?.id
    );
  }

  private context(): Context {
    if (!this.currentUser)
      fail("Hubungkan akun Google atau buka mode demo untuk melanjutkan.", 401);
    return {
      key: this.demo ? "demo:v1" : `live:${this.currentUser.id}`,
      generation: this.generation,
      user: this.currentUser,
      demo: this.demo,
    };
  }

  private assertContext(context: Context): void {
    if (
      context.generation !== this.generation ||
      context.user.id !== this.currentUser?.id ||
      context.demo !== this.demo
    )
      fail(
        "Akun atau ruang kerja berubah. Muat ulang agenda pada akun yang aktif.",
        409,
        { code: "CONTEXT_CHANGED" },
      );
  }

  private requireConnection(context: Context): void {
    this.assertContext(context);
    if (!context.demo && !this.connected())
      fail(
        "Hubungkan kembali Google Calendar untuk membaca jadwal terbaru.",
        503,
        { code: "GOOGLE_DISCONNECTED" },
      );
  }

  private emptyState(context: Context): AccountState {
    return {
      version: 1,
      account: { id: context.user.id, email: context.user.email },
      leaders: context.demo ? structuredClone(DEMO_LEADERS) : [],
      supplements: [],
    };
  }

  private async state(context: Context): Promise<AccountState> {
    const result = await this.storage.read(context.key);
    this.assertContext(context);
    return result ?? this.emptyState(context);
  }

  private leader(state: AccountState, id: unknown): BrowserLeader {
    if (!text(id, 128)) fail("ID pimpinan tidak valid.");
    const result = state.leaders.find((item) => item.id === id);
    if (!result) fail("Profil pimpinan tidak ditemukan pada akun ini.", 403);
    return result;
  }

  private clearVolatile(): void {
    this.stopWatchingConnection?.();
    this.stopWatchingConnection = undefined;
    this.snapshots.clear();
    this.drafts.clear();
    this.refreshSequence.clear();
    this.calendarOptions = [];
  }

  private watchConnection(): void {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;
    this.stopWatchingConnection?.();
    const page = document;
    const check = () => {
      if (this.demo || !this.currentUser || this.connected()) return;
      this.generation++;
      this.clearVolatile();
      window.dispatchEvent(new Event("agenda:session-expired"));
    };
    const timer = setInterval(check, 1000);
    page.addEventListener("visibilitychange", check);
    this.stopWatchingConnection = () => {
      clearInterval(timer);
      page.removeEventListener("visibilitychange", check);
    };
  }

  private async connect(): Promise<SessionInfo> {
    // Invoke GIS immediately inside the button gesture, before unrelated storage awaits.
    const connection = this.gateway.connect();
    const generation = ++this.generation;
    try {
      const [result] = await Promise.all([connection, this.initialize()]);
      if (generation !== this.generation)
        fail(
          "Permintaan koneksi telah digantikan. Coba hubungkan kembali.",
          409,
        );
      const user = result.user;
      if (!text(user.id) || !text(user.email) || !text(user.name, 300))
        fail("Identitas akun Google tidak valid.", 503);
      const next: User = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: "admin",
      };
      await this.storage.rememberUser(next);
      if (generation !== this.generation)
        fail("Akun berubah selama proses koneksi.", 409);
      this.clearVolatile();
      this.currentUser = next;
      this.demo = false;
      this.calendarOptions = result.calendars;
      this.watchConnection();
      return this.session();
    } catch (error) {
      if (generation === this.generation) this.gateway.forget();
      throw error;
    }
  }

  private withSupplements(
    state: AccountState,
    leader: BrowserLeader,
    snapshot: Snapshot,
  ): Snapshot {
    const events = sortEvents(
      snapshot.events.map((event) => {
        const saved = state.supplements.find(
          (item) =>
            item.leaderId === leader.id &&
            item.calendarId === leader.calendarId &&
            item.eventId === event.id,
        );
        if (!saved) return event;
        const changed = saved.sourceVersionAtSave !== event.sourceVersion;
        return {
          ...event,
          supplement: {
            ...saved.value,
            ...(changed ? { sourceReviewed: false } : {}),
          },
          revision: saved.revision,
          reviewedSourceVersion:
            saved.reviewedSourceVersion ||
            (changed ? saved.sourceVersionAtSave : ""),
        };
      }),
    );
    return {
      ...snapshot,
      events,
      excludedCount:
        snapshot.excludedCount -
        snapshot.events.filter((event) => !isSelectable(event)).length +
        events.filter((event) => !isSelectable(event)).length,
    };
  }

  private async refresh(
    context: Context,
    leader: BrowserLeader,
    date: string,
  ): Promise<Snapshot> {
    this.requireConnection(context);
    const key = JSON.stringify([leader.id, date]);
    const sequence = (this.refreshSequence.get(key) ?? 0) + 1;
    this.refreshSequence.set(key, sequence);
    try {
      const result = context.demo
        ? { events: demoEvents(leader, date), excludedCount: 0 }
        : await this.gateway.events(leader, date);
      this.requireConnection(context);
      const state = await this.state(context);
      if (!same(this.leader(state, leader.id), leader))
        fail("Profil pimpinan berubah. Muat ulang agenda.", 409, {
          code: "PROFILE_CHANGED",
        });
      const snapshot: Snapshot = {
        id: crypto.randomUUID(),
        leaderId: leader.id,
        date,
        hash: await hash(
          result.events
            .map((event) => [event.id, event.sourceVersion])
            .sort((a, b) => a[0].localeCompare(b[0])),
        ),
        checkedAt: new Date(this.now()).toISOString(),
        events: sortEvents(result.events),
        excludedCount:
          result.excludedCount +
          result.events.filter((event) => !isSelectable(event)).length,
        complete: true,
      };
      this.requireConnection(context);
      if (this.refreshSequence.get(key) !== sequence)
        fail("Permintaan agenda telah digantikan oleh pemuatan terbaru.", 409, {
          code: "REQUEST_SUPERSEDED",
        });
      this.snapshots.set(key, snapshot);
      return this.withSupplements(state, leader, snapshot);
    } catch (error) {
      if (
        context.generation === this.generation &&
        this.refreshSequence.get(key) === sequence
      ) {
        const previous = this.snapshots.get(key);
        if (previous) this.snapshots.set(key, { ...previous, complete: false });
        for (const saved of this.drafts.values())
          if (saved.leaderId === leader.id && saved.date === date)
            saved.draft.readyToCopy = false;
      }
      throw error;
    }
  }

  private cached(
    context: Context,
    state: AccountState,
    leader: BrowserLeader,
    date: string,
  ): Snapshot {
    this.requireConnection(context);
    const snapshot = this.snapshots.get(JSON.stringify([leader.id, date]));
    if (!snapshot) fail("Agenda belum dimuat. Tekan Muat Ulang.", 404);
    if (!snapshot.complete)
      fail(
        "Kalender belum berhasil diperiksa. Muat ulang sebelum melanjutkan.",
        503,
        { code: "SOURCE_INCOMPLETE" },
      );
    return this.withSupplements(state, leader, snapshot);
  }

  private async saveSupplement(
    context: Context,
    id: string,
    body: JsonObject,
  ): Promise<AgendaEvent> {
    const date = validDate(body.date);
    if (
      !Number.isSafeInteger(body.expectedRevision) ||
      Number(body.expectedRevision) < 0
    )
      fail("Nomor revisi pelengkap wajib diisi.");
    const errors = validateSupplement(body.supplement);
    if (errors.length)
      fail(
        "Sebagian isian belum valid. Isian Anda tetap tersedia untuk diperbaiki.",
        422,
        { errors },
      );
    const value = structuredClone(body.supplement) as Supplement;
    let result: AgendaEvent | undefined;
    await this.storage.update(context.key, (existing) => {
      this.requireConnection(context);
      const state = existing ?? this.emptyState(context);
      const leader = this.leader(state, body.leaderId);
      const snapshot = this.cached(context, state, leader, date);
      const current = snapshot.events.find((event) => event.id === id);
      if (!current)
        fail(
          "Kegiatan tidak ditemukan pada tanggal ini. Muat ulang agenda.",
          404,
        );
      if (!current.readable || current.status === "cancelled")
        fail("Kegiatan privat atau dibatalkan tidak dapat dilengkapi.", 403);
      if (current.revision !== body.expectedRevision)
        fail(
          "Pelengkap telah disimpan pada tab lain. Bandingkan versi terbaru dengan isian Anda.",
          409,
          { latest: current },
        );
      const saved: StoredSupplement = {
        leaderId: leader.id,
        calendarId: leader.calendarId,
        eventId: id,
        value,
        revision: current.revision + 1,
        reviewedSourceVersion: value.sourceReviewed
          ? current.sourceVersion
          : current.reviewedSourceVersion,
        sourceVersionAtSave: current.sourceVersion,
        updatedAt: new Date(this.now()).toISOString(),
      };
      const key = supplementalKey(saved);
      const index = state.supplements.findIndex(
        (item) => supplementalKey(item) === key,
      );
      if (index < 0) {
        if (state.supplements.length >= MAX_SUPPLEMENTS)
          fail(
            "Penyimpanan mencapai batas 10.000 pelengkap. Ekspor cadangan sebelum melanjutkan.",
          );
        state.supplements.push(saved);
      } else state.supplements[index] = saved;
      checkStorageSize(state);
      result = {
        ...current,
        supplement: value,
        revision: saved.revision,
        reviewedSourceVersion: saved.reviewedSourceVersion,
      };
      return state;
    });
    this.assertContext(context);
    return result!;
  }

  private async prepare(context: Context, body: JsonObject): Promise<Draft> {
    if (
      body.compositionMode !== undefined &&
      body.compositionMode !== "calendar" &&
      body.compositionMode !== "custom"
    )
      fail("Mode penyusunan pesan tidak valid.");
    const compositionMode: CompositionMode = body.compositionMode ?? "custom";
    const state = await this.state(context);
    const leader = this.leader(state, body.leaderId),
      date = validDate(body.date);
    const ids = body.eventIds,
      revisions = body.revisions;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > MAX_SELECTED_EVENTS ||
      ids.some((id) => !text(id)) ||
      new Set(ids).size !== ids.length
    )
      fail("Pilih 1–20 kegiatan yang berbeda.");
    const eventIds = ids as string[];
    if (
      typeof body.snapshotHash !== "string" ||
      !object(revisions) ||
      eventIds.some(
        (id) =>
          !Number.isSafeInteger(revisions[id]) || Number(revisions[id]) < 0,
      )
    )
      fail("Versi sumber dan pelengkap wajib dikirim. Muat ulang agenda.");
    const snapshot = await this.refresh(context, leader, date);
    const events = snapshot.events.filter((event) =>
      eventIds.includes(event.id),
    );
    if (
      snapshot.hash !== body.snapshotHash ||
      events.length !== eventIds.length ||
      events.some((event) => revisions[event.id] !== event.revision)
    )
      fail(
        "Agenda terbaru berbeda. Periksa kembali kegiatan dan pelengkap sebelum membuat pesan.",
        409,
        { snapshot },
      );
    const selectable =
      compositionMode === "calendar" ? isCalendarSelectable : isSelectable;
    const validate =
      compositionMode === "calendar" ? validateCalendarEvents : validateEvents;
    const generate =
      compositionMode === "calendar"
        ? generateCalendarMessage
        : generateMessage;
    const validation = validate(
      events,
      leader,
      date,
      snapshot.events.filter(selectable).length,
    );
    const plainText = generate(events, leader, date);
    const contentHash = await hash({
      plainText,
      compositionMode,
      profile: leader,
      eventIds,
      revisions,
      snapshot: snapshot.hash,
      template: TEMPLATE_VERSION,
    });
    const draft: Draft = {
      draftId: crypto.randomUUID(),
      compositionMode,
      plainText,
      contentHash,
      templateVersion: TEMPLATE_VERSION,
      snapshotId: snapshot.id,
      checkedAt: snapshot.checkedAt,
      expiresAt: new Date(
        Date.parse(snapshot.checkedAt) + MAX_COPY_AGE_SECONDS * 1000,
      ).toISOString(),
      ...validation,
      readyToCopy: false,
    };
    const profileHash = await hash(leader);
    this.requireConnection(context);
    this.drafts.set(draft.draftId, {
      draft,
      key: context.key,
      leaderId: leader.id,
      date,
      eventIds,
      revisions: Object.fromEntries(
        events.map((event) => [event.id, event.revision]),
      ),
      snapshotHash: snapshot.hash,
      profileHash,
    });
    return draft;
  }

  private loadDraft(context: Context, id: string): StoredDraft {
    const saved = this.drafts.get(id);
    if (!saved || saved.key !== context.key)
      fail("Draf tidak ditemukan. Buat pesan kembali.", 404);
    return saved;
  }

  private checkExpiry(saved: StoredDraft): void {
    if (Date.parse(saved.draft.expiresAt) <= this.now())
      fail(
        "Pesan melewati batas kesegaran 120 detik. Perbarui pesan dan periksa lagi.",
        409,
        { code: "DRAFT_EXPIRED" },
      );
  }

  private async review(
    context: Context,
    id: string,
    body: JsonObject,
  ): Promise<{ readyToCopy: true; contentHash: string; expiresAt: string }> {
    const saved = this.loadDraft(context, id);
    saved.draft.readyToCopy = false;
    this.checkExpiry(saved);
    const state = await this.state(context),
      leader = this.leader(state, saved.leaderId);
    // A browser-only draft cannot be finalized from cached calendar data offline.
    const snapshot = await this.refresh(context, leader, saved.date);
    this.checkExpiry(saved);
    const profileHash = await hash(leader);
    this.requireConnection(context);
    const selectable =
      saved.draft.compositionMode === "calendar"
        ? isCalendarSelectable
        : isSelectable;
    if (
      profileHash !== saved.profileHash ||
      saved.draft.templateVersion !== TEMPLATE_VERSION ||
      snapshot.hash !== saved.snapshotHash ||
      saved.eventIds.some(
        (eventId) =>
          !snapshot.events.some(
            (event) =>
              event.id === eventId &&
              event.revision === saved.revisions[eventId] &&
              selectable(event),
          ),
      )
    )
      fail(
        "Data agenda, profil, atau pelengkap telah berubah. Perbarui pesan dan periksa lagi.",
        409,
        { snapshot, code: "DRAFT_CHANGED" },
      );
    if (body.contentHash !== saved.draft.contentHash)
      fail("Versi pratinjau berbeda. Perbarui pesan.", 409, {
        code: "DRAFT_CHANGED",
      });
    if (saved.draft.errors.length)
      fail("Lengkapi kesalahan wajib sebelum menyalin pesan.", 422, {
        errors: saved.draft.errors,
      });
    const acknowledged = body.acknowledgedWarnings;
    if (
      !Array.isArray(acknowledged) ||
      acknowledged.some((value) => typeof value !== "string") ||
      body.confirmed !== true ||
      saved.draft.warnings.some((issue) => !acknowledged.includes(issue.id))
    )
      fail("Akui semua peringatan dan konfirmasikan pemeriksaan isi pesan.");
    saved.draft.readyToCopy = true;
    return {
      readyToCopy: true,
      contentHash: saved.draft.contentHash,
      expiresAt: saved.draft.expiresAt,
    };
  }

  private async saveLeader(
    context: Context,
    input: unknown,
  ): Promise<{ leaders: BrowserLeader[] }> {
    const next = profile(input);
    const state = await this.storage.update(context.key, (existing) => {
      this.assertContext(context);
      const state = existing ?? this.emptyState(context);
      const index = state.leaders.findIndex((item) => item.id === next.id);
      if (index < 0) {
        if (next.revision !== 1)
          fail("Profil baru harus menggunakan revisi 1.");
        if (state.leaders.length >= MAX_PROFILES)
          fail("Maksimum 100 profil pimpinan.");
        state.leaders.push(next);
      } else {
        const previous = state.leaders[index];
        if (next.revision !== previous.revision + 1)
          fail(
            "Profil diperbarui pada tab lain. Tutup pengaturan lalu buka kembali.",
            409,
          );
        if (
          previous.calendarId !== next.calendarId &&
          state.supplements.some((item) => item.leaderId === previous.id)
        )
          fail(
            "Profil ini sudah memiliki pelengkap tersimpan. Buat profil baru untuk kalender yang berbeda.",
            409,
          );
        state.leaders[index] = next;
      }
      checkStorageSize(state);
      return state;
    });
    this.assertContext(context);
    this.snapshots.clear();
    this.drafts.clear();
    return { leaders: state.leaders };
  }

  private validateBackup(input: unknown, context: Context): BrowserBackup {
    let size: number;
    try {
      size = new TextEncoder().encode(JSON.stringify(input)).byteLength;
    } catch {
      fail("Berkas cadangan tidak valid.");
    }
    if (size > MAX_BACKUP_BYTES) fail("Ukuran cadangan melebihi batas 5 MB.");
    if (
      !object(input) ||
      !onlyKeys(input, [
        "format",
        "version",
        "exportedAt",
        "account",
        "leaders",
        "supplements",
      ]) ||
      input.format !== "pesan-agenda-browser" ||
      input.version !== 1 ||
      !iso(input.exportedAt) ||
      !object(input.account) ||
      !onlyKeys(input.account, ["id", "email"]) ||
      !text(input.account.id) ||
      !text(input.account.email) ||
      !Array.isArray(input.leaders) ||
      input.leaders.length > MAX_PROFILES ||
      !Array.isArray(input.supplements) ||
      input.supplements.length > MAX_SUPPLEMENTS
    )
      fail("Format atau versi cadangan tidak didukung.");
    if (
      input.account.id !== context.user.id ||
      input.account.email.toLowerCase() !== context.user.email.toLowerCase()
    )
      fail(
        "Cadangan ini milik akun lain. Hubungkan akun Google yang sama dengan pemilik cadangan.",
        403,
      );
    const leaders = input.leaders.map((item) => profile(item));
    if (new Set(leaders.map((item) => item.id)).size !== leaders.length)
      fail("Cadangan berisi ID profil ganda.");
    const supplements = input.supplements.map((item) => {
      if (
        !object(item) ||
        !onlyKeys(item, [
          "leaderId",
          "calendarId",
          "eventId",
          "value",
          "revision",
          "reviewedSourceVersion",
          "sourceVersionAtSave",
          "updatedAt",
        ]) ||
        !text(item.leaderId, 128) ||
        !text(item.calendarId) ||
        !text(item.eventId) ||
        !Number.isSafeInteger(item.revision) ||
        Number(item.revision) < 1 ||
        typeof item.reviewedSourceVersion !== "string" ||
        item.reviewedSourceVersion.length > 1024 ||
        !text(item.sourceVersionAtSave) ||
        !iso(item.updatedAt) ||
        !leaders.some(
          (leader) =>
            leader.id === item.leaderId &&
            leader.calendarId === item.calendarId,
        ) ||
        validateSupplement(item.value).length
      )
        fail("Cadangan berisi pelengkap atau relasi profil yang tidak valid.");
      return structuredClone(item) as unknown as StoredSupplement;
    });
    if (new Set(supplements.map(supplementalKey)).size !== supplements.length)
      fail("Cadangan berisi pelengkap ganda.");
    return {
      format: "pesan-agenda-browser",
      version: 1,
      exportedAt: input.exportedAt,
      account: { id: input.account.id, email: input.account.email },
      leaders,
      supplements,
    };
  }

  private async importBackup(
    context: Context,
    input: unknown,
  ): Promise<{ leaders: BrowserLeader[] }> {
    const backup = this.validateBackup(input, context);
    const state = await this.storage.update(context.key, (existing) => {
      this.assertContext(context);
      const state = existing ?? this.emptyState(context);
      for (const leader of backup.leaders) {
        const current = state.leaders.find((item) => item.id === leader.id);
        if (current && !same(current, leader))
          fail(
            "Cadangan bertentangan dengan profil yang tersimpan. Tidak ada data yang diimpor.",
            409,
          );
        if (!current) state.leaders.push(leader);
      }
      for (const supplement of backup.supplements) {
        const current = state.supplements.find(
          (item) => supplementalKey(item) === supplementalKey(supplement),
        );
        if (current && !same(current, supplement))
          fail(
            "Cadangan bertentangan dengan pelengkap yang tersimpan. Tidak ada data yang diimpor.",
            409,
          );
        if (!current) state.supplements.push(supplement);
      }
      if (
        state.leaders.length > MAX_PROFILES ||
        state.supplements.length > MAX_SUPPLEMENTS
      )
        fail("Gabungan cadangan melebihi kapasitas profil atau pelengkap.");
      checkStorageSize(state);
      return state;
    });
    this.assertContext(context);
    this.snapshots.clear();
    this.drafts.clear();
    return { leaders: state.leaders };
  }

  async request<T>(url: string, input?: unknown, method?: string): Promise<T> {
    const result = await this.route(
      url,
      input,
      method ?? (input === undefined ? "GET" : "POST"),
    );
    return structuredClone(result) as T;
  }

  private async route(
    url: string,
    input: unknown,
    method: string,
  ): Promise<unknown> {
    const parsed = new URL(url, "https://pesan-agenda.invalid"),
      path = parsed.pathname;
    if (path === "/api/google/connect" && method === "POST")
      return this.connect();
    await this.initialize();
    const body = object(input) ? input : {};
    if (path === "/api/session" && method === "GET") return this.session();
    if (path === "/api/auth/demo" && method === "POST") {
      await this.storage.rememberUser(null);
      this.generation++;
      this.gateway.forget();
      this.clearVolatile();
      this.currentUser = structuredClone(DEMO_USER);
      this.demo = true;
      return this.session();
    }
    if (
      (path === "/api/auth/logout" || path === "/api/google/disconnect") &&
      method === "POST"
    ) {
      // Finish local disconnect even if Google's revocation endpoint cannot be reached.
      this.generation++;
      this.clearVolatile();
      this.currentUser = null;
      this.demo = false;
      const revocation =
        path === "/api/google/disconnect"
          ? this.gateway.disconnect()
          : Promise.resolve(this.gateway.forget());
      await this.storage.rememberUser(null);
      await revocation.catch(() => undefined);
      return this.session();
    }
    if (path === "/api/auth/login")
      fail(
        "Versi GitHub Pages menggunakan tombol Hubungkan Google, tanpa kata sandi aplikasi.",
      );
    const context = this.context();
    if (path === "/api/google/status" && method === "GET")
      return {
        configured: this.gateway.configured,
        connected: this.demo || this.connected(),
      };
    if (path === "/api/leaders" && method === "GET")
      return { leaders: (await this.state(context)).leaders };
    if (path === "/api/browser/settings" && method === "GET") {
      const state = await this.state(context);
      return {
        leaders: state.leaders,
        calendars: context.demo
          ? state.leaders.map((leader) => ({
              id: leader.calendarId,
              summary: leader.calendarName,
              timeZone: leader.timeZone,
              accessRole: "owner",
            }))
          : this.calendarOptions,
        accountEmail: context.user.email,
      };
    }
    if (path === "/api/browser/leaders" && method === "POST")
      return this.saveLeader(context, input);
    if (path === "/api/browser/backup/export" && method === "POST") {
      const state = await this.state(context);
      return {
        backup: {
          format: "pesan-agenda-browser",
          version: 1,
          exportedAt: new Date(this.now()).toISOString(),
          account: state.account,
          leaders: state.leaders,
          supplements: state.supplements,
        } satisfies BrowserBackup,
      };
    }
    if (path === "/api/browser/backup/import" && method === "POST")
      return this.importBackup(context, body.backup);
    if (path === "/api/agenda/refresh" && method === "POST") {
      const state = await this.state(context);
      return this.refresh(
        context,
        this.leader(state, body.leaderId),
        validDate(body.date),
      );
    }
    if (path === "/api/agenda" && method === "GET") {
      const state = await this.state(context);
      return this.cached(
        context,
        state,
        this.leader(state, parsed.searchParams.get("leaderId")),
        validDate(parsed.searchParams.get("date")),
      );
    }
    const supplement = /^\/api\/agenda\/([^/]+)\/supplement$/.exec(path);
    if (supplement && method === "PATCH")
      return this.saveSupplement(
        context,
        decodeURIComponent(supplement[1]),
        body,
      );
    if (path === "/api/messages/prepare" && method === "POST")
      return this.prepare(context, body);
    const message = /^\/api\/messages\/([^/]+)\/(review|copy-result)$/.exec(
      path,
    );
    if (message && method === "POST") {
      const id = decodeURIComponent(message[1]);
      if (message[2] === "review") return this.review(context, id, body);
      const saved = this.loadDraft(context, id);
      if (!["success", "failed", "manual"].includes(String(body.outcome)))
        fail("Hasil penyalinan tidak valid.");
      if (!saved.draft.readyToCopy)
        fail("Draf belum diperiksa dan belum dapat disalin.");
      // No durable audit is claimed by this single-browser edition.
      return { recorded: false, storageMode: "browser" };
    }
    fail("Fungsi tidak tersedia pada versi browser.", 404);
  }
}

let runtime: BrowserRuntime | undefined;
export function browserApi<T>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  runtime ??= new BrowserRuntime({
    gateway: new BrowserGoogle(import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? ""),
  });
  return runtime.request<T>(url, body, method);
}
