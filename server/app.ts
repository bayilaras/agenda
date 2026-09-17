import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cookieParser from "cookie-parser";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DateTime } from "luxon";
import type {
  AgendaEvent,
  Draft,
  Leader,
  SessionInfo,
  Snapshot,
  Supplement,
  User,
} from "../shared/types.ts";
import {
  generateMessage,
  isSelectable,
  MAX_COPY_AGE_SECONDS,
  MAX_SELECTED_EVENTS,
  sortEvents,
  TEMPLATE_VERSION,
  validateEvents,
  validateSupplement,
} from "../shared/domain.ts";
import {
  type AppConfig,
  type ConfigLeader,
  loadConfig,
  verifyPassword,
} from "./config.ts";
import { demoEvents, demoLeaders } from "./demo.ts";
import { GoogleCalendar, HttpError } from "./google.ts";
import { hash, Store } from "./storage.ts";

interface Session {
  userId: string | null;
  demo: boolean;
  csrfToken: string;
  expiresAt: number;
  oauthState?: string;
  oauthExpiresAt?: number;
}
interface SessionRequest extends Request {
  agendaSession: Session;
  sessionKey: string;
}
interface StoredSupplement {
  value: Supplement;
  revision: number;
  reviewedSourceVersion: string;
  updatedAt: string;
  checkedBy: string;
  sourceVersionAtSave: string;
}
interface StoredDraft {
  draft: Draft;
  owner: string;
  demo: boolean;
  leaderId: string;
  date: string;
  eventIds: string[];
  revisions: Record<string, number>;
  snapshotHash: string;
  profileHash: string;
  acknowledgedWarnings: string[];
}
const demoUser: User = {
  id: "demo-operator",
  name: "Sekretariat",
  email: "sekretariat@demo.local",
  role: "admin",
};
const cookieName = "agenda_session";
const sessionDuration = 8 * 60 * 60 * 1000;
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  id.length > 0 &&
  id.length <= 160 &&
  /^[a-zA-Z0-9_.:@-]+$/.test(id);
