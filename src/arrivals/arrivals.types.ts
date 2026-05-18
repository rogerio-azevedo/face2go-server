export type ArrivalDisplayKind = 'responsible' | 'student';

export type ArrivalSseStudent = {
  name: string;
  photoUrl: string | null;
  /** Nome da turma (`school_classes.name`), se houver. */
  className: string | null;
};

/** Payload enviado no campo `data` do SSE ao registrarem chegada facial. */
export type ArrivalSsePayload = {
  type: 'arrival';
  kind: ArrivalDisplayKind;
  accessId: string;
  personName: string | null;
  personPhotoUrl: string | null;
  readerName: string;
  eventDate: string | null;
  /** Placa do veículo do responsável ou de co-responsável pelo mesmo aluno. */
  vehiclePlate: string | null;
  students: ArrivalSseStudent[];
};

export type ArrivalSseConnectedPayload = {
  type: 'connected';
  clientId: string;
};

export type ArrivalSseHeartbeatPayload = {
  type: 'ping';
  at: string;
};

export type ArrivalSseEnvelope =
  | ArrivalSsePayload
  | ArrivalSseConnectedPayload
  | ArrivalSseHeartbeatPayload;
