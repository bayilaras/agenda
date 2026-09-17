import { DateTime } from "luxon";
import {
  conferencePlatform,
  emptySupplement,
  extractMeetingAccess,
  parseDescription,
  sortEvents,
} from "../../shared/domain";
import type { AgendaEvent, User } from "../../shared/types";
import { ApiError } from "../api-error";
import { calendarApiError } from "./google-errors";
import type {
  BrowserGoogleSession,
  BrowserLeader,
  CalendarGateway,
  CalendarOption,
} from "./types";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
}
export interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: (error: { type?: string }) => void;
  }): { requestAccessToken(config: { prompt: string }): void };
  revoke(
    token: string,
    callback: (response: { successful?: boolean; error?: string }) => void,
  ): void;
}
interface BrowserGoogleDependencies {
  fetcher?: typeof fetch;
  now?: () => number;
  oauth2?: GoogleOAuth2;
  loadLibrary?: () => Promise<void>;
  requestTimeoutMs?: number;
  popupTimeoutMs?: number;
  maxPages?: number;
}
interface GoogleEvent {
  id: string;
  etag?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  endTimeUnspecified?: boolean;
  recurringEventId?: string;
  originalStartTime?: { date?: string; dateTime?: string };
  visibility?: string;
  status?: string;
  eventType?: string;
  conferenceData?: {
    conferenceSolution?: { name?: string };
    entryPoints?: {
      entryPointType?: string;
      uri?: string;
      meetingCode?: string;
      passcode?: string;
      password?: string;
    }[];
  };
  hangoutLink?: string;
  attachments?: { title?: string; fileUrl?: string }[];
}

const LIBRARY_URL = "https://accounts.google.com/gsi/client";
const API_URL = "https://www.googleapis.com/calendar/v3";
const CALENDAR_FIELDS = "id,summary,timeZone,accessRole,primary";
let libraryPromise: Promise<void> | undefined;
function currentOAuth(): GoogleOAuth2 | undefined {
  return (
    globalThis as typeof globalThis & {
      google?: { accounts?: { oauth2?: GoogleOAuth2 } };
    }
  ).google?.accounts?.oauth2;
}
function googleError(message: string, code: string, status = 503): ApiError {
  return new ApiError(message, status, { code });
}
function reconnectError(): ApiError {
  return googleError(
    "Sesi Google berakhir atau berubah. Klik Hubungkan Google Calendar untuk melanjutkan.",
    "GOOGLE_RECONNECT",
    401,
  );
}
function incompleteError(): ApiError {
  return googleError(
    "Respons Google Calendar belum lengkap. Coba muat ulang kalender.",
    "GOOGLE_INCOMPLETE",
  );
}
function loadGoogleLibrary(): Promise<void> {
  if (currentOAuth()) return Promise.resolve();
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(
        googleError(
          "Layanan masuk Google hanya tersedia di browser.",
          "GOOGLE_LIBRARY_UNAVAILABLE",
        ),
      );
      return;
    }
    const script = document.createElement("script");
    script.src = LIBRARY_URL;
    script.async = true;
    script.defer = true;
    const finish = (error?: ApiError) => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const timer = setTimeout(
      () =>
        finish(
          googleError(
            "Layanan masuk Google belum termuat. Periksa koneksi lalu coba lagi.",
            "GOOGLE_LIBRARY_UNAVAILABLE",
          ),
        ),
      15_000,
    );
    script.onload = () =>
      finish(
        currentOAuth()
          ? undefined
          : googleError(
              "Layanan masuk Google tidak tersedia. Muat ulang halaman.",
              "GOOGLE_LIBRARY_UNAVAILABLE",
            ),
      );
    script.onerror = () =>
      finish(
        googleError(
          "Layanan masuk Google gagal dimuat. Periksa koneksi atau pemblokir konten.",
          "GOOGLE_LIBRARY_UNAVAILABLE",
        ),
      );
    document.head.append(script);
  }).catch((error: unknown) => {
    libraryPromise = undefined;
    throw error;
  });
  return libraryPromise;
}
async function hash(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
  const result = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
function safeHttps(value: string | undefined): string {
  if (!value || value.trim() !== value || /[\r\n]/.test(value)) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? value
      : "";
  } catch {
    return "";
  }
}

