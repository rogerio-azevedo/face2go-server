export type FaceSyncEntityKind =
  | 'registration'
  | 'student'
  | 'responsible'
  | 'member'
  | 'invite_guest'
  | 'pickup_guest';

export type FacePersonJobPayload = {
  entityKind: FaceSyncEntityKind;
  faceId: number;
  name: string;
  photoKey: string;
  timeSectionIds?: number[];
  validFrom?: string;
  validUntil?: string;
  photoOnly?: boolean;
  resetReaderProgress?: boolean;
  previousDeviceSyncError?: string | null;
  readerIds?: string[];
  logContext?: string;
  userId?: string;
  notifyKind?: 'invite' | 'pickup';
  requestedByMemberId?: string | null;
};

export type FaceReaderJobPayload = {
  force?: boolean;
};

export type FaceSchoolJobPayload = {
  entityKind: 'student' | 'responsible';
};

export type LprVehicleJobPayload = {
  plate: string;
  ownerDisplayName: string;
  vehicleColor?: string | null;
  logContext?: string;
  cameraIds?: string[];
};

export type LprCameraJobPayload = {
  force?: boolean;
};

export type DeviceSyncJobDto = {
  jobId: string;
  kind: string;
  status: string;
  force: boolean;
  targetId: string;
  entityKind?: string;
  processed: number;
  total: number;
  error: string | null;
};
