export interface IenhSyncError {
  enrollment: string;
  message: string;
}

export interface IenhSyncResult {
  processedRecords: number;
  studentsCreated: number;
  studentsUpdated: number;
  studentsDeactivated: number;
  /** Desativados via upsert (STATUSACESSO = Bloqueado). */
  studentsDeactivatedByStatus: number;
  /** Desativados por ausência no snapshot (deactivateStudentsNotInList). */
  studentsDeactivatedByAbsence: number;
  /** Matrículas desativadas por ausência no snapshot (diagnóstico). */
  deactivatedByAbsenceEnrollments: string[];
  responsiblesCreated: number;
  responsiblesUpdated: number;
  accountsCreated: number;
  /** Contas não vinculadas por conflito CPF/e-mail (pessoas diferentes). */
  accountsSkippedEmailConflict: number;
  classesCreated: number;
  classesMerged: number;
  classLinksCreated: number;
  classLinksUpdated: number;
  classLinksDeactivated: number;
  classLinksDeduped: number;
  linksCreated: number;
  errors: IenhSyncError[];
  durationMs: number;
}

export interface TotvsIenhRecordWithFilial {
  filial: number;
  record: import('./totvs-ienh.types').TotvsIenhRecord;
}

export interface IenhSnapshotInfo {
  file: string;
  recordCount: number;
  fetchedAt: string;
  perlet: string;
  perlets?: string[];
}