/** Source HTML stays inert until the shared parser decodes credentials once. */
export async function mapBrowserGoogleEvent(
  source: GoogleEvent,
  leader: BrowserLeader,
  accessRole = "reader",
): Promise<AgendaEvent> {
  const originalStartTime =
    source.originalStartTime?.dateTime || source.originalStartTime?.date;
  const originalInstant = source.originalStartTime?.dateTime
    ? DateTime.fromISO(source.originalStartTime.dateTime).toUTC().toISO()
    : originalStartTime;
  const identity =
    source.recurringEventId && originalStartTime
      ? `${source.recurringEventId}:${originalInstant || originalStartTime}`
      : source.id;
  const redacted =
    !["reader", "writer", "owner"].includes(accessRole) ||
    (source.visibility === "private" &&
      !["owner", "writer"].includes(accessRole));
  const description = redacted ? "" : (source.description ?? "");
  const event: AgendaEvent = {
    id: (await hash(`${leader.calendarId}:${identity}`)).slice(0, 40),
    sourceTitle: redacted
      ? "Waktu sibuk — detail tidak tersedia"
      : (source.summary ?? ""),
    description,
    start: source.start?.dateTime || source.start?.date || "",
    end: source.end?.dateTime || source.end?.date || "",
    allDay: Boolean(source.start?.date),
    endTimeUnspecified: source.endTimeUnspecified ?? false,
    sourceLocation: redacted ? "" : (source.location ?? ""),
    htmlLink: redacted ? "" : safeHttps(source.htmlLink),
    sourceVersion: await hash({
      etag: source.etag,
      updated: source.updated,
      id: source.id,
      summary: source.summary,
      description,
      start: source.start,
      end: source.end,
      endTimeUnspecified: source.endTimeUnspecified,
      status: source.status,
      eventType: source.eventType,
      location: source.location,
      conference: source.conferenceData,
      hangoutLink: source.hangoutLink,
      attachments: source.attachments,
      readable: !redacted,
    }),
    status:
      source.status === "cancelled"
        ? "cancelled"
        : source.status === "tentative"
          ? "tentative"
          : "confirmed",
    readable: !redacted,
    recurringEventId: source.recurringEventId,
    originalStartTime,
    supplement: {} as AgendaEvent["supplement"],
    revision: 0,
    reviewedSourceVersion: "",
    conflicts: redacted ? [] : parseDescription(description).conflicts,
  };
  event.supplement = emptySupplement(event);
  if (redacted) return event;
  const descriptionAccess = extractMeetingAccess(description);
  event.conflicts = [
    ...new Set([...event.conflicts, ...descriptionAccess.conflicts]),
  ];
  const candidates: NonNullable<AgendaEvent["sourceCandidates"]> = [];
  const origin = `Konferensi Google${source.conferenceData?.conferenceSolution?.name ? ` · ${source.conferenceData.conferenceSolution.name}` : ""}`;
  for (const entry of source.conferenceData?.entryPoints ?? []) {
    if (entry.entryPointType !== "video") continue;
    if (safeHttps(entry.uri))
      candidates.push({ field: "meetingUrl", value: entry.uri!, origin });
    if (entry.meetingCode)
      candidates.push({
        field: "meetingId",
        value: entry.meetingCode,
        origin: `${origin} (periksa platform; bukan ID acara)`,
      });
    for (const value of [entry.passcode, entry.password])
      if (value) candidates.push({ field: "passcode", value, origin });
  }
  const hangoutUrl = safeHttps(source.hangoutLink);
  if (hangoutUrl)
    candidates.push({
      field: "meetingUrl",
      value: hangoutUrl,
      origin: "Google Calendar · tautan konferensi",
    });
  const allCandidates = [...descriptionAccess.candidates, ...candidates];
  event.sourceCandidates = allCandidates.filter(
    (candidate, index) =>
      allCandidates.findIndex(
        (item) =>
          item.field === candidate.field && item.value === candidate.value,
      ) === index,
  );
  for (const field of ["meetingId", "passcode"] as const) {
    if (
      candidates.some(
        (candidate) =>
          candidate.field === field &&
          candidate.value !== event.supplement[field],
      )
    )
      event.conflicts.push(
        `Konferensi Google memuat kandidat ${field === "meetingId" ? "ID rapat" : "kode sandi"} yang perlu dibandingkan dengan deskripsi. Pilih nilai sesuai platform dan periksa sumber.`,
      );
  }
  const videos = [
    ...new Set(
      event.sourceCandidates
        .filter((candidate) => candidate.field === "meetingUrl")
        .map((candidate) => safeHttps(candidate.value))
        .filter(Boolean),
    ),
  ];
  if (videos.length === 1 && !event.supplement.meetingUrl)
    event.supplement.meetingUrl = videos[0];
  if (videos.length > 1)
    event.conflicts.push(
      "Sumber memuat beberapa tautan konferensi. Pilih tautan yang benar dan periksa ulang sumber.",
    );
  const platforms = [
    ...new Set(
      [
        ...descriptionAccess.platforms,
        ...videos.map(conferencePlatform),
      ].filter(Boolean),
    ),
  ];
  if (
    platforms.length > 1 &&
    candidates.some((candidate) => candidate.field === "meetingUrl")
  )
    event.conflicts.push(
      "Deskripsi dan konferensi kalender menyebut platform rapat yang berbeda. Pilih platform beserta tautan yang sesuai dan periksa sumber.",
    );
  if (!event.supplement.platform) {
    if (platforms.length === 1) event.supplement.platform = platforms[0];
    else if (
      platforms.length === 0 &&
      source.conferenceData?.conferenceSolution?.name
    )
      event.supplement.platform = source.conferenceData.conferenceSolution.name;
  }
  event.supplement.materialLinks = (source.attachments ?? [])
    .map((item) => ({ title: item.title ?? "", url: safeHttps(item.fileUrl) }))
    .filter((item) => item.url);
  if (event.supplement.materialLinks.length)
    event.supplement.materialsStatus = "unchecked";
  return event;
}

