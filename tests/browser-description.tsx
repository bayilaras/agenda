import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "../src/styles.css";
import { EventEditor } from "../src/components/EventEditor";
import { mapBrowserGoogleEvent } from "../src/pages/google";
import type { BrowserLeader } from "../src/pages/types";
import type { AgendaEvent, Supplement } from "../shared/types";

// This standalone Vite development entry is never imported by the app.
// All source values are synthetic; no Google connection or storage is used.
const teamsDescription =
  "Melalui Meeting Teams Join:\n" +
  "https://teams.microsoft.com/meet/123456789?p=synthetic\n\n" +
  "Shortlink: https://example.test/meeting\n" +
  "Meeting ID:\n001 234 567\n\n" +
  "Passcode:\nTest.Code9";

const leader: BrowserLeader = {
  id: "fixture-description-leader",
  name: "Pimpinan Uji Sintetis",
  position: "Jabatan Uji",
  salutation: "Bapak",
  closing: "Pak",
  timeZone: "Asia/Jakarta",
  calendarName: "Kalender Uji Lokal",
  calendarId: "fixture-description-calendar@example.invalid",
  revision: 1,
};

const scenarios = [
  {
    id: "fresh",
    title: "1. Acara baru dari Teams",
    instruction:
      "Periksa hasil pemetaan acara baru: tautan Teams, ID dan kode dari deskripsi. Shortlink tidak boleh menggantikan tautan Teams. Pokok agenda tidak tersedia dalam sumber.",
  },
  {
    id: "saved-manual",
    title: "2. Isian manual tersimpan",
    instruction:
      "Klik Isi dari keterangan. ID MANUAL-001 harus tetap dipertahankan; platform, tautan dan kode yang kosong dapat diisi. Pokok agenda harus tetap kosong karena tidak ada dalam deskripsi.",
  },
  {
    id: "source-conflict",
    title: "3. Teams dan konferensi Meet",
    instruction:
      "Deskripsi menyebut Teams, tetapi data konferensi menyebut Google Meet. Periksa kandidat dan peringatan konflik; jangan menganggap kedua sumber sudah diputuskan cocok.",
  },
] as const;
type ScenarioId = (typeof scenarios)[number]["id"];

async function makeEvent(scenario: ScenarioId): Promise<AgendaEvent> {
  const source = {
    id: `fixture-description-${scenario}`,
    etag: `synthetic-${scenario}-v1`,
    summary: "Rapat Uji Isi dari Keterangan",
    description: teamsDescription,
    start: { dateTime: "2026-09-17T10:00:00+07:00" },
    end: { dateTime: "2026-09-17T11:00:00+07:00" },
    status: "confirmed",
    eventType: "default",
    ...(scenario === "source-conflict"
      ? {
          conferenceData: {
            conferenceSolution: { name: "Google Meet" },
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/abc-defg-hij",
                meetingCode: "abc-defg-hij",
              },
            ],
          },
          hangoutLink: "https://meet.google.com/abc-defg-hij",
        }
      : {}),
  };
  const event = await mapBrowserGoogleEvent(source, leader, "owner");
  if (scenario === "saved-manual") {
    event.supplement = {
      ...event.supplement,
      mode: "online",
      platform: "",
      meetingUrl: "",
      meetingId: "MANUAL-001",
      passcode: "",
      accessCode: "unknown",
      accessVerified: false,
      agenda: "",
      sourceReviewed: true,
    };
    event.revision = 2;
    event.reviewedSourceVersion = event.sourceVersion;
  }
  return event;
}

