import type { AgendaEvent, Leader, User } from "../../shared/types";

export interface BrowserLeader extends Leader {
  calendarId: string;
}
export interface CalendarOption {
  id: string;
  summary: string;
  timeZone: string;
  accessRole: string;
  primary?: boolean;
}
export interface BrowserGoogleSession {
  user: User;
  calendars: CalendarOption[];
}
export interface CalendarGateway {
  configured: boolean;
  initialize(): Promise<void>;
  isConnected(): boolean;
  getUser(): User | null;
  connect(): Promise<BrowserGoogleSession>;
  disconnect(): Promise<void>;
  forget(): void;
  calendars(): Promise<CalendarOption[]>;
  events(
    leader: BrowserLeader,
    date: string,
  ): Promise<{ events: AgendaEvent[]; excludedCount: number }>;
}
