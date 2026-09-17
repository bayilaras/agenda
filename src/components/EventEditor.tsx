import type { AgendaEvent, Supplement } from "../../shared/types";
import { useState } from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileText,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { parseDescription } from "../../shared/domain";
import { fillFromDescription } from "../description-fill";

interface Props {
  event: AgendaEvent;
  value: Supplement;
  onChange: (value: Supplement) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  dirty: boolean;
}
export function EventEditor({
  event,
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  dirty,
}: Props) {
  const descriptionFill = fillFromDescription(event, value);
  const [filledCount, setFilledCount] = useState<number | null>(null);
  const set = <K extends keyof Supplement>(field: K, next: Supplement[K]) =>
    onChange({ ...value, [field]: next });
  const id = (field: string) => `field-${event.id}-${field}`;
  const online = value.mode === "online" || value.mode === "hybrid";
  const field = (
    name: keyof Supplement,
    label: string,
    max: number,
    placeholder = "",
    multiline = false,
  ) => (
    <label className="form-field" htmlFor={id(name)}>
      {label}
      {multiline ? (
        <textarea
          id={id(name)}
          value={String(value[name])}
          maxLength={max}
          rows={3}
          placeholder={placeholder}
          onChange={(e) => set(name, e.target.value as never)}
        />
      ) : (
        <input
          id={id(name)}
          value={String(value[name])}
          maxLength={max}
          placeholder={placeholder}
          onChange={(e) => set(name, e.target.value as never)}
        />
      )}
    </label>
  );
  return (
    <div className="event-editor">
      <fieldset className="editor-fieldset" disabled={saving}>
        <div className="source-note">
          <FileText size={17} />
          <div>
            <strong>Judul dari Google Calendar</strong>
            <p>{event.sourceTitle || "Judul sumber belum tersedia"}</p>
            <small>Jadwal dan judul sumber diperbaiki melalui kalender.</small>
          </div>
        </div>
        <div className="description-fill">
          <div>
            <strong>Ambil informasi dari keterangan kalender</strong>
            <p>
              Isian kosong dilengkapi dari sumber yang dikenali. Isian Anda
              tetap dipertahankan.
            </p>
          </div>
          <button
            type="button"
            className="button secondary small"
            disabled={descriptionFill.fields.length === 0}
            onClick={() => {
              onChange(descriptionFill.value);
              setFilledCount(descriptionFill.fields.length);
            }}
          >
            <FileText size={15} /> Isi dari keterangan
          </button>
          <p className="field-help" role="status">
            {filledCount !== null
              ? `${filledCount} isian dilengkapi. Periksa hasilnya, lalu Simpan.`
              : descriptionFill.fields.length
                ? `${descriptionFill.fields.length} isian kosong dapat dilengkapi.`
                : "Isian yang dikenali sudah terisi atau belum ada informasi tambahan yang dapat diambil."}
          </p>
          {descriptionFill.accessConflict && (
            <p className="field-help">
              Tautan atau platform yang sudah diisi berbeda dengan keterangan.
              Bandingkan kandidat akses rapat di bawah sebelum memilihnya.
            </p>
          )}
        </div>
        <div className="form-section">
          <h4>Informasi kegiatan</h4>
          {field("title", "Judul dalam pesan", 500, event.sourceTitle)}
          <div className="form-grid">
            <label className="form-field">
              Rencana kehadiran
              <select
                id={id("attendance")}
                value={value.attendance}
                onChange={(e) =>
                  onChange({
                    ...value,
                    attendance: e.target.value as Supplement["attendance"],
                    role: e.target.value === "attending" ? value.role : "",
                  })
                }
              >
                <option value="undecided">Belum diputuskan</option>
                <option value="attending">Akan hadir</option>
                <option value="represented">Diwakilkan</option>
                <option value="absent">Tidak hadir</option>
              </select>
            </label>
            <label className="form-field">
              Peran pimpinan
              <select
                id={id("role")}
                disabled={value.attendance !== "attending"}
                value={value.role}
                onChange={(e) =>
                  set("role", e.target.value as Supplement["role"])
                }
              >
                <option value="">Tanpa awalan</option>
                {[
                  "Menghadiri",
                  "Memimpin",
                  "Memberikan Sambutan",
                  "Memberikan Arahan",
                ].map((role) => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
          </div>
          {value.attendance === "represented" &&
            field(
              "representative",
              "Nama perwakilan *",
              300,
              "Nama dan jabatan perwakilan",
            )}
          <label className="form-field">
            Format waktu
            <select
              id={id("timeFormat")}
              value={value.timeFormat}
              onChange={(e) =>
                set("timeFormat", e.target.value as Supplement["timeFormat"])
              }
            >
              {event.allDay ? (
                <option value="all-day">Seharian</option>
              ) : (
                <>
                  <option value="range">Jam mulai–selesai dari kalender</option>
                  <option value="until-finished">Sampai selesai</option>
                </>
              )}
            </select>
          </label>
          {value.timeFormat === "until-finished" && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={value.untilConfirmed}
                onChange={(e) => set("untilConfirmed", e.target.checked)}
              />
              Saya mengonfirmasi sumber menyebut sampai selesai.
            </label>
          )}
        </div>
        <div className="form-section">
          <h4>Pelaksanaan & akses</h4>
          <div className="mode-options" id={id("mode")}>
            {[
              { v: "offline", t: "Luring" },
              { v: "online", t: "Daring" },
              { v: "hybrid", t: "Hibrida" },
            ].map(({ v, t }) => (
              <button
                key={v}
                className={`mode-option ${value.mode === v ? "active" : ""}`}
                onClick={() => set("mode", v as Supplement["mode"])}
                aria-pressed={value.mode === v}
              >
                {value.mode === v && <Check size={14} />} {t}
              </button>
            ))}
          </div>
          {(value.mode === "offline" || value.mode === "hybrid") && (
            <>
              {event.sourceLocation && (
                <p className="field-help">
                  Lokasi sumber: {event.sourceLocation}
                </p>
              )}
              {field(
                "location",
                "Tempat fisik *",
                1000,
                "Gedung, ruang, atau alamat kegiatan",
              )}
            </>
          )}
          {online && (
            <>
              {field(
                "platform",
                "Platform rapat *",
                200,
                "Contoh: Zoom Meeting atau Google Meet",
              )}
              {field("meetingUrl", "Tautan rapat (HTTPS)", 2048, "https://…")}
              <div className="form-grid">
                {field("meetingId", "ID rapat", 256, "Sesuai sumber")}
                {field(
                  "passcode",
                  "Kode sandi",
                  256,
                  "Dipertahankan persis sesuai sumber",
                )}
              </div>
              <label className="form-field">
                Kebutuhan kode sandi
                <select
                  id={id("accessCode")}
                  value={value.accessCode}
                  onChange={(e) =>
                    set(
                      "accessCode",
                      e.target.value as Supplement["accessCode"],
                    )
                  }
                >
                  <option value="unknown">Belum diketahui</option>
                  <option value="required">Wajib</option>
                  <option value="not-required">
                    Tidak diperlukan / sudah dalam tautan
                  </option>
                </select>
              </label>
              <label className="check-row">
                <input
                  id={id("accessVerified")}
                  type="checkbox"
                  checked={value.accessVerified}
                  onChange={(e) => set("accessVerified", e.target.checked)}
                />
                Saya telah memeriksa jalur bergabung dan kebutuhan kode.
              </label>
            </>
          )}
        </div>
        <div className="form-section">
          <h4>Isi pesan</h4>
          {field(
            "agenda",
            "Pokok agenda *",
            6000,
            "Isi berdasarkan undangan atau sumber yang sudah diperiksa.",
            true,
          )}
          <label className="form-field">
            Status bahan rapat
            <select
              id={id("materialsStatus")}
              value={value.materialsStatus}
              onChange={(e) =>
                set(
                  "materialsStatus",
                  e.target.value as Supplement["materialsStatus"],
                )
              }
            >
              <option value="unchecked">Belum diperiksa</option>
              <option value="available">Tersedia</option>
              <option value="unavailable">Belum tersedia</option>
              <option value="unnecessary">Tidak diperlukan</option>
            </select>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={value.includeMaterials}
              onChange={(e) => set("includeMaterials", e.target.checked)}
            />
            Cantumkan bahan rapat di pesan
          </label>
          {value.includeMaterials && (
            <>
              {field(
                "materials",
                "Keterangan bahan rapat",
                4000,
                "Hanya cantumkan informasi yang sudah dikonfirmasi.",
                true,
              )}
              {value.materialLinks.map((link, index) => (
                <div className="material-link" key={index}>
                  <label className="form-field">
                    Judul tautan
                    <input
                      maxLength={300}
                      value={link.title}
                      onChange={(e) =>
                        set(
                          "materialLinks",
                          value.materialLinks.map((l, i) =>
                            i === index ? { ...l, title: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className="form-field">
                    URL bahan (HTTPS)
                    <input
                      maxLength={2048}
                      value={link.url}
                      onChange={(e) =>
                        set(
                          "materialLinks",
                          value.materialLinks.map((l, i) =>
                            i === index ? { ...l, url: e.target.value } : l,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    className="icon-button"
                    aria-label={`Hapus tautan ${index + 1}`}
                    onClick={() =>
                      set(
                        "materialLinks",
                        value.materialLinks.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                className="text-button"
                disabled={value.materialLinks.length >= 10}
                onClick={() =>
                  set("materialLinks", [
                    ...value.materialLinks,
                    { title: "", url: "" },
                  ])
                }
              >
                <Plus size={15} />
                Tambah tautan bahan
              </button>
              <p className="field-help">
                Menyalin pesan tidak melampirkan file. Periksa izin akses
                penerima.
              </p>
            </>
          )}
          {field(
            "notes",
            "Keterangan pesan",
            4000,
            "Opsional. Hanya informasi yang boleh disampaikan.",
            true,
          )}
        </div>
        {(filledCount !== null ||
          event.conflicts.length > 0 ||
          event.reviewedSourceVersion !== event.sourceVersion ||
          event.endTimeUnspecified ||
          (value.location !== event.sourceLocation &&
            !!event.sourceLocation)) && (
          <div className="alert warning">
            <AlertCircle size={17} />
            <div>
              <strong>Sumber perlu diperiksa</strong>
              <p>
                {event.conflicts.join(" · ") ||
                  (event.reviewedSourceVersion &&
                  event.reviewedSourceVersion !== event.sourceVersion
                    ? "Informasi kalender berubah sejak pemeriksaan terakhir."
                    : "Bandingkan data sumber dengan isian pelengkap, termasuk tempat dan format waktu.")}
              </p>
              <label className="check-row">
                <input
                  id={id("sourceReviewed")}
                  type="checkbox"
                  checked={value.sourceReviewed}
                  onChange={(e) => set("sourceReviewed", e.target.checked)}
                />
                Saya sudah membandingkan sumber dan memilih nilai yang benar.
              </label>
            </div>
          </div>
        )}
        {event.sourceCandidates && event.sourceCandidates.length > 0 && (
          <details className="source-details">
            <summary>
              Bandingkan kandidat akses rapat <ExternalLink size={13} />
            </summary>
            {event.sourceCandidates.map((candidate, index) => (
              <div className="source-candidate" key={index}>
                <span>
                  {candidate.origin} ·{" "}
                  {
                    {
                      meetingUrl: "Tautan rapat",
                      meetingId: "ID rapat",
                      passcode: "Kode sandi",
                    }[candidate.field]
                  }
                </span>
                <pre>{candidate.value}</pre>
                <button
                  className="text-button"
                  onClick={() => set(candidate.field, candidate.value)}
                >
                  Gunakan nilai ini
                </button>
              </div>
            ))}
          </details>
        )}
        <details className="source-details">
          <summary>
            Lihat deskripsi sumber asli <ExternalLink size={13} />
          </summary>
          <pre>
            {parseDescription(event.description).plainText ||
              "Tidak ada deskripsi pada kalender."}
          </pre>
        </details>
        <div className="editor-actions">
          <span>
            {dirty
              ? "Ada perubahan belum disimpan"
              : "Pelengkap tersimpan terpisah dari kalender"}
          </span>
          <div>
            <button
              className="button secondary small"
              onClick={onCancel}
              disabled={saving}
            >
              Batal
            </button>
            <button
              className="button primary small"
              onClick={onSave}
              disabled={saving}
            >
              <Save size={15} />
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
