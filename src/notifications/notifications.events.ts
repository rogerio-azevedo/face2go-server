export const ACCESS_FACIAL_RECORDED = 'access.facial.recorded';

export type AccessFacialRecordedPayload = {
  accessId: string;
  faceId: number;
  clientId: string;
  personName: string | null;
  readerId: string;
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

export const PICKUP_GUEST_FACE_SUBMITTED = 'pickup.guest.face.submitted';

export type PickupGuestFaceSubmittedPayload = {
  authorizationId: string;
  clientId: string;
  requestedByResponsibleId: string;
  guestName: string;
};

export const INVITE_GUEST_FACE_SUBMITTED = 'invite.guest.face.submitted';

export type InviteGuestFaceSubmittedPayload = {
  inviteId: string;
  clientId: string;
  requestedByMemberId: string;
  guestName: string;
};

export const RESPONSIBLE_INVITATION_SUBMITTED =
  'responsible.invitation.submitted';

export type ResponsibleInvitationSubmittedPayload = {
  invitationId: string;
  clientId: string;
  inviterResponsibleId: string;
  guestName: string;
};
