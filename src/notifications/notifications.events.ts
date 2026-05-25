export const ACCESS_FACIAL_RECORDED = 'access.facial.recorded';

export type AccessFacialRecordedPayload = {
  accessId: string;
  faceId: number;
  clientId: string;
  personName: string | null;
  readerName: string;
  readerDirection: 'in' | 'out' | null;
  eventDate: Date | null;
};

export const ACCESS_LPR_RECORDED = 'access.lpr.recorded';

export type AccessLprRecordedPayload = {
  accessId: string;
  cameraId: string;
  clientId: string;
  plateNumber: string;
  cameraName: string;
  snapTime: Date | null;
};
