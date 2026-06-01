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
  /** ID do responsável quando `kind === 'responsible'`; usado para dequeue. */
  responsibleId: string | null;
  personName: string | null;
  personPhotoUrl: string | null;
  readerName: string;
  eventDate: string | null;
  /** Placa do veículo do responsável ou de co-responsável pelo mesmo aluno. */
  vehiclePlate: string | null;
  students: ArrivalSseStudent[];
};

/** Remove o responsável da fila do display (ex.: filho passou no leitor). */
export type ArrivalSseDequeuePayload = {
  type: 'dequeue';
  responsibleId: string;
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
  | ArrivalSseDequeuePayload
  | ArrivalSseConnectedPayload
  | ArrivalSseHeartbeatPayload;
