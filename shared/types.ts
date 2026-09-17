export type Attendance = "undecided" | "attending" | "represented" | "absent";
export type Mode = "" | "online" | "offline" | "hybrid";
export interface Leader {
  id: string;
  name: string;
  position: string;
  salutation: "Bapak" | "Ibu";
  closing: "Pak" | "Bu";
  timeZone: string;
  calendarName: string;
  revision: number;
}
export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "operator";
}
export interface Supplement {
  title: string;
  attendance: Attendance;
  role:
    | ""
    | "Menghadiri"
    | "Memimpin"
    | "Memberikan Sambutan"
    | "Memberikan Arahan";
  representative: string;
  timeFormat: "range" | "until-finished" | "all-day";
  untilConfirmed: boolean;
  mode: Mode;
  location: string;
  platform: string;
  meetingUrl: string;
  meetingId: string;
  passcode: string;
  accessCode: "required" | "not-required" | "unknown";
  accessVerified: boolean;
  agenda: string;
  materialsStatus: "unchecked" | "available" | "unavailable" | "unnecessary";
  materials: string;
  materialLinks: { title: string; url: string }[];
  includeMaterials: boolean;
  notes: string;
  sourceReviewed: boolean;
}
export interface AgendaEvent {
  id: string;
  sourceTitle: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  endTimeUnspecified?: boolean;
  sourceLocation: string;
  htmlLink: string;
  sourceVersion: string;
  status: "confirmed" | "tentative" | "cancelled";
  readable: boolean;
  recurringEventId?: string;
  originalStartTime?: string;
  supplement: Supplement;
  revision: number;
  reviewedSourceVersion: string;
  conflicts: string[];
  sourceCandidates?: {
    field: "meetingUrl" | "meetingId" | "passcode";
    value: string;
    origin: string;
  }[];
}
export interface Issue {
  id: string;
  code: string;
  eventId?: string;
  field: string;
  message: string;
  acknowledgement?: string;
}
export interface Validation {
  errors: Issue[];
  warnings: Issue[];
}
export interface Snapshot {
  id: string;
  leaderId: string;
  date: string;
  hash: string;
  checkedAt: string;
  events: AgendaEvent[];
  excludedCount: number;
  complete: boolean;
}
export interface Draft extends Validation {
  draftId: string;
  plainText: string;
  contentHash: string;
  templateVersion: string;
  snapshotId: string;
  checkedAt: string;
  expiresAt: string;
  readyToCopy: boolean;
}
export interface SessionInfo {
  user: User | null;
  csrfToken: string;
  demo: boolean;
  demoAvailable?: boolean;
  personalMode?: boolean;
  storageMode?: "server" | "browser";
  googleConfigured: boolean;
  connected: boolean;
}
