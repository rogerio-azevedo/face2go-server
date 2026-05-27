export interface IenhSyncError {
  enrollment: string;
  message: string;
}

export interface IenhSyncResult {
  processedRecords: number;
  studentsCreated: number;
  studentsUpdated: number;
  studentsDeactivated: number;
  responsiblesCreated: number;
  responsiblesUpdated: number;
  classesCreated: number;
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
}
