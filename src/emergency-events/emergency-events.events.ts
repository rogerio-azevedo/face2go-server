export const EMERGENCY_CHECKIN_UPDATED = 'emergency.checkin.updated';

export type EmergencyCheckinUpdatedPayload = {
  eventId: string;
  companyId: string;
  clientId: string;
  checkin: EmergencyCheckinPayload;
  summary: EmergencySummaryPayload;
};

export type EmergencyCheckinPayload = {
  id: string;
  personType: 'student' | 'responsible' | 'member' | 'guest';
  personId: string;
  personName: string;
  classId: string | null;
  className: string | null;
  expectedStatus: 'inside' | 'added_manually';
  status: 'pending' | 'safe' | 'not_located' | 'evacuated' | 'injured';
  statusNote: string | null;
  statusUpdatedAt: string | null;
};

export type EmergencySummaryPayload = {
  total: number;
  pending: number;
  safe: number;
  notLocated: number;
  evacuated: number;
  injured: number;
};

export type EmergencyEventPayload = {
  id: string;
  companyId: string;
  clientId: string;
  clientName: string;
  status: 'active' | 'resolved';
  srpAction:
    | 'hold'
    | 'secure'
    | 'lockdown'
    | 'evacuate'
    | 'shelter'
    | 'other'
    | null;
  reason: string | null;
  startedAt: string;
  resolvedAt: string | null;
  summary: EmergencySummaryPayload;
  checkins: EmergencyCheckinPayload[];
};
