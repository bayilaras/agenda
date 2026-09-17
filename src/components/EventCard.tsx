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
import { isSelectable } from "../../shared/domain";
import type {
  AgendaEvent,
  Leader,
  Supplement,
  Validation,
} from "../../shared/types";
import { EventEditor } from "./EventEditor";
interface Props {
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
  const selectable = isSelectable(event);
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
  const location =
    event.supplement.mode === "online"
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
                : `${time(event.start)} – ${event.supplement.timeFormat === "until-finished" ? "selesai" : time(event.end)}`}
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
                  incomplete: "Perlu dilengkapi",
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
              {mode}
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
              {
                {
                  attending: "Akan hadir",
                  undecided: "Kehadiran belum diputuskan",
                  represented: `Diwakilkan${event.supplement.representative ? ` · ${event.supplement.representative}` : ""}`,
                  absent: "Tidak hadir",
                }[event.supplement.attendance]
              }
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
                  {errors ? "Lengkapi" : "Detail"}
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
      {expanded && (
        <EventEditor
          event={event}
          value={props.edited}
          onChange={props.onChange}
          onSave={props.onSave}
          onCancel={props.onCancel}
          saving={props.saving}
          dirty={props.dirty}
        />
      )}
    </article>
  );
}
