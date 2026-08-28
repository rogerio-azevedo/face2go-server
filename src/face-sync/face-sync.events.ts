export const FACE_SYNC_REQUESTED = 'face.sync.requested';

export type FaceSyncOutcome = {
  deviceSyncStatus: 'synced' | 'sync_failed';
  deviceSyncError: string | null;
};

export type FaceSyncRequestedPayload = {
  clientId: string;
  faceId: number;
  name: string;
  imageBuffer: Buffer;
  photoKey?: string;
  timeSectionIds?: number[];
  logContext?: string;
  validFrom?: Date;
  validUntil?: Date;
  /** Pula cartão/permissões — só troca a foto no leitor. */
  photoOnly?: boolean;
  persistResult: (outcome: FaceSyncOutcome) => Promise<void>;
};