function DescriptionFixture() {
  const [scenario, setScenario] = useState<ScenarioId>("fresh");
  const [reset, setReset] = useState(0);
  const [event, setEvent] = useState<AgendaEvent | null>(null);
  const [value, setValue] = useState<Supplement | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const active = scenarios.find((item) => item.id === scenario)!;

  useEffect(() => {
    let alive = true;
    setEvent(null);
    setValue(null);
    setStatus("");
    setError("");
    void makeEvent(scenario)
      .then((next) => {
        if (!alive) return;
        setEvent(next);
        setValue(structuredClone(next.supplement));
      })
      .catch((cause: unknown) => {
        if (alive)
          setError(
            cause instanceof Error ? cause.message : "Fixture gagal dimuat.",
          );
      });
    return () => {
      alive = false;
    };
  }, [scenario, reset]);

  return (
    <main className="description-fixture">
      <style>{`
        .description-fixture { max-width: 900px; margin: 24px auto; padding: 0 16px 40px; }
        .description-fixture h1 { font-size: 23px; margin: 0 0 12px; }
        .description-fixture-header { padding: 20px; background: #fff; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 18px; }
        .description-fixture-header > p { line-height: 1.7; margin: 8px 0; font-size: 13px; }
        .description-fixture-tabs { display: flex; flex-wrap: wrap; gap: 9px; margin: 18px 0; }
        .description-fixture-tabs .button { min-height: 42px; }
        .description-fixture-card { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: #fff; }
        .description-fixture-status { margin: 14px 0; }
        .description-fixture-values { background: #fff; border: 1px solid var(--border); border-radius: 9px; padding: 15px; margin-top: 18px; }
        .description-fixture-values summary { font-size: 13px; cursor: pointer; }
        .description-fixture-values pre { font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; margin-top: 12px; }
        @media(max-width: 560px) {
          .description-fixture { margin-top: 12px; padding: 0 10px 24px; }
          .description-fixture-header { padding: 15px; }
          .description-fixture-tabs .button { width: 100%; }
        }
      `}</style>
      <header className="description-fixture-header">
        <span className="badge neutral">FIXTURE LOKAL · DATA SINTETIS</span>
        <h1>Isi dari keterangan kalender</h1>
        <p>
          Menggunakan EventEditor dan pemetaan Google browser yang sebenarnya.
          Fixture ini tidak menghubungi Google, tidak membaca dokumen, dan tidak
          menyimpan atau mengirim data. Seluruh tautan, ID, dan kode adalah
          contoh.
        </p>
        <nav
          className="description-fixture-tabs"
          aria-label="Skenario pengujian"
        >
          {scenarios.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`button ${scenario === item.id ? "primary" : "secondary"}`}
              aria-pressed={scenario === item.id}
              onClick={() => {
                setScenario(item.id);
                setReset((previous) => previous + 1);
              }}
            >
              {item.title}
            </button>
          ))}
        </nav>
        <p>{active.instruction}</p>
        <p>Klik kembali tombol skenario untuk mengembalikan isian awalnya.</p>
      </header>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {!event && !error && <p role="status">Menyiapkan contoh sintetis…</p>}
      {event && value && (
        <>
          <div className="description-fixture-card">
            <EventEditor
              key={`${scenario}-${reset}`}
              event={event}
              value={value}
              onChange={(next) => {
                setValue(next);
                setStatus("");
              }}
              onSave={() =>
                setStatus(
                  "Simulasi Simpan diterima. Tidak ada data yang dikirim atau disimpan di luar fixture ini.",
                )
              }
              onCancel={() => {
                setValue(structuredClone(event.supplement));
                setStatus("Isian dikembalikan ke nilai awal skenario.");
              }}
              saving={false}
              dirty={JSON.stringify(value) !== JSON.stringify(event.supplement)}
            />
          </div>
          {status && (
            <p className="alert info description-fixture-status" role="status">
              {status}
            </p>
          )}
          <details className="description-fixture-values">
            <summary>Nilai sintetis saat ini untuk pemeriksaan</summary>
            <pre>
              {JSON.stringify(
                {
                  mode: value.mode,
                  platform: value.platform,
                  meetingUrl: value.meetingUrl,
                  meetingId: value.meetingId,
                  passcode: value.passcode,
                  agenda: value.agenda,
                  accessCode: value.accessCode,
                  accessVerified: value.accessVerified,
                  sourceReviewed: value.sourceReviewed,
                  conflicts: event.conflicts,
                  sourceCandidates: event.sourceCandidates,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<DescriptionFixture />);
