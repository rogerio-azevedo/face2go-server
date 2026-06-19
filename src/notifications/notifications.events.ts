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

export const RESPONSIBLE_INVITATION_APPROVED =
  'responsible.invitation.approved';

export type ResponsibleInvitationApprovedPayload = {
  invitationId: string;
  clientId: string;
  inviterResponsibleId: string;
  guestName: string;
};

export const RESPONSIBLE_INVITATION_SYNCED = 'responsible.invitation.synced';

export type ResponsibleInvitationSyncedPayload = {
  invitationId: string;
  clientId: string;
  inviterResponsibleId: string;
  guestName: string;
  syncStatus: 'synced' | 'sync_failed';
};

export const PICKUP_GUEST_FACE_APPROVED = 'pickup.guest.face.approved';

export type PickupGuestFaceApprovedPayload = {
  authorizationId: string;
  clientId: string;
  requestedByResponsibleId: string;
  guestName: string;
};

export const PICKUP_GUEST_FACE_SYNCED = 'pickup.guest.face.synced';

export type PickupGuestFaceSyncedPayload = {
  authorizationId: string;
  clientId: string;
  requestedByResponsibleId: string;
  guestName: string;
  syncStatus: 'synced' | 'sync_failed';
};

export const INVITE_GUEST_FACE_APPROVED = 'invite.guest.face.approved';

export type InviteGuestFaceApprovedPayload = {
  inviteId: string;
  clientId: string;
  requestedByMemberId: string;
  guestName: string;
};

export const INVITE_GUEST_FACE_SYNCED = 'invite.guest.face.synced';

export type InviteGuestFaceSyncedPayload = {
  inviteId: string;
  clientId: string;
  requestedByMemberId: string;
  guestName: string;
  syncStatus: 'synced' | 'sync_failed';
};
