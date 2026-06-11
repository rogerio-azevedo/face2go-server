/** Registro retornado pela API TOTVS IENH (WS.02 — dados pessoais para controle de acesso). */
export interface TotvsIenhRecord {
  CODALUNO: string;
  NOMEALUNO: string;
  DTNASCALUNO: string;
  GENEROALUNO: string;
  NOMECURSO: string;
  CODTURMA: string;
  CODMAE: number;
  NOMEMAE: string;
  CPFMAE: string;
  DTNASCMAE: string;
  GENEROMAE: string;
  EMAILMAE: string;
  TELEFONEMAE: string;
  CODPAI: number;
  NOMEPAI: string;
  CPFPAI: string;
  DTNASCPAI: string;
  GENEROPAI: string;
  EMAILPAI: string;
  TELEFONEPAI: string;
  SITUACAOMAT: string;
  NOMEFILIAL: string;
  STATUSACESSO: string;
  DTENTRADA: string;
  DTSAIDA: string;
}

export interface TotvsIenhFetchParams {
  perlet: string;
  filial: number;
  nivel: number;
}

export interface TotvsIenhSnapshotMeta {
  fetchedAt: string;
  /** PERLET informado pelo usuário (ex.: "2026"). */
  perlet: string;
  /** PERLETs efetivamente buscados na API (ex.: ["2026", "2026/1", "2026/2"]). */
  perlets?: string[];
  filiais: number[];
  niveis: number[];
  requests: TotvsIenhFetchParams[];
  recordCount: number;
}

export interface TotvsIenhSnapshot {
  meta: TotvsIenhSnapshotMeta;
  records: TotvsIenhRecord[];
  /** Preserva filial por registro para re-sync sem inferir de NOMEFILIAL. */
  taggedRecords?: { filial: number; record: TotvsIenhRecord }[];
}
