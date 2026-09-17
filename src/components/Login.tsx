import { useState } from "react";
import {
  ArrowRight,
  ShieldCheck,
  CalendarDays,
  Check,
  MessageSquareText,
  LoaderCircle,
} from "lucide-react";
import type { SessionInfo } from "../../shared/types";
import { api, setCsrf } from "../api";
import { Brand } from "./Brand";
export function Login({
  session,
  onLogin,
}: {
  session: SessionInfo;
  onLogin: (info: SessionInfo) => void;
}) {
  const personal = session.personalMode === true;
  const local = session.storageMode === "browser";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showLogin, setShowLogin] = useState(!session.demoAvailable);
  async function login(demo = false) {
    setBusy(true);
    setError("");
    try {
      await api(
        demo
          ? "/api/auth/demo"
          : local
            ? "/api/google/connect"
            : "/api/auth/login",
        demo || local ? {} : { email, password },
      );
      const info = await api<SessionInfo>("/api/session");
      setCsrf(info.csrfToken);
      onLogin(info);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-story-main">
          <span className="eyebrow light">SATU RUANG. AGENDA TERTATA.</span>
          <h1>
            Lebih sedikit mengetik.
            <br />
            Lebih siap
            <br />
            <em>mendampingi.</em>
          </h1>
          <p>
            Susun pesan agenda pimpinan dengan tenang.
            <br />
            Terhubung ke jadwal, lengkap dalam satu halaman.
          </p>
          <div className="login-illustration">
            <div className="illustration-date">
              <CalendarDays size={23} />
              <span>
                JADWAL HARIAN<strong>Semua terencana.</strong>
              </span>
              <span className="illustration-check">
                <Check size={18} />
              </span>
            </div>
            <div className="illustration-letter">
              <MessageSquareText size={24} />
              <div className="illustration-line long" />
              <div className="illustration-line" />
              <div className="illustration-line short" />
              <span>
                <Check size={14} /> Pesan siap diperiksa
              </span>
            </div>
          </div>
        </div>
        <div className="login-story-footer">
          <ShieldCheck size={16} /> Kalender baca-saja. Kendali tetap di tangan
          Anda.
        </div>
      </section>
      <section className="login-entry">
        <div className="login-form">
          <span className="eyebrow">SELAMAT DATANG</span>
          <h2>
            Hari yang tertata
            <br />
            dimulai di sini.
          </h2>
          <p>
            {personal
              ? "Masuk ke ruang kerja pribadi Anda."
              : "Masuk ke ruang kerja sekretariat Anda."}
          </p>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          {local ? (
            <div className="demo-invitation">
              <span className="badge neutral">RUANG PRIBADI ANDA</span>
              <h3>Mulai dari kalender Anda.</h3>
              <p>
                Hubungkan Google Calendar, pilih profil pimpinan, lalu susun
                pesan. Profil dan pelengkap disimpan di browser ini.
              </p>
              <button
                className="button primary full"
                disabled={busy || !session.googleConfigured}
                onClick={() => void login()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    <CalendarDays size={18} /> Hubungkan Google Calendar
                  </>
                )}
              </button>
              {!session.googleConfigured && (
                <p className="field-help">
                  Koneksi Google belum disiapkan pada situs ini. Anda tetap
                  dapat mencoba mode demo.
                </p>
              )}
              <button
                className="button secondary full"
                disabled={busy}
                onClick={() => void login(true)}
              >
                Coba dengan data demo <ArrowRight size={16} />
              </button>
              <p className="field-help">
                Gunakan ekspor cadangan untuk memindahkan pelengkap ke perangkat
                lain. Data lokal dapat hilang jika data situs dihapus.
              </p>
            </div>
          ) : showLogin ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void login();
              }}
            >
              <label>
                {personal ? "Email pemilik" : "Email operator"}
                <input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    personal ? "nama@example.com" : "nama@instansi.go.id"
                  }
                  required
                />
              </label>
              <label>
                Kata sandi
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan kata sandi"
                  required
                />
              </label>
              <button className="button primary full" disabled={busy}>
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    Masuk ke ruang kerja
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="demo-invitation">
              <span className="badge neutral">MODE DEMO</span>
              <h3>Coba alurnya, dari awal hingga siap salin.</h3>
              <p>
                Gunakan data kegiatan sintetis untuk menjelajahi aplikasi. Tidak
                terhubung ke kalender asli.
              </p>
              <button
                className="button primary full"
                disabled={busy}
                onClick={() => void login(true)}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={18} />
                ) : (
                  <>
                    Jelajahi mode demo
                    <ArrowRight size={18} />
                  </>
                )}
              </button>
            </div>
          )}
          {!local && session.demoAvailable && (
            <button
              className="login-switch"
              onClick={() => setShowLogin(!showLogin)}
            >
              {showLogin
                ? "Kembali ke mode demo"
                : personal
                  ? "Masuk ke akun pemilik"
                  : "Sudah punya akun? Masuk sebagai operator"}
            </button>
          )}
          <div className="login-note">
            <ShieldCheck size={19} />
            <p>
              {local
                ? "Kalender dibaca setelah Anda memberikan izin."
                : personal
                  ? "Satu akun untuk mengelola agenda Anda."
                  : "Akses khusus operator yang ditugaskan."}
              <br />
              Pesan diperiksa dan dikirim manual oleh Anda.
            </p>
          </div>
        </div>
        <p className="login-copyright">
          Pesan Agenda © {new Date().getFullYear()}{" "}
          <span>Dirancang untuk kerja yang lebih teratur.</span>
        </p>
      </section>
    </main>
  );
}