export class BrowserGoogle implements CalendarGateway {
  readonly configured: boolean;
  private token: { value: string; expiresAt: number } | null = null;
  private user: User | null = null;
  private generation = 0;
  private pendingCancel?: () => void;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly requestTimeout: number;
  private readonly popupTimeout: number;
  private readonly maxPages: number;

  constructor(
    private readonly publicClientId: string,
    private readonly dependencies: BrowserGoogleDependencies = {},
  ) {
    this.configured = Boolean(publicClientId.trim());
    // Native browser fetch requires Window as its receiver. Storing it unbound
    // makes this.fetcher(...) fail before sending any Calendar request.
    this.fetcher = dependencies.fetcher ?? globalThis.fetch.bind(globalThis);
    this.now = dependencies.now ?? Date.now;
    this.requestTimeout = dependencies.requestTimeoutMs ?? 20_000;
    this.popupTimeout = dependencies.popupTimeoutMs ?? 120_000;
    this.maxPages = dependencies.maxPages ?? 100;
  }
  private oauth(): GoogleOAuth2 | undefined {
    return this.dependencies.oauth2 ?? currentOAuth();
  }
  async initialize(): Promise<void> {
    if (!this.configured || this.oauth()) return;
    await (this.dependencies.loadLibrary ?? loadGoogleLibrary)();
    if (!this.oauth())
      throw googleError(
        "Layanan masuk Google belum siap. Muat ulang lalu coba lagi.",
        "GOOGLE_LIBRARY_UNAVAILABLE",
      );
  }
  isConnected(): boolean {
    return Boolean(
      this.user && this.token && this.token.expiresAt > this.now(),
    );
  }
  getUser(): User | null {
    return this.user ? { ...this.user } : null;
  }
  forget(): void {
    this.generation++;
    this.token = null;
    this.user = null;
    const cancel = this.pendingCancel;
    this.pendingCancel = undefined;
    cancel?.();
  }
  private accessToken(): string {
    if (!this.token)
      throw googleError(
        "Google Calendar belum dihubungkan. Klik Hubungkan Google Calendar.",
        "GOOGLE_DISCONNECTED",
        401,
      );
    if (this.token.expiresAt <= this.now()) {
      this.token = null;
      throw reconnectError();
    }
    return this.token.value;
  }
  private assertCurrent(generation: number, token: string): void {
    if (this.generation !== generation || this.accessToken() !== token)
      throw reconnectError();
  }

