export const PANIC_CREATED = 'panic.created';
export const PANIC_UPDATED = 'panic.updated';

export type PanicEventPayload = {
  id: string;
  companyId: string;
  clientId: string;
  clientName: string;
  eventType: string;
  status: 'open' | 'claimed' | 'closed';
  requesterUserId: string;
  requesterMemberId: string | null;
  requesterName: string;
  requesterRole: string;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    capturedAt: string;
    source: string;
  };
  receivedAt: string;
  claimedAt: string | null;
  releasedAt: string | null;
  closedAt: string | null;
  claimedBy: {
    userId: string;
    name: string;
    role: string;
  } | null;
  closedBy: {
    userId: string;
    name: string;
    role: string;
  } | null;
  closingNotes: string | null;
  closingReason: string | null;
};

export type PanicCreatedEvent = {
  event: PanicEventPayload;
};

export type PanicUpdatedEvent = {
  event: PanicEventPayload;
  action: 'claim' | 'release' | 'close';
};
