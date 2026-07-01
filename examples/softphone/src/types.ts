export interface StoredCredentials {
  domain: string;
  phone: string;
  secret: string;
  nameexten?: string;
  authorizationUsername?: string;
  server: string;
  debug?: boolean;
  provider?: "sipjs" | "jssip";
}

export interface DevicePrefs {
  audioInput?: string;
  audioOutput?: string;
  ringtone?: string;
  ringback?: string;
}

export interface CallRecord {
  id: string;
  direction: "inbound" | "outbound";
  number: string;
  displayName?: string;
  startedAt: string;
  endedAt?: string;
  duration: number;
  status: "answered" | "missed" | "rejected" | "failed" | "calling" | "busy";
}

export interface MessageRecord {
  id: string;
  direction: "inbound" | "outbound";
  peer: string;
  body: string;
  timestamp: string;
  read: boolean;
}

export type ActiveView = "dialer" | "history" | "messages" | "settings" | "monitor";

export interface SipLogEntry {
  id: string;
  timestamp: number;
  direction: "sent" | "received";
  method?: string;
  statusCode?: number;
  statusText?: string;
  content: string;
}
