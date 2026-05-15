export const ACCESS_FACIAL_RECORDED = 'access.facial.recorded';

export type AccessFacialRecordedPayload = {
  accessId: string;
  faceId: number;
  clientId: string;
  personName: string | null;
  readerName: string;
  eventDate: Date | null;
};