function equalToken(a: unknown, b: string): boolean {
  return (
    typeof a === "string" &&
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}

export function createApplication(overrides: Partial<AppConfig> = {}) {
  const config = loadConfig(overrides),
    store = new Store(config.dataDir, config.encryptionKey, config.now);
  const google = new GoogleCalendar(config, store);
  const app = express();
  app.disable("x-powered-by");
  if (config.production) app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    if (config.production)
      res.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    if (config.production)
      res.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
    next();
  });
  app.use(express.json({ limit: "256kb", strict: true }));
  app.use(cookieParser());

  const rate = new Map<string, { count: number; expires: number }>();
  function rateLimit(bucket: string, limit: number, window: number) {
    return (req: Request, res: Response, next: NextFunction) => {
      const key = `${bucket}:${req.ip ?? "unknown"}`,
        now = config.now();
      let entry = rate.get(key);
      if (!entry || entry.expires <= now) {
        entry = { count: 0, expires: now + window };
        rate.set(key, entry);
      }
      if (++entry.count > limit) {
        res.set("Retry-After", String(Math.ceil((entry.expires - now) / 1000)));
        next(
          new HttpError(
            429,
            "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.",
          ),
        );
        return;
      }
      if (rate.size > 5000)
        for (const [id, item] of rate) if (item.expires <= now) rate.delete(id);
      next();
    };
  }
  app.use("/api", rateLimit("api", 240, 60_000));
  function setSessionCookie(res: Response, token: string) {
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      maxAge: sessionDuration,
      path: "/",
    });
  }
  function newSession(
    req: SessionRequest,
    res: Response,
    userId: string | null = null,
    demo = false,
  ) {
    if (req.sessionKey) store.delete("sessions", req.sessionKey);
    const token = randomBytes(32).toString("hex");
    req.sessionKey = hash(token);
    req.agendaSession = {
      userId,
      demo,
      csrfToken: randomBytes(32).toString("hex"),
      expiresAt: config.now() + sessionDuration,
    };
    store.set("sessions", req.sessionKey, req.agendaSession);
    setSessionCookie(res, token);
  }
  app.use("/api", (request, res, next) => {
    const req = request as unknown as SessionRequest;
    const token = req.cookies?.[cookieName];
    if (typeof token === "string" && /^[a-f0-9]{64}$/.test(token)) {
      req.sessionKey = hash(token);
      const session = store.get<Session>("sessions", req.sessionKey);
      if (
        session &&
        session.expiresAt > config.now() &&
        (!session.demo || config.demoEnabled)
      )
        req.agendaSession = session;
    }
    if (!req.agendaSession) newSession(req, res);
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !equalToken(req.get("X-CSRF-Token"), req.agendaSession.csrfToken)
    ) {
      next(
        new HttpError(
          403,
          "Token keamanan tidak valid. Muat ulang halaman lalu coba lagi.",
          { code: "CSRF" },
        ),
      );
      return;
    }
    next();
  });
  function user(req: SessionRequest): User | undefined {
    if (
      req.agendaSession.demo &&
      config.demoEnabled &&
      req.agendaSession.userId === demoUser.id
    )
      return demoUser;
    return config.users.find((item) => item.id === req.agendaSession.userId);
  }
  function sessionInfo(
    req: SessionRequest,
  ): SessionInfo & { demoAvailable: boolean } {
    const current = user(req);
    return {
      user: current
        ? {
            id: current.id,
            name: current.name,
            email: current.email,
            role: current.role,
          }
        : null,
      csrfToken: req.agendaSession.csrfToken,
      demo: req.agendaSession.demo,
      demoAvailable: config.demoEnabled,
      personalMode: config.personalMode,
      googleConfigured: google.configured(),
      connected: req.agendaSession.demo || google.connected(),
    };
  }
  const requireUser = (
    request: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    if (!user(request as unknown as SessionRequest))
      next(new HttpError(401, "Silakan masuk untuk melanjutkan."));
    else next();
  };
  const requireAdmin = (req: SessionRequest) => {
    const current = user(req);
    if (!current || current.role !== "admin")
      throw new HttpError(
        403,
        "Hanya administrator konfigurasi yang dapat mengelola koneksi.",
      );
    return current;
  };
  function allowedLeaders(req: SessionRequest): Leader[] {
    if (req.agendaSession.demo) return demoLeaders;
    const account = config.users.find((item) => item.id === user(req)?.id);
    return config.leaders.filter((leader) =>
      account?.leaderIds.includes(leader.id),
    );
  }
  function leaderFor(req: SessionRequest, id: unknown): Leader {
    if (!validId(id)) throw new HttpError(422, "ID pimpinan tidak valid.");
    const leader = allowedLeaders(req).find((item) => item.id === id);
    if (!leader)
      throw new HttpError(
        403,
        "Anda tidak memiliki akses ke agenda pimpinan ini.",
      );
    return leader;
  }
  function dateFor(input: unknown): string {
    if (
      typeof input !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input) ||
      !DateTime.fromISO(input).isValid
    )
      throw new HttpError(422, "Tanggal harus valid dalam format YYYY-MM-DD.");
    return input;
  }
  function namespace(req: SessionRequest, kind: string): string {
    return `${req.agendaSession.demo ? "demo" : "live"}:${kind}`;
  }
  function supplements(
    req: SessionRequest,
    leader: Leader,
    snapshot: Snapshot,
  ): Snapshot {
    const events = sortEvents(
      snapshot.events.map((event) => {
        const saved = store.get<StoredSupplement>(
          namespace(req, "supplements"),
          `${leader.id}:${event.id}`,
        );
        if (!saved) return event;
        const sourceChanged = saved.sourceVersionAtSave !== event.sourceVersion;
        return {
          ...event,
          supplement: {
            ...saved.value,
            ...(sourceChanged ? { sourceReviewed: false } : {}),
          },
          revision: saved.revision,
          reviewedSourceVersion:
            saved.reviewedSourceVersion ||
            (sourceChanged ? saved.sourceVersionAtSave : ""),
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
  async function refresh(
    req: SessionRequest,
    leader: Leader,
    date: string,
  ): Promise<Snapshot> {
    let events: AgendaEvent[],
      excludedCount = 0;
    try {
      if (req.agendaSession.demo) events = demoEvents(leader, date);
      else {
        const result = await google.events(leader as ConfigLeader, date);
        events = result.events;
        excludedCount = result.excludedCount;
      }
    } catch (error) {
      const accessDenied =
        error instanceof HttpError &&
        error.extra.code === "GOOGLE_ACCESS_DENIED";
      if (accessDenied)
        store.set(namespace(req, "calendar-access"), leader.id, {
          denied: true,
        });
      store.set(namespace(req, "source-state"), `${leader.id}:${date}`, {
        complete: false,
        checkedAt: new Date(config.now()).toISOString(),
      });
      throw error;
    }
    const snapshot: Snapshot = {
      id: randomUUID(),
      leaderId: leader.id,
      date,
      hash: hash(
        events
          .map((event) => [event.id, event.sourceVersion])
          .sort((a, b) => a[0].localeCompare(b[0])),
      ),
      checkedAt: new Date(config.now()).toISOString(),
      events,
      excludedCount:
        excludedCount + events.filter((event) => !isSelectable(event)).length,
      complete: true,
    };
    store.set(namespace(req, "snapshots"), `${leader.id}:${date}`, snapshot);
    store.set(namespace(req, "source-state"), `${leader.id}:${date}`, {
      complete: true,
      checkedAt: snapshot.checkedAt,
    });
    store.set(namespace(req, "calendar-access"), leader.id, { denied: false });
    return supplements(req, leader, snapshot);
  }
  function cached(req: SessionRequest, leader: Leader, date: string): Snapshot {
    if (!req.agendaSession.demo && !google.connected())
      throw new HttpError(
        503,
        "Akses Google tidak tersedia. Administrator perlu menghubungkan kembali.",
        { code: "GOOGLE_DISCONNECTED" },
      );
    const state = store.get<{ complete: boolean }>(
      namespace(req, "source-state"),
      `${leader.id}:${date}`,
    );
    if (
      store.get<{ denied: boolean }>(
        namespace(req, "calendar-access"),
        leader.id,
      )?.denied
    )
      throw new HttpError(
        503,
        "Akses kalender tidak tersedia. Administrator perlu memeriksa izin kalender.",
        { code: "GOOGLE_ACCESS_DENIED" },
      );
    const snapshot = store.get<Snapshot>(
      namespace(req, "snapshots"),
      `${leader.id}:${date}`,
    );
    if (!snapshot)
      throw new HttpError(404, "Agenda belum dimuat. Tekan Muat Ulang.");
    return supplements(req, leader, {
      ...snapshot,
      complete:
        state?.complete !== false &&
        (req.agendaSession.demo || google.connected()),
    });
  }
  function loadDraft(req: SessionRequest, id: string): StoredDraft {
    const draft = store.get<StoredDraft>("drafts", id);
    if (
      !draft ||
      draft.owner !== user(req)?.id ||
      draft.demo !== req.agendaSession.demo
    )
      throw new HttpError(404, "Draf tidak ditemukan.");
    leaderFor(req, draft.leaderId);
    return draft;
  }
  function verifyDraft(req: SessionRequest, saved: StoredDraft): void {
    const leader = leaderFor(req, saved.leaderId);
    if (Date.parse(saved.draft.expiresAt) <= config.now())
      throw new HttpError(
        409,
        "Pesan melewati batas kesegaran 120 detik. Perbarui pesan dan periksa lagi.",
        { code: "DRAFT_EXPIRED" },
      );
    const snapshot = cached(req, leader, saved.date);
    if (!snapshot.complete)
      throw new HttpError(
        503,
        "Kalender belum berhasil diperiksa. Muat ulang sebelum menyalin.",
      );
    const changed =
      saved.profileHash !== hash(leader) ||
      saved.draft.templateVersion !== TEMPLATE_VERSION ||
      saved.snapshotHash !== snapshot.hash ||
      saved.eventIds.some(
        (id) =>
          !snapshot.events.some(
            (event) =>
              event.id === id &&
              event.revision === saved.revisions[id] &&
              isSelectable(event),
          ),
      );
    if (changed)
      throw new HttpError(
        409,
        "Data agenda atau pelengkap telah berubah. Perbarui pesan dan periksa lagi.",
        { snapshot, code: "DRAFT_CHANGED" },
      );
  }

  app.get("/api/session", (req, res) =>
    res.json(sessionInfo(req as SessionRequest)),
  );
  app.post(
    "/api/auth/demo",
    rateLimit("login", 20, 15 * 60_000),
    (request, res) => {
      if (!config.demoEnabled)
        throw new HttpError(
          403,
          "Mode demo tidak tersedia pada lingkungan ini.",
        );
      const req = request as unknown as SessionRequest;
      newSession(req, res, demoUser.id, true);
      store.audit(demoUser.id, "login.demo", "session");
      res.json(sessionInfo(req));
    },
  );
  app.post(
    "/api/auth/login",
    rateLimit("login", 20, 15 * 60_000),
    (request, res) => {
      const req = request as unknown as SessionRequest;
      const { email, password } = req.body ?? {};
      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 320 ||
        password.length > 1024
      )
        throw new HttpError(422, "Email dan kata sandi tidak valid.");
      const account = config.users.find(
        (item) => item.email.toLowerCase() === email.trim().toLowerCase(),
      );
      const passwordMatches = verifyPassword(
        password,
        account?.passwordHash ?? `scrypt:invalid-account:${"0".repeat(128)}`,
      );
      if (!account || !passwordMatches) {
        store.audit("anonymous", "login", "session", [], "failed");
        throw new HttpError(401, "Email atau kata sandi tidak sesuai.");
      }
      newSession(req, res, account.id);
      store.audit(account.id, "login", "session");
      res.json(sessionInfo(req));
    },
  );
  app.post("/api/auth/logout", (request, res) => {
    const req = request as unknown as SessionRequest;
    const current = user(req);
    if (current) store.audit(current.id, "logout", "session");
    newSession(req, res);
    res.json(sessionInfo(req));
  });
  app.use("/api", requireUser);
  app.get("/api/leaders", (request, res) =>
    res.json({
      leaders: allowedLeaders(request as unknown as SessionRequest).map(
        ({
          id,
          name,
          position,
          salutation,
          closing,
          timeZone,
          calendarName,
          revision,
        }) => ({
          id,
          name,
          position,
          salutation,
          closing,
          timeZone,
          calendarName,
          revision,
        }),
      ),
    }),
  );
  app.post("/api/agenda/refresh", async (request, res) => {
    const req = request as unknown as SessionRequest;
    res.json(
      await refresh(
        req,
        leaderFor(req, req.body?.leaderId),
        dateFor(req.body?.date),
      ),
    );
  });
  app.get("/api/agenda", (request, res) => {
    const req = request as unknown as SessionRequest;
    res.json(
      cached(req, leaderFor(req, req.query.leaderId), dateFor(req.query.date)),
    );
  });
  app.patch("/api/agenda/:id/supplement", (request, res) => {
    const req = request as unknown as SessionRequest;
    const leader = leaderFor(req, req.body?.leaderId),
      date = dateFor(req.body?.date);
    const result = store.transaction(() => {
      const snapshot = cached(req, leader, date),
        id = String(req.params.id),
        current = snapshot.events.find((event) => event.id === id);
      if (!current)
        throw new HttpError(
          404,
          "Kemunculan kegiatan tidak ditemukan pada konteks ini. Muat ulang.",
        );
      if (!current.readable || current.status === "cancelled")
        throw new HttpError(
          403,
          "Kegiatan privat atau dibatalkan tidak dapat dilengkapi.",
        );
      if (
        !Number.isInteger(req.body?.expectedRevision) ||
        req.body.expectedRevision < 0
      )
        throw new HttpError(422, "Nomor revisi pelengkap wajib diisi.");
      if (current.revision !== req.body.expectedRevision)
        throw new HttpError(
          409,
          "Pelengkap telah disimpan operator lain. Bandingkan versi terbaru dengan isian Anda.",
          { latest: current },
        );
      const errors = validateSupplement(req.body.supplement);
      if (errors.length)
        throw new HttpError(
          422,
          "Sebagian isian belum valid. Isian Anda tetap tersedia untuk diperbaiki.",
          { errors },
        );
      const value = req.body.supplement as Supplement,
        reviewedSourceVersion = value.sourceReviewed
          ? current.sourceVersion
          : current.reviewedSourceVersion;
      const saved: StoredSupplement = {
        value,
        revision: current.revision + 1,
        reviewedSourceVersion,
        updatedAt: new Date(config.now()).toISOString(),
        checkedBy: user(req)!.id,
        sourceVersionAtSave: current.sourceVersion,
      };
      store.set(namespace(req, "supplements"), `${leader.id}:${id}`, saved);
      const changed = Object.keys(value).filter(
        (key) =>
          JSON.stringify(value[key as keyof Supplement]) !==
          JSON.stringify(current.supplement[key as keyof Supplement]),
      );
      store.audit(
        user(req)!.id,
        "supplement.update",
        `${leader.id}:${id}`,
        changed,
      );
      return {
        ...current,
        supplement: value,
        revision: saved.revision,
        reviewedSourceVersion,
      };
    });
    res.json(result);
  });
  app.post("/api/messages/prepare", async (request, res) => {
    const req = request as unknown as SessionRequest,
      leader = leaderFor(req, req.body?.leaderId),
      date = dateFor(req.body?.date);
    const { eventIds, snapshotHash, revisions } = req.body ?? {};
    if (
      !Array.isArray(eventIds) ||
      !eventIds.length ||
      eventIds.length > MAX_SELECTED_EVENTS ||
      eventIds.some((id) => !validId(id)) ||
      new Set(eventIds).size !== eventIds.length
    )
      throw new HttpError(422, "Pilih 1–20 kegiatan yang berbeda.");
    if (
      typeof snapshotHash !== "string" ||
      !revisions ||
      typeof revisions !== "object" ||
      Array.isArray(revisions) ||
      eventIds.some(
        (id) => !Number.isInteger(revisions[id]) || revisions[id] < 0,
      )
    )
      throw new HttpError(
        422,
        "Versi sumber dan pelengkap wajib dikirim. Muat ulang agenda.",
      );
    const snapshot = await refresh(req, leader, date);
    const events = snapshot.events.filter((event) =>
      eventIds.includes(event.id),
    );
    if (
      snapshotHash !== snapshot.hash ||
      events.length !== eventIds.length ||
      events.some((event) => revisions[event.id] !== event.revision)
    )
      throw new HttpError(
        409,
        "Agenda terbaru berbeda. Periksa kembali kegiatan dan pelengkap sebelum membuat pesan.",
        { snapshot },
      );
    const validation = validateEvents(
      events,
      leader,
      date,
      snapshot.events.filter(isSelectable).length,
    );
    const plainText = generateMessage(events, leader, date),
      contentHash = hash({
        plainText,
        profile: leader,
        eventIds,
        revisions,
        snapshot: snapshot.hash,
        template: TEMPLATE_VERSION,
      });
    const draft: Draft = {
      draftId: randomUUID(),
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
    const saved: StoredDraft = {
      draft,
      owner: user(req)!.id,
      demo: req.agendaSession.demo,
      leaderId: leader.id,
      date,
      eventIds,
      revisions: Object.fromEntries(
        events.map((event) => [event.id, event.revision]),
      ),
      snapshotHash: snapshot.hash,
      profileHash: hash(leader),
      acknowledgedWarnings: [],
    };
    store.set("drafts", draft.draftId, saved);
    store.audit(
      user(req)!.id,
      "draft.prepare",
      draft.draftId,
      [],
      validation.errors.length ? "incomplete" : "success",
    );
    res.json(draft);
  });
  app.post("/api/messages/:id/review", (request, res) => {
    const req = request as unknown as SessionRequest,
      saved = loadDraft(req, String(req.params.id));
    verifyDraft(req, saved);
    const { contentHash, acknowledgedWarnings, confirmed } = req.body ?? {};
    if (contentHash !== saved.draft.contentHash)
      throw new HttpError(409, "Versi pratinjau berbeda. Perbarui pesan.", {
        code: "DRAFT_CHANGED",
      });
    if (saved.draft.errors.length)
      throw new HttpError(
        422,
        "Lengkapi kesalahan wajib sebelum menyalin pesan.",
        { errors: saved.draft.errors },
      );
    if (
      !Array.isArray(acknowledgedWarnings) ||
      acknowledgedWarnings.some((item) => typeof item !== "string") ||
      confirmed !== true ||
      saved.draft.warnings.some(
        (issue) => !acknowledgedWarnings.includes(issue.id),
      )
    )
      throw new HttpError(
        422,
        "Akui semua peringatan dan konfirmasikan pemeriksaan isi pesan.",
      );
    saved.acknowledgedWarnings = acknowledgedWarnings.filter((id) =>
      saved.draft.warnings.some((issue) => issue.id === id),
    );
    saved.draft.readyToCopy = true;
    store.set("drafts", saved.draft.draftId, saved);
    store.audit(user(req)!.id, "draft.review", saved.draft.draftId);
    res.json({
      readyToCopy: true,
      contentHash: saved.draft.contentHash,
      expiresAt: saved.draft.expiresAt,
    });
  });
  app.post("/api/messages/:id/copy-result", (request, res) => {
    const req = request as unknown as SessionRequest,
      saved = loadDraft(req, String(req.params.id));
    const outcome = req.body?.outcome;
    if (!["success", "failed", "manual"].includes(outcome))
      throw new HttpError(422, "Hasil penyalinan tidak valid.");
    if (!saved.draft.readyToCopy)
      throw new HttpError(422, "Draf belum diperiksa dan belum dapat disalin.");
    // A client report is an audit event, never proof of sending or even clipboard contents.
    store.audit(
      user(req)!.id,
      "clipboard.report",
      saved.draft.draftId,
      [],
      outcome,
    );
    res.json({ recorded: true });
  });
  app.get("/api/google/status", (request, res) => {
    const req = request as unknown as SessionRequest;
    requireAdmin(req);
    res.json({
      configured: google.configured(),
      connected: google.connected(),
      demo: req.agendaSession.demo,
    });
  });
  app.get("/api/google/connect", (request, res) => {
    const req = request as unknown as SessionRequest;
    requireAdmin(req);
    if (req.agendaSession.demo)
      throw new HttpError(
        403,
        "Masuk dengan akun administrator terkonfigurasi untuk menghubungkan kalender nyata.",
      );
    const state = randomBytes(32).toString("hex"),
      url = google.authorizationUrl(state);
    req.agendaSession.oauthState = state;
    req.agendaSession.oauthExpiresAt = config.now() + 10 * 60_000;
    store.set("sessions", req.sessionKey, req.agendaSession);
    res.redirect(url);
  });
  app.get("/api/google/callback", async (request, res) => {
    const req = request as unknown as SessionRequest,
      current = requireAdmin(req);
    if (
      req.agendaSession.demo ||
      !req.agendaSession.oauthState ||
      !equalToken(req.query.state, req.agendaSession.oauthState) ||
      (req.agendaSession.oauthExpiresAt ?? 0) < config.now()
    )
      throw new HttpError(
        403,
        "State OAuth tidak valid atau kedaluwarsa. Mulai ulang proses koneksi.",
      );
    delete req.agendaSession.oauthState;
    delete req.agendaSession.oauthExpiresAt;
    store.set("sessions", req.sessionKey, req.agendaSession);
    if (
      req.query.error ||
      typeof req.query.code !== "string" ||
      req.query.code.length > 4096
    ) {
      res.redirect("/pesan-agenda?google=cancelled");
      return;
    }
    await google.exchangeCode(req.query.code);
    store.audit(current.id, "google.connect", "connection");
    res.redirect("/pesan-agenda?google=connected");
  });
  app.post("/api/google/disconnect", async (request, res) => {
    const req = request as unknown as SessionRequest,
      current = requireAdmin(req);
    if (req.agendaSession.demo)
      throw new HttpError(
        403,
        "Mode demo tidak memiliki koneksi Google nyata.",
      );
    try {
      await google.disconnect();
    } finally {
      store.audit(current.id, "google.disconnect", "connection");
    }
    res.json({ connected: false });
  });
  app.use("/api", (_req, _res, next) =>
    next(new HttpError(404, "Endpoint tidak ditemukan.")),
  );
  const dist = resolve("dist");
  if (existsSync(resolve(dist, "index.html"))) {
    app.use(express.static(dist, { etag: false, maxAge: 0 }));
    app.get(["/", "/pesan-agenda"], (_req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof HttpError) {
        res
          .status(error.status)
          .json({ message: error.message, ...error.extra });
        return;
      }
      if (error instanceof SyntaxError) {
        res.status(422).json({ message: "Data permintaan tidak valid." });
        return;
      }
      if (
        typeof error === "object" &&
        error &&
        "type" in error &&
        error.type === "entity.too.large"
      ) {
        res
          .status(422)
          .json({ message: "Ukuran permintaan melewati batas 256 KB." });
        return;
      }
      console.error("[agenda] Permintaan gagal karena kesalahan internal.");
      res.status(500).json({
        message:
          "Terjadi kesalahan internal. Coba kembali; jika berulang, hubungi administrator.",
      });
    },
  );
  return { app, store, config, google };
}

export const { app } = createApplication();
