import { useRef } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  FileCheck2,
  FileText,
  Info,
  LoaderCircle,
  RefreshCw,
  WandSparkles,
} from "lucide-react";
import type { Draft, Issue } from "../../shared/types";
interface Props {
  draft: Draft | null;
  eventTitles: Record<string, string>;
  selectedCount: number;
  stale: boolean;
  confirmed: boolean;
  copied: boolean;
  busy: boolean;
  ready: boolean;
  acknowledged: string[];
  onAck: (id: string) => void;
  onConfirm: (value: boolean) => void;
  onPrepare: () => void;
  onCopy: () => void;
  copyFallback: boolean;
  canPrepare: boolean;
  blockedReason: string;
  onIssue: (issue: Issue) => void;
}
export function Preview({
  draft,
  eventTitles,
  selectedCount,
  stale,
  confirmed,
  copied,
  busy,
  ready,
  acknowledged,
  onAck,
  onConfirm,
  onPrepare,
  onCopy,
  copyFallback,
  canPrepare,
  blockedReason,
  onIssue,
}: Props) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const status = !draft
    ? "Belum dibuat"
    : stale
      ? "Perlu diperbarui"
      : draft.errors.length
        ? "Draf belum lengkap"
        : copied
          ? "Pernah disalin"
          : ready
            ? "Siap disalin"
            : "Perlu diperiksa";
  return (
    <section className="preview-panel" aria-label="Pratinjau pesan">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="panel-icon">
            <FileText size={18} />
          </span>
          <div>
            <h2>Pratinjau pesan</h2>
            <p>Template formal · Versi 1.0</p>
          </div>
        </div>
        <span
          className={`badge ${stale ? "amber" : ready ? "green" : "neutral"}`}
        >
          {status}
        </span>
      </div>
      {draft ? (
        <>
          <div className={`preview-document ${stale ? "stale" : ""}`}>
            <div className="document-top">
              <span>PESAN AGENDA HARIAN</span>
              <FileCheck2 size={16} />
            </div>
            <pre>{draft.plainText}</pre>
          </div>
          {stale && (
            <div className="preview-alert">
              <RefreshCw size={15} />
              <p>
                Data berubah atau melewati 2 menit. Perbarui pesan dan periksa
                kembali.
              </p>
            </div>
          )}
          {draft.errors.length > 0 && (
            <div className="draft-issues">
              <strong>Lengkapi sebelum disalin</strong>
              {draft.errors.map((i) => (
                <button key={i.id} onClick={() => onIssue(i)}>
                  {i.message}
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          )}
          {!stale && draft.warnings.length > 0 && (
            <div className="review-warnings">
              <h3>Periksa hal berikut</h3>
              {draft.warnings.map((i) => (
                <label className="check-row" key={i.id}>
                  <input
                    type="checkbox"
                    checked={acknowledged.includes(i.id)}
                    onChange={() => onAck(i.id)}
                  />
                  <span>
                    {i.eventId && (
                      <strong className="issue-event-title">
                        {eventTitles[i.eventId]}
                      </strong>
                    )}
                    {i.acknowledgement || i.message}
                    <small>{i.message}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="preview-empty">
          <div className="paper-illustration">
            <div className="paper-fold" />
            <span className="paper-mini-label">AGENDA</span>
            <div className="paper-line wide" />
            <div className="paper-line" />
            <div className="paper-gap" />
            <div className="paper-line wide" />
            <div className="paper-line medium" />
            <div className="paper-line short" />
            <span className="paper-seal">
              <CheckCheck size={24} />
            </span>
          </div>
          <h3>Dari agenda menjadi pesan.</h3>
          <p>
            Pilih kegiatan, lengkapi informasinya,
            <br />
            lalu buat pesan untuk pimpinan Anda.
          </p>
          <div className="preview-steps">
            <span>
              <Check size={12} /> Format konsisten
            </span>
            <span>
              <Check size={12} /> Tetap Anda periksa
            </span>
          </div>
        </div>
      )}
      <div className="preview-bottom">
        <div className="preview-count">
          <span>
            {draft ? selectedCount : 0} kegiatan <i>·</i>{" "}
            {draft?.plainText.length.toLocaleString("id-ID") || "0"} karakter
          </span>
          <span>Teks biasa</span>
        </div>
        <label
          className={`check-row review-check ${!draft || stale || draft.errors.length ? "disabled" : ""}`}
        >
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!draft || stale || draft.errors.length > 0 || busy}
            onChange={(e) => onConfirm(e.target.checked)}
          />
          <span>Saya telah memeriksa isi pesan.</span>
        </label>
        <div className="preview-buttons">
          <button
            className="button primary"
            disabled={!canPrepare || busy}
            onClick={onPrepare}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : draft ? (
              <RefreshCw size={16} />
            ) : (
              <WandSparkles size={16} />
            )}{" "}
            {busy ? "Memeriksa…" : draft ? "Perbarui Pesan" : "Buat Pesan"}
          </button>
          <button
            className="button secondary"
            disabled={!ready || busy || stale}
            onClick={onCopy}
          >
            {copied && !stale ? <CheckCheck size={16} /> : <Copy size={16} />}{" "}
            Salin Pesan
          </button>
        </div>
        <p className="action-hint" aria-live="polite">
          {blockedReason ||
            "Pesan siap disalin. Pengiriman dilakukan secara manual."}
        </p>
      </div>
      {copyFallback && ready && !stale && (
        <div className="clipboard-fallback">
          <strong>Gunakan salin manual</strong>
          <p>
            Browser tidak mengizinkan clipboard. Pilih teks, lalu tekan Ctrl+C /
            Cmd+C atau gunakan menu Salin pada perangkat.
          </p>
          <textarea
            ref={textRef}
            readOnly
            value={draft?.plainText}
            aria-label="Teks pesan untuk salin manual"
          />
          <button
            className="button secondary small"
            onClick={() => {
              textRef.current?.focus();
              textRef.current?.select();
            }}
          >
            Pilih teks
          </button>
        </div>
      )}
      <div className="preview-footnote">
        <Info size={14} />
        <p>Hanya isi pesan yang disalin. Periksa kembali sebelum dikirim.</p>
      </div>
    </section>
  );
}
