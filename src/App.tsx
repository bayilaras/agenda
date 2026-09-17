import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Clock3,
  ExternalLink,
  FileCheck2,
  Info,
  Link2,
  ListChecks,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import {
  addDays,
  formatDate,
  todayInZone,
  validateEvents,
  zoneLabel,
} from "../shared/domain";
import type { Issue, SessionInfo } from "../shared/types";
import { api, setCsrf } from "./api";
import { useAgenda } from "./useAgenda";
import { Brand } from "./components/Brand";
import { Login } from "./components/Login";
import { Modal } from "./components/Modal";
import { EventCard } from "./components/EventCard";
import { Preview } from "./components/Preview";
import { BrowserSettings } from "./components/BrowserSettings";

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState("");
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  function updateSession(info: SessionInfo) {
    setSession(info);
    setWorkspaceVersion((previous) => previous + 1);
  }
  useEffect(() => {
    const expired = () => {
      setSession(null);
      api<SessionInfo>("/api/session")
        .then((info) => {
          setCsrf(info.csrfToken);
          setSession(info);
        })
        .catch(() =>
          setError("Sesi berakhir. Muat ulang halaman untuk masuk kembali."),
        );
    };
    window.addEventListener("agenda:session-expired", expired);
    return () => window.removeEventListener("agenda:session-expired", expired);
  }, []);
  useEffect(() => {
    let alive = true;
    api<SessionInfo>("/api/session")
      .then((info) => {
        if (alive) {
          setCsrf(info.csrfToken);
          setSession(info);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (!session)
    return (
      <main className="boot-screen">
        <Brand />
        {error ? (
          <div className="alert error" role="alert">
            {error}
            <button
              className="button secondary small"
              onClick={() => window.location.reload()}
            >
              Coba lagi
            </button>
          </div>
        ) : (
          <>
            <LoaderCircle size={24} className="spin" />
            <p>Menyiapkan ruang kerja…</p>
          </>
        )}
      </main>
    );
  if (!session.user) return <Login session={session} onLogin={updateSession} />;
  return (
    <Workspace
      key={workspaceVersion}
      session={session}
      onSession={updateSession}
    />
  );
}

function Workspace({
  session,
  onSession,
}: {
  session: SessionInfo;
  onSession: (s: SessionInfo) => void;
}) {
  const personal = session.personalMode === true;
  const local = session.storageMode === "browser";
  const [toast, setToast] = useState("");
  const notify = useCallback((text: string) => setToast(text), []);
  const a = useAgenda(notify);
  const [modal, setModal] = useState<
    "guide" | "connection" | "settings" | null
  >(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const connected = session.connected && !connectionLost;
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const today = todayInZone(a.leader?.timeZone || "Asia/Jakarta");
  const errorCount = a.selected.length ? a.validation.errors.length : 0;
  const warningCount = a.selected.length ? a.validation.warnings.length : 0;
  const step = a.draft && !a.stale ? 3 : a.selected.length ? 2 : 1;
  function openIssue(issue: Issue) {
    if (!issue.eventId) return;
    a.setExpanded(issue.eventId);
    setTimeout(() => {
      const element =
        document.getElementById(`field-${issue.eventId}-${issue.field}`) ||
        document.getElementById(`event-${issue.eventId}`);
      element?.scrollIntoView({ behavior: "smooth", block: "center" });
      element?.focus({ preventScroll: true });
    }, 80);
  }
  async function logout() {
    await api("/api/auth/logout", {});
    const next = await api<SessionInfo>("/api/session");
    setCsrf(next.csrfToken);
    onSession(next);
  }
  async function disconnect() {
    a.invalidate();
    setConnectionLost(true);
    setConnectionBusy(true);
    try {
      await api("/api/google/disconnect", {});
      const next = await api<SessionInfo>("/api/session");
      setCsrf(next.csrfToken);
      onSession(next);
      if (!local) window.location.reload();
    } catch (e) {
      a.setError((e as Error).message);
    } finally {
      setConnectionBusy(false);
    }
  }
  async function connectGoogle() {
    a.invalidate();
    setConnectionLost(true);
    setConnectionBusy(true);
    try {
      const next = await api<SessionInfo>("/api/google/connect", {});
      setCsrf(next.csrfToken);
      onSession(next);
    } catch (e) {
      a.setError((e as Error).message);
      setModal(null);
    } finally {
      setConnectionBusy(false);
    }
  }
  async function settingsSaved() {
    const next = await api<SessionInfo>("/api/session");
    onSession(next);
  }
  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? "mobile-open" : ""}`}>
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-button mobile-only"
            aria-label="Tutup menu"
            onClick={() => setMobileNav(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="workspace-label">
          <span className="workspace-mark">{personal ? "P" : "S"}</span>
          <span>
            {personal ? "Pribadi" : "Sekretariat"}
            <small>
              {personal ? "Ruang kerja pribadi" : "Ruang kerja operator"}
            </small>
          </span>
          <ShieldCheck size={15} />
        </div>
        <p className="nav-label">RUANG KERJA</p>
        <nav aria-label="Navigasi utama">
          <button
            className="nav-item active"
            onClick={() => {
              setModal(null);
              setMobileNav(false);
            }}
          >
            <CalendarDays size={19} />
            Pesan Agenda
            <span className="nav-active-dot" />
          </button>
          <button
            className="nav-item"
            onClick={() => {
              setModal("connection");
              setMobileNav(false);
            }}
          >
            <Link2 size={19} />
            Koneksi Kalender
          </button>
          {local && (
            <button
              className="nav-item"
              onClick={() =>
                a.guard(() => {
                  setModal("settings");
                  setMobileNav(false);
                })
              }
            >
              <Settings2 size={19} />
              Profil & cadangan
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="sidebar-note-icon">
              <ShieldCheck size={20} />
            </span>
            <strong>Anda pegang kendali.</strong>
            <p>
              Jadwal dibaca dari kalender.
              <br />
              Pesan diperiksa oleh Anda.
            </p>
            <span>AKSES KALENDER BACA-SAJA</span>
          </div>
          <button
            className="nav-item"
            onClick={() => {
              setModal("guide");
              setMobileNav(false);
            }}
          >
            <CircleHelp size={18} />
            Panduan penggunaan
          </button>
          <div className="sidebar-version">
            <span>Pesan Agenda</span>
            <span>v1.0</span>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="Tutup navigasi"
          onClick={() => setMobileNav(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-only"
              aria-label="Buka menu"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>{personal ? "Pribadi" : "Sekretariat"}</span>
            <ChevronRight size={13} />
            <strong>Pesan Agenda</strong>
          </div>
          <div className="topbar-right">
            {session.demo && (
              <span className="demo-chip">
                <span />
                Mode demo
              </span>
            )}
            <button
              className="icon-button top-help"
              aria-label="Buka panduan penggunaan"
              onClick={() => setModal("guide")}
            >
              <CircleHelp size={19} />
            </button>
            <span className="topbar-divider" />
            <span className="avatar">
              {session
                .user!.name.split(" ")
                .slice(0, 2)
                .map((n) => n[0])
                .join("")}
            </span>
            <div className="user-name">
              <strong>{session.user!.name}</strong>
              <small>
                {personal
                  ? "Pemilik"
                  : session.user!.role === "admin"
                    ? "Administrator"
                    : "Operator agenda"}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Keluar dari akun"
              title="Keluar"
              onClick={() =>
                a.guard(() => void logout().catch((e) => a.setError(e.message)))
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="workspace">
          {local && (
            <div className="alert info browser-storage-note">
              <ShieldCheck size={19} />
              <div>
                <strong>
                  {session.demo
                    ? "Mode demo · data contoh"
                    : "Penyimpanan di browser ini"}
                </strong>
                <p>
                  {session.demo
                    ? "Coba alur pesan dengan data sintetis. Hubungkan Google untuk menggunakan kalender Anda."
                    : "Profil dan pelengkap tidak otomatis tersinkron antarperangkat. Simpan cadangan sebelum menghapus data browser."}
                </p>
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  a.guard(() =>
                    setModal(session.demo ? "connection" : "settings"),
                  )
                }
              >
                {session.demo ? "Hubungkan Google" : "Profil & cadangan"}
              </button>
            </div>
          )}
          {local && !session.demo && !a.leaders.length && (
            <div className="alert info">
              <UserRound size={20} />
              <div>
                <strong>Siapkan profil pimpinan terlebih dahulu.</strong>
                <p>
                  Isi nama, jabatan, sapaan, dan pilih kalender yang akan
                  digunakan.
                </p>
                <button
                  className="button primary small"
                  onClick={() => setModal("settings")}
                >
                  Tambah profil pimpinan
                </button>
              </div>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">LEBIH TERTATA, LEBIH SIAP</div>
              <h1>
                Pesan Agenda<span className="title-period">.</span>
              </h1>
              <p>Ubah jadwal harian menjadi pesan yang siap disampaikan.</p>
            </div>
            <button
              className="connection-summary"
              onClick={() => setModal("connection")}
            >
              <span
                className={`connection-light ${!connected && !session.demo ? "off" : ""}`}
              />
              <div>
                <strong>
                  {session.demo
                    ? "Kalender demonstrasi"
                    : connected
                      ? "Google Calendar terhubung"
                      : "Kalender belum terhubung"}
                </strong>
                <small>
                  {session.demo
                    ? "Data sintetis · tidak memakai kalender asli"
                    : a.snapshot
                      ? `Diperiksa ${new Date(a.snapshot.checkedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
                      : "Akses baca-saja"}
                </small>
              </div>
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="workflow" aria-label="Tahap penyusunan pesan">
            {[
              { n: 1, t: "Pilih kegiatan" },
              { n: 2, t: "Lengkapi informasi" },
              { n: 3, t: "Periksa & salin" },
            ].map(({ n, t }) => (
              <div
                key={n}
                className={`workflow-step ${step === n ? "current" : ""} ${step > n ? "done" : ""}`}
              >
                <span>
                  {step > n ? <Check size={12} /> : String(n).padStart(2, "0")}
                </span>
                {t}
                {n < 3 && <div className="workflow-line" />}
              </div>
            ))}
            <span className="workflow-note">
              <ShieldCheck size={14} />
              Setiap detail tetap dalam kendali Anda
            </span>
          </div>
          <section
            className="context-panel"
            aria-label="Pilih pimpinan dan tanggal"
          >
            <label className="context-leader">
              <span className="field-caption">
                <UserRound size={13} />
                PIMPINAN
              </span>
              <select
                value={a.leaderId}
                onChange={(e) => a.changeLeader(e.target.value)}
                aria-label="Pimpinan"
              >
                <option value="">Pilih pimpinan…</option>
                {a.leaders.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <span className="context-subtitle">
                {a.leader?.position ||
                  "Pilih profil yang akan disiapkan agendanya"}
              </span>
            </label>
            <div className="context-date">
              <label className="field-caption" htmlFor="agenda-date">
                <CalendarDays size={13} />
                TANGGAL AGENDA
              </label>
              <div className="date-control">
                <button
                  className="icon-button"
                  aria-label="Hari sebelumnya"
                  disabled={!a.leader}
                  onClick={() => a.changeDate(addDays(a.date, -1))}
                >
                  <ArrowLeft size={15} />
                </button>
                <input
                  id="agenda-date"
                  type="date"
                  value={a.date}
                  onChange={(e) => a.changeDate(e.target.value)}
                  disabled={!a.leader}
                />
                <button
                  className="icon-button"
                  aria-label="Hari berikutnya"
                  disabled={!a.leader}
                  onClick={() => a.changeDate(addDays(a.date, 1))}
                >
                  <ArrowRight size={15} />
                </button>
              </div>
            </div>
            <div className="date-shortcuts">
              <button
                className={a.date === today ? "active" : ""}
                disabled={!a.leader}
                onClick={() => a.changeDate(today)}
              >
                Hari ini
              </button>
              <button
                className={a.date === addDays(today, 1) ? "active" : ""}
                disabled={!a.leader}
                onClick={() => a.changeDate(addDays(today, 1))}
              >
                Besok
              </button>
            </div>
            <div className="context-end">
              <span className="timezone">
                <Clock3 size={13} />
                {zoneLabel(a.leader?.timeZone || "Asia/Jakarta")}{" "}
                <span>· {a.leader?.timeZone || "Asia/Jakarta"}</span>
              </span>
              <button
                className="button secondary"
                onClick={a.refresh}
                disabled={!a.leader || a.loading}
              >
                <RefreshCw size={15} className={a.loading ? "spin" : ""} />
                {a.loading ? "Memuat…" : "Muat Ulang"}
              </button>
            </div>
          </section>
          {a.error && (
            <div className="alert error page-error" role="alert">
              <CircleAlert size={18} />
              <span>{a.error}</span>
              <button
                className="icon-button"
                aria-label="Tutup pemberitahuan"
                onClick={() => a.setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {a.sourceChanges.length > 0 && (
            <div className="alert warning page-error" role="status">
              <RefreshCw size={18} />
              <div>
                <strong>Perubahan pada sumber terbaru</strong>
                <ul>
                  {a.sourceChanges.map((change, index) => (
                    <li key={index}>{change}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <div className="agenda-summary">
            <div>
              <span>
                <CalendarDays size={15} />
                <strong>{a.events.length}</strong> kegiatan tersedia
              </span>
              <span className="summary-divider" />
              <span className="selected-count">
                <strong>{a.selected.length}</strong> dipilih
              </span>
            </div>
            <div>
              <button
                className={`summary-issue ${errorCount ? "has-error" : ""}`}
                disabled={!errorCount}
                onClick={() => openIssue(a.validation.errors[0])}
              >
                <CircleAlert size={14} />
                {errorCount} kesalahan
              </button>
              <span className="summary-divider" />
              <button
                className={`summary-issue ${warningCount ? "has-warning" : ""}`}
                disabled={!warningCount}
                onClick={() =>
                  document
                    .getElementById("validation-panel")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
              >
                <Info size={14} />
                {warningCount} perhatian
              </button>
            </div>
          </div>
          <div className="workspace-columns">
            <div className="agenda-column">
              <section className="events-section">
                <div className="events-heading">
                  <div>
                    <h2>
                      Kegiatan harian <span>{a.events.length}</span>
                    </h2>
                    <p>{formatDate(a.date)}</p>
                  </div>
                  <label className="select-all">
                    <input
                      type="checkbox"
                      checked={
                        a.selectable.length > 0 &&
                        a.selected.length === Math.min(a.selectable.length, 20)
                      }
                      disabled={!a.selectable.length || a.loading}
                      onChange={a.toggleAll}
                    />
                    Pilih semua
                  </label>
                </div>
                {a.loading ? (
                  <div
                    className="skeleton-list"
                    aria-busy="true"
                    aria-label="Memuat kegiatan"
                  >
                    {[1, 2, 3].map((n) => (
                      <div className="skeleton-card" key={n}>
                        <div />
                        <div />
                        <div />
                      </div>
                    ))}
                  </div>
                ) : !a.leader ? (
                  <div className="events-empty">
                    <span>
                      <UserRound size={30} />
                    </span>
                    <h3>Untuk siapa agenda hari ini?</h3>
                    <p>
                      Pilih pimpinan di atas untuk melihat kegiatan
                      <br />
                      {personal
                        ? "dari kalender yang Anda hubungkan."
                        : "dari kalender yang ditugaskan kepada Anda."}
                    </p>
                  </div>
                ) : !a.events.length ? (
                  <div className="events-empty">
                    <span>
                      <CalendarDays size={30} />
                    </span>
                    <h3>
                      {a.error
                        ? "Kalender belum berhasil diperiksa"
                        : "Belum ada kegiatan untuk tanggal ini"}
                    </h3>
                    <p>
                      {a.error
                        ? "Muat ulang untuk mencoba mengambil data kembali."
                        : "Tidak ada kegiatan pada kalender terhubung untuk tanggal ini."}
                    </p>
                    <button
                      className="button secondary small"
                      onClick={
                        a.error
                          ? a.refresh
                          : () => a.changeDate(addDays(a.date, 1))
                      }
                    >
                      {a.error ? "Coba lagi" : "Lihat hari berikutnya"}
                      <ArrowRight size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="event-list">
                    {a.events.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        leader={a.leader!}
                        selected={a.selected.includes(event.id)}
                        onSelect={() => a.toggle(event.id)}
                        validation={validateEvents(
                          [
                            {
                              ...event,
                              supplement: a.edits[event.id] || event.supplement,
                            },
                          ],
                          a.leader!,
                          a.date,
                        )}
                        expanded={a.expanded === event.id}
                        onExpand={() =>
                          a.setExpanded(
                            a.expanded === event.id ? null : event.id,
                          )
                        }
                        edited={a.edits[event.id] || event.supplement}
                        onChange={(value) => a.edit(event.id, value)}
                        onSave={() =>
                          void a
                            .save(event.id)
                            .then(() => a.setExpanded(null))
                            .catch(() => {})
                        }
                        onCancel={() => a.cancelEdit(event.id)}
                        saving={a.saving}
                        dirty={a.dirtyIds.includes(event.id)}
                      />
                    ))}
                  </div>
                )}
                {!!a.snapshot?.excludedCount && (
                  <p className="field-help">
                    {a.snapshot.excludedCount} item dibatasi atau dikecualikan
                    dari pilihan pesan.
                  </p>
                )}
                <div className="calendar-source">
                  <ShieldCheck size={14} />
                  <span>
                    {a.leader?.calendarName || "Google Calendar"} <i>·</i>{" "}
                    Baca-saja
                  </span>
                  {a.snapshot && (
                    <span className="source-time">
                      {new Date(a.snapshot.checkedAt).toLocaleTimeString(
                        "id-ID",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                  )}
                </div>
              </section>
              {a.selected.length > 0 && (
                <section className="validation-panel" id="validation-panel">
                  <div className="validation-heading">
                    <ListChecks size={18} />
                    <h2>Pemeriksaan kegiatan</h2>
                    <span className={`badge ${errorCount ? "amber" : "green"}`}>
                      {errorCount
                        ? `${errorCount} perlu dilengkapi`
                        : "Data wajib lengkap"}
                    </span>
                  </div>
                  {a.validation.errors.map((issue) => (
                    <button
                      className="validation-item error-item"
                      key={issue.id}
                      onClick={() => openIssue(issue)}
                    >
                      <CircleAlert size={15} />
                      <span>
                        {issue.eventId && (
                          <strong className="issue-event-title">
                            {
                              a.events.find(
                                (event) => event.id === issue.eventId,
                              )?.sourceTitle
                            }
                          </strong>
                        )}
                        {issue.message}
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                  {a.validation.warnings.map((issue) => (
                    <button
                      className="validation-item warning-item"
                      key={issue.id}
                      onClick={() => openIssue(issue)}
                    >
                      <Info size={15} />
                      <span>
                        {issue.eventId && (
                          <strong className="issue-event-title">
                            {
                              a.events.find(
                                (event) => event.id === issue.eventId,
                              )?.sourceTitle
                            }
                          </strong>
                        )}
                        {issue.message}
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                  {!errorCount && !warningCount && (
                    <p className="validation-success">
                      <Check size={15} />
                      Kegiatan terpilih sudah lengkap. Lanjutkan membuat pesan.
                    </p>
                  )}
                  {a.dirty && (
                    <p className="unsaved-hint">
                      <CircleAlert size={15} />
                      Simpan perubahan formulir sebelum membuat pesan.
                    </p>
                  )}
                </section>
              )}
              <div className="small-tip">
                <span>
                  <Sparkles size={17} />
                </span>
                <p>
                  <strong>Rapi sejak awal.</strong> Lengkapi informasi dari
                  sumber yang Anda periksa. Pesan disusun dengan format yang
                  konsisten.
                </p>
              </div>
            </div>
            <Preview
              draft={a.draft}
              eventTitles={Object.fromEntries(
                a.events.map((event) => [event.id, event.sourceTitle]),
              )}
              selectedCount={a.selected.length}
              stale={a.stale}
              confirmed={a.confirmed}
              copied={a.copied}
              busy={a.preparing}
              ready={a.ready}
              acknowledged={a.acknowledged}
              onAck={(id) =>
                void a.review(
                  a.confirmed,
                  a.acknowledged.includes(id)
                    ? a.acknowledged.filter((x) => x !== id)
                    : [...a.acknowledged, id],
                )
              }
              onConfirm={(v) => void a.review(v, a.acknowledged)}
              onPrepare={() => void a.prepare()}
              onCopy={() => void a.copy()}
              copyFallback={a.copyFallback}
              canPrepare={a.canPrepare}
              blockedReason={a.blockedReason}
              onIssue={openIssue}
            />
          </div>
          <footer className="page-footer">
            <span>Disusun dengan teliti. Disampaikan dengan pasti.</span>
            <span>
              <ShieldCheck size={13} /> Tidak ada pesan yang dikirim otomatis
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast}</span>
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="Tutup notifikasi"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "guide" && (
        <Modal
          title="Langkah kecil, agenda lebih tertata"
          onClose={() => setModal(null)}
        >
          <p className="modal-intro">
            Semua pekerjaan harian ada di halaman Pesan Agenda.
          </p>
          <ol className="guide-list">
            <li>
              <span>01</span>
              <div>
                <h3>Pilih pimpinan & tanggal</h3>
                <p>
                  Kalender dibaca sesuai zona waktu profil. Pilih kegiatan yang
                  ingin disampaikan.
                </p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Lengkapi informasi</h3>
                <p>
                  Buka Lengkapi atau Detail, isi berdasarkan sumber, lalu
                  Simpan. Jadwal asli tetap dikelola melalui Google Calendar.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Buat, periksa & salin</h3>
                <p>
                  Tekan Buat Pesan, tinjau isi serta setiap peringatan, lalu
                  centang konfirmasi. Salin Pesan dan tempel di aplikasi tujuan.
                </p>
              </div>
            </li>
          </ol>
          <div className="alert info">
            <Clock3 size={18} />
            <p>
              Pratinjau berlaku 2 menit. Perubahan pilihan atau data
              mengharuskan pesan dibuat dan diperiksa kembali.
            </p>
          </div>
          <button
            className="button primary full"
            onClick={() => setModal(null)}
          >
            Mengerti, mulai bekerja
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {modal === "connection" && (
        <Modal title="Koneksi Google Calendar" onClose={() => setModal(null)}>
          <div className="connection-modal-icon">
            <CalendarDays size={30} />
          </div>
          <h3>
            {session.demo
              ? "Anda sedang menggunakan data demo"
              : connected
                ? "Kalender sudah terhubung"
                : "Hubungkan sumber jadwal"}
          </h3>
          <p className="modal-intro">
            {local
              ? session.demo
                ? "Kegiatan ini adalah contoh sintetis. Hubungkan akun Google Anda untuk membaca kalender yang sebenarnya."
                : "Akses Google digunakan hanya untuk membaca kalender. Jika sesi Google berakhir, hubungkan kembali. Profil dan pelengkap tetap tersimpan di browser ini."
              : personal
                ? session.demo
                  ? "Semua pimpinan dan kegiatan dalam mode ini adalah contoh sintetis. Siapkan satu akun pemilik dan hubungkan Google Calendar untuk menggunakan jadwal Anda."
                  : "Anda mengelola koneksi kalender dan semua profil pimpinan dengan satu akun pemilik. Aplikasi hanya meminta izin membaca kegiatan dan daftar kalender."
                : session.demo
                  ? "Semua pimpinan dan kegiatan dalam mode ini adalah contoh sintetis. Gunakan akun operator yang dikonfigurasi untuk membaca kalender organisasi."
                  : "Aplikasi hanya meminta izin membaca kegiatan dan daftar kalender. Pemetaan kalender dan penugasan operator ditetapkan oleh administrator."}
          </p>
          <div className="connection-details">
            <span>
              Status
              <strong>
                {session.demo
                  ? "Demonstrasi"
                  : connected
                    ? "Terhubung"
                    : "Belum terhubung"}
              </strong>
            </span>
            <span>
              Hak akses<strong>Baca-saja</strong>
            </span>
            <span>
              Kalender aktif
              <strong>
                {a.leader?.calendarName || "Pilih pimpinan dahulu"}
              </strong>
            </span>
          </div>
          {!session.googleConfigured && (
            <div className="alert info">
              <Settings2 size={19} />
              <p>
                {local
                  ? "Koneksi Google belum disiapkan pada situs ini. Client ID publik perlu dikonfigurasi oleh pemilik situs."
                  : personal
                    ? "Kredensial OAuth Google belum dikonfigurasi. Siapkan Client ID, Client Secret, dan ID kalender satu kali sesuai README aplikasi, lalu masuk dengan akun pemilik untuk menghubungkan Google Calendar."
                    : "Kredensial OAuth Google belum dikonfigurasi. Administrator perlu menyiapkan Client ID, Client Secret, serta pemetaan kalender di server sesuai README aplikasi."}
              </p>
            </div>
          )}
          {local && session.googleConfigured && (
            <button
              className="button primary full"
              disabled={connectionBusy}
              onClick={() => a.guard(() => void connectGoogle())}
            >
              <Link2 size={16} />
              {connectionBusy
                ? "Menghubungkan…"
                : connected && !session.demo
                  ? "Hubungkan ulang Google Calendar"
                  : "Hubungkan Google Calendar"}
            </button>
          )}
          {!local &&
            session.user!.role === "admin" &&
            session.googleConfigured &&
            !session.demo && (
              <a className="button primary full" href="/api/google/connect">
                <Link2 size={16} />
                {connected
                  ? "Hubungkan ulang Google Calendar"
                  : "Hubungkan Google Calendar"}
                <ExternalLink size={15} />
              </a>
            )}
          {session.user!.role === "admin" && connected && !session.demo && (
            <button
              className="button danger full"
              disabled={connectionBusy}
              onClick={() => a.guard(() => void disconnect())}
            >
              {connectionBusy
                ? "Memutus koneksi…"
                : local
                  ? "Putuskan sesi Google"
                  : "Cabut koneksi kalender"}
            </button>
          )}
          <p className="field-help">
            Informasi pelengkap disimpan di aplikasi, terpisah dari Google
            Calendar.
            {local &&
              " Pemutusan menutup sesi lokal. Izin aplikasi juga dapat dikelola melalui pengaturan akun Google Anda."}
          </p>
        </Modal>
      )}
      {modal === "settings" && local && (
        <Modal title="Profil & cadangan" onClose={() => setModal(null)} wide>
          <BrowserSettings
            onClose={() => setModal(null)}
            onSaved={() =>
              void settingsSaved().catch((e) => a.setError(e.message))
            }
          />
        </Modal>
      )}
      {a.pending && (
        <Modal
          title="Simpan perubahan sebelum berpindah?"
          onClose={() => a.setPending(null)}
        >
          <p className="modal-intro">
            Ada informasi kegiatan yang belum disimpan. Simpan agar pekerjaan
            Anda tetap tersedia.
          </p>
          <div className="modal-actions">
            <button
              className="button secondary"
              disabled={a.saving}
              onClick={() => a.setPending(null)}
            >
              Tetap di sini
            </button>
            <button
              className="button danger"
              disabled={a.saving}
              onClick={() => void a.resolvePending(false)}
            >
              Buang perubahan
            </button>
            <button
              className="button primary"
              disabled={a.saving}
              onClick={() => void a.resolvePending(true)}
            >
              {a.saving ? "Menyimpan…" : "Simpan & lanjutkan"}
            </button>
          </div>
        </Modal>
      )}
      {a.conflict && (
        <Modal
          title={
            personal
              ? "Pelengkap diperbarui pada sesi lain"
              : "Pelengkap diperbarui operator lain"
          }
          onClose={() => a.setConflict(null)}
          wide
        >
          <p className="modal-intro">
            Perubahan Anda masih tersimpan di formulir. Bandingkan dengan versi
            terbaru sebelum menyimpan kembali.
          </p>
          <div className="conflict-compare">
            <div>
              <h3>Versi terbaru · revisi {a.conflict.latest.revision}</h3>
              <pre>{JSON.stringify(a.conflict.latest.supplement, null, 2)}</pre>
            </div>
            <div>
              <h3>Perubahan Anda</h3>
              <pre>{JSON.stringify(a.edits[a.conflict.id], null, 2)}</pre>
            </div>
          </div>
          <button className="button primary" onClick={a.reconcile}>
            Gunakan revisi terbaru & tinjau isian saya
          </button>
        </Modal>
      )}
    </div>
  );
}
