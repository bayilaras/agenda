import { ApiError } from "../api-error";

export type CalendarApiContext =
  "calendar-list" | "primary-calendar" | "events";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function reasons(body: unknown): Set<string> {
  const error = record(record(body)?.error);
  const result = new Set<string>();
  for (const group of [error?.errors, error?.details]) {
    if (!Array.isArray(group)) continue;
    for (const item of group) {
      const reason = record(item)?.reason;
      if (typeof reason === "string") result.add(reason);
    }
  }
  return result;
}

const accessMessages: Record<CalendarApiContext, string> = {
  "calendar-list":
    "Daftar kalender akun Google belum dapat dibaca. Periksa izin aplikasi Google Calendar, lalu hubungkan ulang akun Google.",
  "primary-calendar":
    "Kalender utama akun Google belum dapat dibaca. Periksa akses Google Calendar pada akun tersebut, lalu hubungkan ulang.",
  events:
    "Akses kalender ditolak. Periksa izin akun Google untuk kalender yang dipilih.",
};

const notFoundMessages: Record<CalendarApiContext, string> = {
  "calendar-list":
    "Daftar kalender akun Google tidak ditemukan atau tidak dapat diakses. Buka Google Calendar dengan akun tersebut, lalu hubungkan ulang.",
  "primary-calendar":
    "Kalender utama akun Google tidak ditemukan atau tidak dapat diakses. Buka Google Calendar dengan akun tersebut, lalu hubungkan ulang.",
  events:
    "Kalender yang dipilih tidak ditemukan atau tidak dapat diakses. Pilih ulang kalender yang tersedia untuk akun Google Anda.",
};

/** Only fixed messages and allowlisted codes may leave the Google error boundary. */
export function calendarApiError(
  status: number,
  body: unknown,
  context: CalendarApiContext,
): ApiError {
  const reasonSet = reasons(body);
  const has = (...values: string[]) =>
    values.some((value) => reasonSet.has(value));
  const error = (message: string, code: string, appStatus: number) =>
    new ApiError(message, appStatus, { code, httpStatus: status });

  if (status === 401)
    return error(
      "Sesi Google berakhir atau dicabut. Hubungkan ulang akun Google untuk melanjutkan.",
      "GOOGLE_RECONNECT",
      401,
    );

  if (
    status === 429 ||
    has(
      "rateLimitExceeded",
      "userRateLimitExceeded",
      "dailyLimitExceeded",
      "quotaExceeded",
      "RATE_LIMIT_EXCEEDED",
      "QUOTA_EXCEEDED",
    )
  )
    return error(
      "Batas permintaan Google Calendar sementara tercapai. Tunggu beberapa saat, lalu coba lagi.",
      "GOOGLE_UNAVAILABLE",
      503,
    );

  if (has("accessNotConfigured", "SERVICE_DISABLED"))
    return error(
      "Google Calendar API belum diaktifkan pada proyek OAuth aplikasi. Aktifkan Google Calendar API di Google Cloud Console pada proyek Client ID ini, tunggu beberapa menit, lalu hubungkan ulang.",
      "GOOGLE_API_DISABLED",
      503,
    );

  if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT"))
    return error(
      "Izin baca Google Calendar belum lengkap. Hubungkan ulang akun Google dan izinkan pembacaan kegiatan serta daftar kalender.",
      "GOOGLE_SCOPE_DENIED",
      403,
    );

  if (has("domainPolicy", "admin_policy_enforced"))
    return error(
      "Kebijakan organisasi Google membatasi akses aplikasi ini ke kalender. Periksa kebijakan akses aplikasi pada akun organisasi Anda.",
      "GOOGLE_ADMIN_POLICY",
      403,
    );

  if (status === 404)
    return error(notFoundMessages[context], "GOOGLE_CALENDAR_NOT_FOUND", 404);

  if (status === 403)
    return error(accessMessages[context], "GOOGLE_ACCESS_DENIED", 403);

  return error(
    "Google Calendar sementara belum tersedia. Coba lagi setelah beberapa saat.",
    "GOOGLE_UNAVAILABLE",
    503,
  );
}
