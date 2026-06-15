/** Alinhado ao enum `reader_brand` do Postgres / Drizzle. */
export type ReaderBrandSlug = 'intelbras' | 'hikvision';

/** Evento facial normalizado (snapManager flat map / persistência). */
export interface VideoEvent {
  code: string;
  action: string;
  index: number;
  data?: Record<string, unknown>;
  raw?: Record<string, string | number>;
}

export type ReaderListenerStatus = {
  readerId: string;
  readerName: string;
  clientName: string;
  brand: ReaderBrandSlug;
  host: string;
  connected: boolean;
  eventsReceived: number;
  lastEventAt?: Date;
  connectedSince?: Date;
  lastConnectionError?: string;
};

export type ReaderMonitorStatusReport = {
  devices: ReaderMonitorDeviceRow[];
  summary: {
    total: number;
    connected: number;
    disconnected: number;
  };
};

export type ReaderMonitorDeviceRow = {
  readerId: string;
  readerName: string;
  clientName: string;
  brand: ReaderBrandSlug;
  host: string;
  isActive: boolean;
  hasCredentials: boolean;
  streamSupported: boolean;
  connected: boolean;
  eventsReceived: number;
  lastEventAt: Date | null;
  connectedSince: Date | null;
  lastConnectionError: string | null;
  lastSeenAt: Date | null;
};
