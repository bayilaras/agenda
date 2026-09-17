import { ApiError } from "../api-error";

export function GoogleConnectionError({ error }: { error: Error }) {
  const code = error instanceof ApiError ? error.data.code : undefined;
  const httpStatus = error instanceof ApiError ? error.data.httpStatus : undefined;
  const diagnostic = typeof code === "string" && /^GOOGLE_[A-Z_]+$/.test(code)
    ? code : undefined;
  return (
    <div className="alert error google-connection-error" role="alert">
      <p>{error.message}</p>
      {code === "GOOGLE_API_DISABLED" && (
        <>
          <a className="button secondary small" target="_blank" rel="noopener noreferrer"
            href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com">
            Buka Google Calendar API
          </a>
          <p>Pilih proyek yang memiliki Client ID aplikasi ini, klik Enable / Aktifkan,
            lalu tunggu beberapa saat dan hubungkan kembali.</p>
        </>
      )}
      {code === "GOOGLE_SCOPE_DENIED" && (
        <p>Klik Hubungkan Google Calendar lagi, lalu setujui kedua izin baca:
          kegiatan dan daftar kalender.</p>
      )}
      {code === "GOOGLE_CALENDAR_NOT_FOUND" && (
        <a target="_blank" rel="noopener noreferrer" href="https://calendar.google.com/">
          Periksa kalender dengan akun Google yang sama
        </a>
      )}
      {diagnostic && (
        <details>
          <summary>Detail diagnosis</summary>
          <code>{diagnostic}{typeof httpStatus === "number" ? ` · HTTP ${httpStatus}` : ""}</code>
        </details>
      )}
    </div>
  );
}