  /** Must run directly in the click handler; never await script loading before opening the popup. */
  connect(): Promise<BrowserGoogleSession> {
    if (!this.configured)
      return Promise.reject(
        googleError(
          "Client ID Google belum dikonfigurasi untuk aplikasi ini.",
          "GOOGLE_NOT_CONFIGURED",
        ),
      );
    const oauth = this.oauth();
    if (!oauth)
      return Promise.reject(
        googleError(
          "Layanan masuk Google belum siap. Tunggu sebentar lalu klik kembali.",
          "GOOGLE_LIBRARY_UNAVAILABLE",
        ),
      );
    this.forget();
    const generation = this.generation;
    return new Promise<BrowserGoogleSession>((resolve, reject) => {
      let settled = false;
      let received = false;
      const finish = (error?: unknown, session?: BrowserGoogleSession) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.generation === generation) {
          this.pendingCancel = undefined;
          if (error) {
            this.token = null;
            this.user = null;
          }
        }
        if (error) reject(error);
        else resolve(session!);
      };
      const timer = setTimeout(
        () =>
          finish(
            googleError(
              "Jendela masuk Google melewati batas waktu. Klik Hubungkan lagi.",
              "GOOGLE_POPUP_TIMEOUT",
            ),
          ),
        this.popupTimeout,
      );
      this.pendingCancel = () => finish(reconnectError());
      try {
        const client = oauth.initTokenClient({
          client_id: this.publicClientId,
          scope: GOOGLE_SCOPES.join(" "),
          include_granted_scopes: false,
          callback: (response) => {
            if (settled || received || this.generation !== generation) return;
            received = true;
            clearTimeout(timer);
            if (response.error) {
              finish(
                googleError(
                  "Persetujuan Google dibatalkan atau ditolak. Hubungkan lagi jika ingin melanjutkan.",
                  "GOOGLE_CONSENT_DENIED",
                  403,
                ),
              );
              return;
            }
            const granted =
              typeof response.scope === "string"
                ? response.scope.split(/\s+/)
                : [];
            if (!GOOGLE_SCOPES.every((scope) => granted.includes(scope))) {
              finish(
                googleError(
                  "Izinkan pembacaan kegiatan dan daftar kalender agar aplikasi dapat bekerja.",
                  "GOOGLE_SCOPE_DENIED",
                  403,
                ),
              );
              return;
            }
            const expiresIn = Number(response.expires_in);
            if (
              typeof response.access_token !== "string" ||
              !response.access_token ||
              !Number.isFinite(expiresIn) ||
              expiresIn <= 0
            ) {
              finish(
                googleError(
                  "Respons masuk Google tidak lengkap. Hubungkan kembali.",
                  "GOOGLE_INVALID_TOKEN",
                ),
              );
              return;
            }
            this.token = {
              value: response.access_token,
              expiresAt: this.now() + expiresIn * 1000,
            };
            void this.openSession(generation, response.access_token).then(
              (session) => finish(undefined, session),
              finish,
            );
          },
          error_callback: (error) => {
            // A popup can report closure after delivering the access token.
            // Calendar loading owns completion once authorization succeeds.
            if (received || settled) return;
            finish(
              googleError(
                error.type === "popup_failed_to_open"
                  ? "Browser memblokir jendela Google. Izinkan popup lalu klik Hubungkan lagi."
                  : "Jendela masuk Google ditutup. Klik Hubungkan lagi untuk melanjutkan.",
                error.type === "popup_failed_to_open"
                  ? "GOOGLE_POPUP_BLOCKED"
                  : "GOOGLE_POPUP_CLOSED",
              ),
            );
          },
        });
        client.requestAccessToken({ prompt: "select_account" });
      } catch {
        finish(
          googleError(
            "Jendela masuk Google tidak berhasil dibuka. Coba lagi.",
            "GOOGLE_POPUP_BLOCKED",
          ),
        );
      }
    });
  }
  private async openSession(
    generation: number,
    token: string,
  ): Promise<BrowserGoogleSession> {
    const calendars = await this.calendars();
    const primary = await this.withDeadline((signal) =>
      this.json(
        `${API_URL}/users/me/calendarList/primary?fields=${CALENDAR_FIELDS}`,
        token,
        generation,
        signal,
      ),
    );
    if (
      typeof primary.id !== "string" ||
      !primary.id ||
      primary.id === "primary" ||
      primary.accessRole !== "owner"
    )
      throw incompleteError();
    const user: User = {
      id: `google-${await hash(primary.id)}`,
      name:
        typeof primary.summary === "string" && primary.summary
          ? primary.summary
          : primary.id,
      email: primary.id.includes("@") ? primary.id : "",
      role: "admin",
    };
    this.assertCurrent(generation, token);
    this.user = user;
    return { user: { ...user }, calendars };
  }
  private async withDeadline<T>(
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeout);
    try {
      const result = await work(controller.signal);
      if (controller.signal.aborted)
        throw new Error("Calendar deadline exceeded");
      return result;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw googleError(
        "Google Calendar belum berhasil diperiksa secara lengkap. Periksa koneksi lalu coba lagi.",
        "GOOGLE_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  private async json(
    url: string,
    token: string,
    generation: number,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    this.assertCurrent(generation, token);
    const response = await this.fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    this.assertCurrent(generation, token);
    if (response.status === 401) {
      this.token = null;
      throw reconnectError();
    }
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const pathname = new URL(url).pathname;
      const context = pathname.endsWith("/calendarList/primary")
        ? "primary-calendar"
        : pathname.endsWith("/calendarList")
          ? "calendar-list"
          : "events";
      throw calendarApiError(response.status, body, context);
    }
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw incompleteError();
    this.assertCurrent(generation, token);
    return body as Record<string, unknown>;
  }
  private nextPage(
    body: Record<string, unknown>,
    seen: Set<string>,
    page: number,
  ): string | undefined {
    const next = body.nextPageToken;
    if (next === undefined || next === "") return undefined;
    if (typeof next !== "string" || seen.has(next) || page + 1 >= this.maxPages)
      throw incompleteError();
    seen.add(next);
    return next;
  }
  async calendars(): Promise<CalendarOption[]> {
    const token = this.accessToken();
    const generation = this.generation;
    return this.withDeadline(async (signal) => {
      const params = new URLSearchParams({
        maxResults: "250",
        showHidden: "true",
        showDeleted: "false",
        fields: `nextPageToken,items(${CALENDAR_FIELDS})`,
      });
      const result = new Map<string, CalendarOption>();
      const seen = new Set<string>();
      for (let page = 0; ; page++) {
        const body = await this.json(
          `${API_URL}/users/me/calendarList?${params}`,
          token,
          generation,
          signal,
        );
        if (body.items !== undefined && !Array.isArray(body.items))
          throw incompleteError();
        for (const raw of (body.items ?? []) as Record<string, unknown>[]) {
          if (
            !raw ||
            typeof raw.id !== "string" ||
            !raw.id ||
            typeof raw.summary !== "string" ||
            typeof raw.accessRole !== "string"
          )
            throw incompleteError();
          if (!["owner", "writer", "reader"].includes(raw.accessRole)) continue;
          if (
            typeof raw.timeZone !== "string" ||
            !DateTime.now().setZone(raw.timeZone).isValid
          )
            throw incompleteError();
          result.set(raw.id, {
            id: raw.id,
            summary: raw.summary,
            timeZone: raw.timeZone,
            accessRole: raw.accessRole,
            primary: raw.primary === true,
          });
        }
        const next = this.nextPage(body, seen, page);
        if (!next) break;
        params.set("pageToken", next);
      }
      this.assertCurrent(generation, token);
      return [...result.values()];
    });
  }
  async events(
    leader: BrowserLeader,
    date: string,
  ): Promise<{ events: AgendaEvent[]; excludedCount: number }> {
    const token = this.accessToken();
    const generation = this.generation;
    const start = DateTime.fromISO(date, { zone: leader.timeZone }).startOf(
      "day",
    );
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !start.isValid ||
      start.toISODate() !== date ||
      !leader.calendarId
    )
      throw googleError(
        "Tanggal, zona waktu, atau kalender belum valid.",
        "GOOGLE_INVALID_CALENDAR",
        403,
      );
    return this.withDeadline(async (signal) => {
      const params = new URLSearchParams({
        timeMin: start.toISO()!,
        timeMax: start.plus({ days: 1 }).toISO()!,
        singleEvents: "true",
        orderBy: "startTime",
        showDeleted: "false",
        maxResults: "2500",
        timeZone: leader.timeZone,
        fields:
          "nextPageToken,accessRole,items(id,etag,updated,summary,description,location,htmlLink,start,end,endTimeUnspecified,recurringEventId,originalStartTime,visibility,status,eventType,conferenceData,hangoutLink,attachments)",
      });
      const events = new Map<string, AgendaEvent>();
      const seen = new Set<string>();
      let excludedCount = 0;
      for (let page = 0; ; page++) {
        const body = await this.json(
          `${API_URL}/calendars/${encodeURIComponent(leader.calendarId)}/events?${params}`,
          token,
          generation,
          signal,
        );
        if (
          (body.items !== undefined && !Array.isArray(body.items)) ||
          typeof body.accessRole !== "string"
        )
          throw incompleteError();
        for (const raw of (body.items ?? []) as GoogleEvent[]) {
          if (!raw || typeof raw.id !== "string" || !raw.id)
            throw incompleteError();
          if (
            raw.eventType &&
            !["default", "fromGmail"].includes(raw.eventType)
          ) {
            excludedCount++;
            continue;
          }
          const mapped = await mapBrowserGoogleEvent(
            raw,
            leader,
            body.accessRole,
          );
          events.set(mapped.id, mapped);
        }
        const next = this.nextPage(body, seen, page);
        if (!next) break;
        params.set("pageToken", next);
      }
      this.assertCurrent(generation, token);
      return { events: sortEvents([...events.values()]), excludedCount };
    });
  }
  async disconnect(): Promise<void> {
    const token = this.token?.value;
    this.forget();
    if (!token) return;
    const oauth = this.oauth();
    const failure = () =>
      googleError(
        "Sesi lokal sudah dihapus. Pencabutan izin belum terkonfirmasi; kelola akses aplikasi di Akun Google.",
        "GOOGLE_REVOKE_UNCONFIRMED",
      );
    if (!oauth) throw failure();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(failure()), this.requestTimeout);
      try {
        oauth.revoke(token, (response) => {
          clearTimeout(timer);
          if (response?.successful || response?.error === "invalid_token")
            resolve();
          else reject(failure());
        });
      } catch {
        clearTimeout(timer);
        reject(failure());
      }
    });
  }
}
