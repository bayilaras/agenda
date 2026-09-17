import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Download,
  FileJson,
  LoaderCircle,
  Plus,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { IANAZone } from "luxon";
import { api } from "../api";
import type { BrowserLeader, CalendarOption } from "../pages/types";
import "../pages-settings.css";

interface Settings {
  leaders: BrowserLeader[];
  calendars: CalendarOption[];
  accountEmail: string;
}

interface ProfileFields {
  id: string;
  name: string;
  position: string;
  salutation: "Bapak" | "Ibu";
  calendarId: string;
  timeZone: string;
}

interface ImportPreview {
  name: string;
  size: number;
  backup: Record<string, unknown>;
}

function emptyProfile(calendars: CalendarOption[]): ProfileFields {
  const calendar = calendars.length === 1 ? calendars[0] : undefined;
  return {
    id: "",
    name: "",
    position: "",
    salutation: "Bapak",
    calendarId: calendar?.id ?? "",
    timeZone: calendar?.timeZone || "Asia/Jakarta",
  };
}

function profileFields(leader: BrowserLeader): ProfileFields {
  return {
    id: leader.id,
    name: leader.name,
    position: leader.position,
    salutation: leader.salutation,
    calendarId: leader.calendarId,
    timeZone: leader.timeZone,
  };
}

function message(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Permintaan belum berhasil. Silakan coba lagi.";
}

