import { DateTime } from "luxon";
import { setTimeout as delay } from "node:timers/promises";
import {
  conferencePlatform,
  emptySupplement,
  extractMeetingAccess,
  parseDescription,
  sortEvents,
} from "../shared/domain.ts";
import type { AgendaEvent } from "../shared/types.ts";
import type { AppConfig, ConfigLeader } from "./config.ts";
import { hash, Store } from "./storage.ts";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  expiresAt: number;
  scope: string;
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
function safeHttps(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? value
      : "";
  } catch {
    return "";
  }
}

export function mapGoogleEvent(
  source: GoogleEvent,
  leader: ConfigLeader,
  accessRole = "reader",
): AgendaEvent {
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
    accessRole === "freeBusyReader" ||
    accessRole === "none" ||
    (source.visibility === "private" &&
      !["owner", "writer"].includes(accessRole));
  // Keep source HTML as an inert string. Parse exactly once when extracting candidates;
  // reparsing decoded text can corrupt literal credential characters such as < or >.
  const description = redacted ? "" : (source.description ?? "");
  const event: AgendaEvent = {
    id: hash(`${leader.calendarId}:${identity}`).slice(0, 40),
    sourceTitle: redacted
      ? "Waktu sibuk — detail tidak tersedia"
      : (source.summary ?? ""),
    description,
    start: source.start?.dateTime || source.start?.date || "",
    end: source.end?.dateTime || source.end?.date || "",
    allDay: Boolean(source.start?.date),
    endTimeUnspecified: source.endTimeUnspecified ?? false,
    sourceLocation: redacted ? "" : (source.location ?? ""),
    htmlLink: safeHttps(source.htmlLink),
    sourceVersion: hash({
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
    conflicts: redacted
      ? []
      : parseDescription(source.description ?? "").conflicts,
  };
  event.supplement = emptySupplement(event);
  if (!redacted) {
    const descriptionAccess = extractMeetingAccess(description);
    event.conflicts = [
      ...new Set([...event.conflicts, ...descriptionAccess.conflicts]),
    ];
    const candidates: {
      field: "meetingUrl" | "meetingId" | "passcode";
      value: string;
      origin: string;
    }[] = [];
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
    // Values remain explicit candidates. A Google conference code is never assumed to be a Zoom ID.
    Object.assign(event, {
      sourceCandidates: allCandidates.filter(
        (candidate, index) =>
          allCandidates.findIndex(
            (item) =>
              item.field === candidate.field && item.value === candidate.value,
          ) === index,
      ),
    });
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
        event
          .sourceCandidates!.filter(
            (candidate) => candidate.field === "meetingUrl",
          )
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
        event.supplement.platform =
          source.conferenceData.conferenceSolution.name;
    }
    event.sourceAttachments = (source.attachments ?? [])
      .map((item) => ({
        title: item.title ?? "",
        url: safeHttps(item.fileUrl),
      }))
      .filter((item) => item.url);
    event.supplement.materialLinks = event.sourceAttachments.map((item) => ({
      ...item,
    }));
    if (event.supplement.materialLinks.length)
      event.supplement.materialsStatus = "unchecked";
  }
  return event;
}

export class GoogleCalendar {
  constructor(
    private config: AppConfig,
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}
  configured(): boolean {
    return Boolean(
      this.config.googleClientId &&
      this.config.googleClientSecret &&
      this.config.googleRedirectUri,
    );
  }
  connected(): boolean {
    return (
      this.configured() &&
      Boolean(this.store.get<Tokens>("google", "tokens")?.refresh_token)
    );
  }
  authorizationUrl(state: string): string {
    if (!this.configured())
      throw new HttpError(
        503,
        "Koneksi Google belum dikonfigurasi. Hubungi administrator.",
      );
    const params = new URLSearchParams({
      client_id: this.config.googleClientId,
      redirect_uri: this.config.googleRedirectUri,
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: GOOGLE_SCOPES.join(" "),
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }
  private async request(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    retry = true,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(url, { ...init, signal });
      } catch {
        if (signal.aborted || !retry || attempt >= 2)
          throw new HttpError(
            503,
            "Kalender belum berhasil diperiksa. Koneksi melewati batas waktu atau tidak tersedia; coba lagi.",
          );
        await delay(250 * 2 ** attempt, undefined, { signal }).catch(() => {
          throw new HttpError(
            503,
            "Pemeriksaan kalender melewati batas waktu 20 detik.",
          );
        });
        continue;
      }
      const quotaDenied =
        response.status === 403 &&
        (await response
          .clone()
          .json()
          .then(
            (body: { error?: { errors?: { reason?: string }[] } }) =>
              body.error?.errors?.some((item) =>
                ["rateLimitExceeded", "userRateLimitExceeded"].includes(
                  item.reason ?? "",
                ),
              ) ?? false,
          )
          .catch(() => false));
      if (
        retry &&
        (quotaDenied || [429, 500, 502, 503, 504].includes(response.status)) &&
        attempt < 2
      ) {
        await response.body?.cancel();
        await delay(
          300 * 2 ** attempt + Math.floor(Math.random() * 150),
          undefined,
          { signal },
        ).catch(() => {
          throw new HttpError(
            503,
            "Pemeriksaan kalender melewati batas waktu 20 detik.",
          );
        });
        continue;
      }
      return response;
    }
  }
  async exchangeCode(code: string): Promise<void> {
    const response = await this.request(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: this.config.googleClientId,
          client_secret: this.config.googleClientSecret,
          redirect_uri: this.config.googleRedirectUri,
          grant_type: "authorization_code",
        }),
      },
      AbortSignal.timeout(20_000),
      false,
    );
    if (!response.ok)
      throw new HttpError(
        503,
        "Persetujuan Google tidak berhasil. Silakan hubungkan ulang.",
      );
    const body = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (
      !body.access_token ||
      !body.refresh_token ||
      !GOOGLE_SCOPES.every((scope) => body.scope?.split(" ").includes(scope))
    )
      throw new HttpError(
        503,
        "Izin baca acara dan daftar kalender belum lengkap. Hubungkan ulang dengan kedua izin.",
      );
    this.store.set("google", "tokens", {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expiresAt: this.config.now() + (body.expires_in ?? 3600) * 1000,
      scope: body.scope,
    });
  }
  private async accessToken(signal: AbortSignal): Promise<string> {
    const token = this.store.get<Tokens>("google", "tokens");
    if (!this.configured() || !token)
      throw new HttpError(
        503,
        "Kalender belum dihubungkan. Hubungi administrator.",
        { code: "GOOGLE_DISCONNECTED" },
      );
    if (token.expiresAt > this.config.now() + 60_000) return token.access_token;
    const response = await this.request(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.googleClientId,
          client_secret: this.config.googleClientSecret,
          refresh_token: token.refresh_token,
          grant_type: "refresh_token",
        }),
      },
      signal,
    );
    if (!response.ok) {
      if ([400, 401].includes(response.status))
        this.store.delete("google", "tokens");
      throw new HttpError(
        503,
        "Akses Google tidak dapat diperbarui. Administrator perlu menghubungkan kembali.",
        { code: "GOOGLE_RECONNECT" },
      );
    }
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
    };
    if (
      !body.access_token ||
      (body.scope &&
        !GOOGLE_SCOPES.every((scope) => body.scope!.split(" ").includes(scope)))
    ) {
      this.store.delete("google", "tokens");
      throw new HttpError(
        503,
        "Izin Google telah berubah. Hubungkan kembali.",
        { code: "GOOGLE_RECONNECT" },
      );
    }
    if (
      this.store.get<Tokens>("google", "tokens")?.refresh_token !==
      token.refresh_token
    )
      throw new HttpError(
        503,
        "Koneksi Google berubah selama pemeriksaan. Muat ulang.",
        { code: "GOOGLE_RECONNECT" },
      );
    this.store.set("google", "tokens", {
      ...token,
      ...body,
      refresh_token: body.refresh_token || token.refresh_token,
      expiresAt: this.config.now() + (body.expires_in ?? 3600) * 1000,
    });
    return body.access_token;
  }
  async events(
    leader: ConfigLeader,
    date: string,
  ): Promise<{ events: AgendaEvent[]; excludedCount: number }> {
    const signal = AbortSignal.timeout(20_000);
    try {
      const token = await this.accessToken(signal);
      const start = DateTime.fromISO(date, { zone: leader.timeZone }).startOf(
        "day",
      );
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
      const pageTokens = new Set<string>();
      let pageToken: string | undefined,
        excludedCount = 0;
      do {
        if (pageToken) {
          if (pageTokens.has(pageToken))
            throw new HttpError(
              503,
              "Paginasi kalender tidak konsisten. Muat ulang.",
            );
          pageTokens.add(pageToken);
          params.set("pageToken", pageToken);
        }
        const response = await this.request(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(leader.calendarId)}/events?${params}`,
          { headers: { Authorization: `Bearer ${token}` } },
          signal,
        );
        if (response.status === 401) {
          this.store.delete("google", "tokens");
          throw new HttpError(
            503,
            "Akses Google dicabut. Hubungkan kembali melalui administrator.",
            { code: "GOOGLE_RECONNECT" },
          );
        }
        if (!response.ok) {
          const quota =
            response.status === 403 &&
            (await response
              .clone()
              .json()
              .then(
                (body: { error?: { errors?: { reason?: string }[] } }) =>
                  body.error?.errors?.some((item) =>
                    ["rateLimitExceeded", "userRateLimitExceeded"].includes(
                      item.reason ?? "",
                    ),
                  ) ?? false,
              )
              .catch(() => false));
          throw new HttpError(
            503,
            "Kalender belum berhasil diperiksa. Periksa izin kalender dan coba lagi.",
            [403, 404].includes(response.status) && !quota
              ? { code: "GOOGLE_ACCESS_DENIED" }
              : {},
          );
        }
        const body = (await response.json()) as {
          items?: GoogleEvent[];
          nextPageToken?: string;
          accessRole?: string;
        };
        if (body.items !== undefined && !Array.isArray(body.items))
          throw new HttpError(
            503,
            "Respons kalender tidak lengkap. Muat ulang.",
          );
        for (const source of body.items ?? []) {
          if (!source.id)
            throw new HttpError(
              503,
              "Identitas acara kalender tidak lengkap. Muat ulang.",
            );
          if (
            source.eventType &&
            !["default", "fromGmail"].includes(source.eventType)
          ) {
            excludedCount++;
            continue;
          }
          const event = mapGoogleEvent(source, leader, body.accessRole);
          events.set(event.id, event);
        }
        pageToken = body.nextPageToken;
      } while (pageToken);
      if (!this.connected())
        throw new HttpError(
          503,
          "Koneksi Google terputus selama pemeriksaan. Hubungkan kembali.",
          { code: "GOOGLE_RECONNECT" },
        );
      return { events: sortEvents([...events.values()]), excludedCount };
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(
        503,
        "Kalender belum berhasil diperiksa secara lengkap. Coba lagi.",
      );
    }
  }
  async disconnect(): Promise<void> {
    const token = this.store.get<Tokens>("google", "tokens");
    this.store.delete("google", "tokens");
    if (!token) return;
    const response = await this.request(
      "https://oauth2.googleapis.com/revoke",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: token.refresh_token || token.access_token,
        }),
      },
      AbortSignal.timeout(10_000),
      false,
    );
    if (!response.ok && response.status !== 400)
      throw new HttpError(
        503,
        "Token lokal telah dihapus. Pencabutan di Google belum terkonfirmasi; cabut akses melalui Akun Google.",
      );
  }
}
