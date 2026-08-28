export const READER_OFFLINE_DETECTED = 'reader.offline.detected';

export type ReaderOfflineDetectedEvent = {
  readerId: string;
  readerName: string;
  clientId: string;
  clientName: string;
  companyId: string;
  brand: string;
  lastConnectionError?: string;
  detectedAt: Date;
};