export function BrowserSettings({
  onSaved,
  onClose,
}: {
  onSaved: () => void;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fields, setFields] = useState<ProfileFields>(() => emptyProfile([]));
  const [busy, setBusy] = useState<
    "load" | "save" | "export" | "read" | "import" | null
  >("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const reading = useRef(0);

  useEffect(() => {
    let active = true;
    setBusy("load");
    setError("");
    api<Settings>("/api/browser/settings")
      .then((result) => {
        if (!active) return;
        setSettings(result);
        setFields(
          result.leaders.length
            ? profileFields(result.leaders[0])
            : emptyProfile(result.calendars),
        );
      })
      .catch((cause) => {
        if (active) setError(message(cause));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
      reading.current++;
    };
  }, [loadAttempt]);

  useEffect(() => {
    if (error) noticeRef.current?.focus();
  }, [error]);

  const pending = busy !== null;
  const calendarAvailable = settings?.calendars.some(
    (calendar) => calendar.id === fields.calendarId,
  );

  function chooseProfile(id: string) {
    if (!settings) return;
    const existing = settings.leaders.find((leader) => leader.id === id);
    setFields(
      existing ? profileFields(existing) : emptyProfile(settings.calendars),
    );
    setError("");
    setNotice("");
  }

  function chooseCalendar(id: string) {
    const calendar = settings?.calendars.find((item) => item.id === id);
    setFields((current) => ({
      ...current,
      calendarId: id,
      timeZone: calendar?.timeZone || "Asia/Jakarta",
    }));
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || pending) return;
    setError("");
    setNotice("");
    const calendar = settings.calendars.find(
      (item) => item.id === fields.calendarId,
    );
    if (!fields.name.trim() || !fields.position.trim()) {
      setError("Isi nama dan jabatan pimpinan.");
      return;
    }
    if (!calendar) {
      setError("Pilih kalender yang dapat dibaca dari akun Google saat ini.");
      return;
    }
    if (!IANAZone.isValidZone(fields.timeZone.trim())) {
      setError(
        "Zona waktu tidak dikenali. Gunakan nama zona seperti Asia/Jakarta, Asia/Makassar, atau Asia/Jayapura.",
      );
      return;
    }
    const existing = settings.leaders.find((leader) => leader.id === fields.id);
    const leader: BrowserLeader = {
      id: existing?.id ?? crypto.randomUUID(),
      name: fields.name.trim(),
      position: fields.position.trim(),
      salutation: fields.salutation,
      closing: fields.salutation === "Ibu" ? "Bu" : "Pak",
      timeZone: fields.timeZone.trim(),
      calendarId: calendar.id,
      calendarName: calendar.summary,
      revision: existing ? existing.revision + 1 : 1,
    };
    setBusy("save");
    try {
      const result = await api<{ leaders: BrowserLeader[] }>(
        "/api/browser/leaders",
        leader,
      );
      setSettings((current) =>
        current ? { ...current, leaders: result.leaders } : current,
      );
      setFields(
        profileFields(
          result.leaders.find((item) => item.id === leader.id) ?? leader,
        ),
      );
      setNotice("Profil pimpinan berhasil disimpan di browser ini.");
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  async function exportBackup() {
    if (pending || !settings) return;
    setBusy("export");
    setError("");
    setNotice("");
    try {
      const { backup } = await api<{ backup: object }>(
        "/api/browser/backup/export",
        {},
      );
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pesan-agenda-cadangan-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setNotice(
        "Unduhan cadangan telah dimulai. Periksa folder unduhan dan simpan berkas di tempat yang aman.",
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  async function readBackup(file: File | undefined) {
    if (!file || pending) return;
    setError("");
    setNotice("");
    setPreview(null);
    if (file.size > 5 * 1024 * 1024) {
      setError(
        "Ukuran berkas cadangan maksimum 5 MB. Pilih berkas yang lebih kecil.",
      );
      return;
    }
    const request = ++reading.current;
    setBusy("read");
    try {
      let backup: unknown;
      try {
        backup = JSON.parse(await file.text());
      } catch {
        throw new Error(
          "Berkas tidak dapat dibaca sebagai JSON. Pilih berkas hasil ekspor Pesan Agenda.",
        );
      }
      if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
        throw new Error(
          "Isi cadangan harus berupa objek JSON dari Pesan Agenda.",
        );
      }
      if (request === reading.current)
        setPreview({
          name: file.name,
          size: file.size,
          backup: backup as Record<string, unknown>,
        });
    } catch (cause) {
      if (request === reading.current) setError(message(cause));
    } finally {
      if (request === reading.current) setBusy(null);
    }
  }

  async function importBackup() {
    if (!preview || !settings || pending) return;
    setBusy("import");
    setError("");
    setNotice("");
    try {
      const result = await api<{ leaders: BrowserLeader[] }>(
        "/api/browser/backup/import",
        { backup: preview.backup },
      );
      setSettings((current) =>
        current ? { ...current, leaders: result.leaders } : current,
      );
      const currentProfile =
        result.leaders.find((leader) => leader.id === fields.id) ??
        result.leaders[0];
      setFields(
        currentProfile
          ? profileFields(currentProfile)
          : emptyProfile(settings.calendars),
      );
      setPreview(null);
      setNotice(
        "Cadangan berhasil diimpor dan digabungkan dengan data akun ini.",
      );
      onSaved();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  const backupAccount = preview?.backup.account;
  const backupEmail =
    backupAccount &&
    typeof backupAccount === "object" &&
    "email" in backupAccount &&
    typeof backupAccount.email === "string"
      ? backupAccount.email
      : null;
  const backupDate =
    typeof preview?.backup.exportedAt === "string" &&
    !Number.isNaN(Date.parse(preview.backup.exportedAt))
      ? new Date(preview.backup.exportedAt).toLocaleString("id-ID")
      : null;

  return (
    <div className="browser-settings" aria-busy={pending}>
      <p className="browser-settings-intro">
        Atur profil pimpinan dan simpan cadangan pekerjaan Anda. Data tersimpan
        di browser ini dan tidak otomatis tersinkron ke perangkat lain.
      </p>
      {settings?.accountEmail && (
        <div className="browser-settings-account">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>
            Akun saat ini<strong>{settings.accountEmail}</strong>
          </span>
        </div>
      )}
      {error && (
        <div
          ref={noticeRef}
          tabIndex={-1}
          className="alert error browser-settings-message"
          role="alert"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="alert info browser-settings-message" role="status">
          {notice}
        </div>
      )}
      {busy === "load" && (
        <p className="browser-settings-loading" role="status">
          <LoaderCircle size={18} className="spin" aria-hidden="true" />
          Memuat profil dan kalender…
        </p>
      )}
      {!settings && busy !== "load" && (
        <button
          type="button"
          className="button secondary"
          onClick={() => setLoadAttempt((value) => value + 1)}
        >
          Coba lagi
        </button>
      )}
      {settings && (
        <>
          <section
            className="browser-settings-section"
            aria-labelledby="browser-profile-heading"
          >
            <div className="browser-settings-section-heading">
              <div>
                <h3 id="browser-profile-heading">Profil pimpinan</h3>
                <p>Satu profil menggunakan satu kalender acuan.</p>
              </div>
              <button
                type="button"
                className="button secondary small"
                disabled={pending}
                onClick={() => chooseProfile("")}
              >
                <Plus size={15} aria-hidden="true" />
                Tambah profil
              </button>
            </div>
            <label className="form-field" htmlFor="browser-profile-choice">
              Profil yang diatur
              <select
                id="browser-profile-choice"
                value={fields.id}
                disabled={pending}
                onChange={(event) => chooseProfile(event.target.value)}
              >
                <option value="">Profil baru</option>
                {settings.leaders.map((leader) => (
                  <option key={leader.id} value={leader.id}>
                    {leader.name} — {leader.position}
                  </option>
                ))}
              </select>
            </label>
            <form onSubmit={(event) => void saveProfile(event)}>
              <fieldset className="browser-settings-fields" disabled={pending}>
                <div className="form-grid">
                  <label className="form-field" htmlFor="browser-profile-name">
                    Nama pimpinan{" "}
                    <span className="browser-required">Wajib</span>
                    <input
                      id="browser-profile-name"
                      required
                      maxLength={300}
                      value={fields.name}
                      autoComplete="off"
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label
                    className="form-field"
                    htmlFor="browser-profile-position"
                  >
                    Jabatan <span className="browser-required">Wajib</span>
                    <input
                      id="browser-profile-position"
                      required
                      maxLength={300}
                      value={fields.position}
                      autoComplete="off"
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          position: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="form-grid">
                  <label
                    className="form-field"
                    htmlFor="browser-profile-salutation"
                  >
                    Sapaan
                    <select
                      id="browser-profile-salutation"
                      value={fields.salutation}
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          salutation: event.target.value as "Bapak" | "Ibu",
                        }))
                      }
                    >
                      <option value="Bapak">Bapak — penutup Pak</option>
                      <option value="Ibu">Ibu — penutup Bu</option>
                    </select>
                  </label>
                  <label className="form-field" htmlFor="browser-profile-zone">
                    Zona waktu <span className="browser-required">Wajib</span>
                    <input
                      id="browser-profile-zone"
                      required
                      maxLength={100}
                      value={fields.timeZone}
                      placeholder="Asia/Jakarta"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby="browser-zone-help"
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          timeZone: event.target.value,
                        }))
                      }
                    />
                  </label>
                </div>
                <p id="browser-zone-help" className="browser-settings-help">
                  Zona waktu mengikuti kalender yang dipilih dan dapat
                  disesuaikan, misalnya Asia/Jakarta, Asia/Makassar, atau
                  Asia/Jayapura.
                </p>
                <label
                  className="form-field"
                  htmlFor="browser-profile-calendar"
                >
                  Kalender acuan <span className="browser-required">Wajib</span>
                  <select
                    id="browser-profile-calendar"
                    required
                    value={fields.calendarId}
                    onChange={(event) => chooseCalendar(event.target.value)}
                  >
                    <option value="">Pilih kalender</option>
                    {fields.calendarId && !calendarAvailable && (
                      <option value={fields.calendarId} disabled>
                        Kalender profil tidak tersedia pada akun ini
                      </option>
                    )}
                    {settings.calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.summary}
                        {calendar.primary ? " (utama)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!settings.calendars.length && (
                  <div className="alert warning">
                    Belum ada kalender yang dapat dibaca. Hubungkan akun Google
                    dengan izin membaca detail kalender sebelum menyimpan
                    profil.
                  </div>
                )}
                <div className="browser-settings-save">
                  <button
                    type="submit"
                    className="button primary"
                    disabled={pending || !settings.calendars.length}
                  >
                    {busy === "save" ? (
                      <LoaderCircle
                        size={17}
                        className="spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Save size={17} aria-hidden="true" />
                    )}
                    {busy === "save" ? "Menyimpan…" : "Simpan profil"}
                  </button>
                </div>
              </fieldset>
            </form>
          </section>
          <section
            className="browser-settings-section"
            aria-labelledby="browser-backup-heading"
          >
            <div className="browser-settings-section-heading">
              <div>
                <h3 id="browser-backup-heading">Cadangan data</h3>
                <p>
                  Ekspor profil dan pelengkap agenda, lalu impor pada browser
                  lain dengan akun Google yang sama.
                </p>
              </div>
            </div>
            <div className="alert warning browser-backup-warning">
              <ShieldCheck size={18} aria-hidden="true" />
              <p>
                Berkas cadangan memuat data pribadi dan dapat memuat kode akses
                rapat. Lindungi berkas ini dan simpan hanya di tempat yang Anda
                percayai.
              </p>
            </div>
            <div className="browser-backup-actions">
              <button
                type="button"
                className="button secondary"
                disabled={pending}
                onClick={() => void exportBackup()}
              >
                {busy === "export" ? (
                  <LoaderCircle size={17} className="spin" aria-hidden="true" />
                ) : (
                  <Download size={17} aria-hidden="true" />
                )}
                {busy === "export" ? "Menyiapkan…" : "Ekspor cadangan"}
              </button>
              <label
                className="form-field browser-backup-file"
                htmlFor="browser-backup-file"
              >
                Pilih berkas cadangan (JSON, maksimum 5 MB)
                <input
                  ref={fileInput}
                  id="browser-backup-file"
                  type="file"
                  accept=".json,application/json"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void readBackup(file);
                  }}
                />
              </label>
            </div>
            {busy === "read" && (
              <p className="browser-settings-loading" role="status">
                <LoaderCircle size={17} className="spin" aria-hidden="true" />
                Memeriksa berkas…
              </p>
            )}
            {preview && (
              <div
                className="browser-backup-preview"
                aria-labelledby="browser-backup-preview-heading"
              >
                <div className="browser-backup-filename">
                  <FileJson size={21} aria-hidden="true" />
                  <div>
                    <h4 id="browser-backup-preview-heading">
                      Periksa sebelum impor
                    </h4>
                    <p>{preview.name}</p>
                  </div>
                </div>
                <dl>
                  <div>
                    <dt>Ukuran</dt>
                    <dd>
                      {(preview.size / 1024).toLocaleString("id-ID", {
                        maximumFractionDigits: 1,
                      })}{" "}
                      KB
                    </dd>
                  </div>
                  <div>
                    <dt>Akun cadangan</dt>
                    <dd>{backupEmail || "Tidak tercantum"}</dd>
                  </div>
                  <div>
                    <dt>Profil pimpinan</dt>
                    <dd>
                      {Array.isArray(preview.backup.leaders)
                        ? preview.backup.leaders.length
                        : "Belum dikenali"}
                    </dd>
                  </div>
                  <div>
                    <dt>Pelengkap kegiatan</dt>
                    <dd>
                      {Array.isArray(preview.backup.supplements)
                        ? preview.backup.supplements.length
                        : "Belum dikenali"}
                    </dd>
                  </div>
                  {backupDate && (
                    <div>
                      <dt>Waktu ekspor</dt>
                      <dd>{backupDate}</dd>
                    </div>
                  )}
                </dl>
                <p className="browser-settings-help">
                  Belum ada data yang diimpor. Setelah Anda melanjutkan,
                  aplikasi memeriksa format dan kecocokan akun, lalu
                  menggabungkan data. Jika ada konflik, impor ditolak tanpa
                  menimpa data yang tersimpan.
                </p>
                <div className="browser-backup-confirm">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={pending}
                    onClick={() => setPreview(null)}
                  >
                    Batal impor
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={pending}
                    onClick={() => void importBackup()}
                  >
                    {busy === "import" ? (
                      <LoaderCircle
                        size={17}
                        className="spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Upload size={17} aria-hidden="true" />
                    )}
                    {busy === "import" ? "Mengimpor…" : "Impor cadangan ini"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}
      <div className="browser-settings-footer">
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={onClose}
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
