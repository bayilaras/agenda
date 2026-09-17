import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock3,
  ExternalLink,
  MapPin,
  Video,
  LockKeyhole,
  Pencil,
} from "lucide-react";
import { DateTime } from "luxon";
import { isSelectable, isSafeHttpsUrl } from "../../shared/domain";
import {
  isCalendarSelectable,
  calendarDescriptionText,
} from "../../shared/calendar-message";
import type {
  AgendaEvent,
  CompositionMode,
  Leader,
  Supplement,
  Validation,
} from "../../shared/types";
import { EventEditor } from "./EventEditor";
interface Props {
  compositionMode?: CompositionMode;
  event: AgendaEvent;
  leader: Leader;
  selected: boolean;
  onSelect: () => void;
  validation: Validation;
  expanded: boolean;
  onExpand: () => void;
  edited: Supplement;
  onChange: (s: Supplement) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  dirty: boolean;
}
export function EventCard(props: Props) {
  const { event, leader, selected, onSelect, validation, expanded, onExpand } =
    props;
  const automatic = props.compositionMode === "calendar";
  const selectable = automatic
    ? isCalendarSelectable(event)
    : isSelectable(event);
  const errors = validation.errors.length > 0;
  const warnings = validation.warnings.length > 0;
  const state = !selectable
    ? "locked"
    : errors
      ? "incomplete"
      : warnings
        ? "attention"
        : "ready";
  const time = (value: string) =>
    DateTime.fromISO(value, { zone: leader.timeZone }).toFormat("HH.mm");
  const mode = {
    online: "Daring",
    offline: "Luring",
    hybrid: "Hibrida",
    "": "Belum ditentukan",
  }[event.supplement.mode];
  const location = automatic
    ? event.sourceLocation
    : event.supplement.mode === "online"
      ? event.supplement.platform
      : event.supplement.location || event.sourceLocation;
  return (
    <article
      className={`event-card ${selected ? "selected" : ""} ${!selectable ? "unavailable" : ""}`}
      id={`event-${event.id}`}
    >
      <div className="event-main">
        <label className="event-select">
          <input
            type="checkbox"
            aria-label={`Pilih ${event.sourceTitle}`}
            disabled={!selectable}
            checked={selected}
            onChange={onSelect}
          />
        </label>
        <div className="event-info">
          <div className="event-topline">
            <span className="event-time">
              <Clock3 size={13} />
              {event.allDay
                ? "Seharian"
                : `${time(event.start)}${event.endTimeUnspecified ? "" : ` – ${!automatic && event.supplement.timeFormat === "until-finished" ? "selesai" : time(event.end)}`}`}
            </span>
            <span className={`event-status ${state}`}>
              {state === "ready" ? (
                <Check size={12} />
              ) : state === "locked" ? (
                <LockKeyhole size={11} />
              ) : (
                <CircleAlert size={12} />
              )}
              {
                {
                  ready: "Siap",
                  incomplete: automatic
                    ? "Periksa kalender"
                    : "Perlu dilengkapi",
                  attention: "Perlu perhatian",
                  locked: "Tidak dapat dipilih",
                }[state]
              }
            </span>
          </div>
          <h3>{event.sourceTitle || "Kegiatan privat"}</h3>
          <div className="event-meta">
            <span>
              {event.supplement.mode === "online" ? (
                <Video size={14} />
              ) : (
                <MapPin size={14} />
              )}{" "}
              {automatic ? "Dari kalender" : mode}
            </span>
            {location && (
              <>
                <span className="meta-dot">·</span>
                <span className="event-location">{location}</span>
              </>
            )}
          </div>
          {errors && selectable && (
            <p className="event-missing">
              {validation.errors
                .slice(0, 2)
                .map((i) => i.message)
                .join(" · ")}
              {validation.errors.length > 2
                ? ` · +${validation.errors.length - 2} lainnya`
                : ""}
            </p>
          )}
          <div className="event-bottom">
            <span className="event-attendance">
              {automatic
                ? "Informasi disusun otomatis"
                : {
                    attending: "Akan hadir",
                    undecided: "Kehadiran belum diputuskan",
                    represented: `Diwakilkan${event.supplement.representative ? ` · ${event.supplement.representative}` : ""}`,
                    absent: "Tidak hadir",
                  }[event.supplement.attendance]}
            </span>
            <div className="event-actions">
              {event.htmlLink.startsWith("https://") && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="icon-link"
                  title="Buka di Google Calendar"
                  aria-label={`Buka ${event.sourceTitle} di Google Calendar`}
                >
                  <ExternalLink size={14} />
                </a>
              )}
              {event.readable && event.status !== "cancelled" && (
                <button
                  className="text-button"
                  onClick={onExpand}
                  aria-expanded={expanded}
                >
                  <Pencil size={13} />
                  {automatic ? "Lihat sumber" : errors ? "Lengkapi" : "Detail"}
                  {expanded ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {expanded &&
        event.readable &&
        event.status !== "cancelled" &&
        (automatic ? (
          <div className="calendar-details">
            {event.sourceLocation && (
              <p>
                <strong>Lokasi:</strong> {event.sourceLocation}
              </p>
            )}
            <pre>
              {calendarDescriptionText(event.description) ||
                "Tidak ada keterangan tambahan pada kalender."}
            </pre>
            {!!event.sourceCandidates?.length && (
              <div>
                <strong>Akses rapat dari kalender</strong>
                {event.sourceCandidates.map((candidate, index) => (
                  <p key={index}>
                    {candidate.field === "meetingUrl"
                      ? "Tautan rapat"
                      : candidate.field === "meetingId"
                        ? "ID rapat"
                        : "Kode sandi"}
                    : {candidate.value}
                  </p>
                ))}
              </div>
            )}
            {!!event.sourceAttachments?.length && (
              <div>
                <strong>Lampiran kalender</strong>
                {event.sourceAttachments
                  .filter((item) => isSafeHttpsUrl(item.url))
                  .map((item, index) => (
                    <p key={index}>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title || "Lampiran"}
                      </a>
                    </p>
                  ))}
              </div>
            )}
            <p className="field-help">
              Data ini langsung digunakan pada pesan. Perubahan sumber dilakukan
              di Google Calendar.
            </p>
          </div>
        ) : (
          <EventEditor
            event={event}
            value={props.edited}
            onChange={props.onChange}
            onSave={props.onSave}
            onCancel={props.onCancel}
            saving={props.saving}
            dirty={props.dirty}
          />
        ))}
    </article>
  );
}
