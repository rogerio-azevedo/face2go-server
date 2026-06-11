import type { TotvsIenhRecord } from './types/totvs-ienh.types';

export const IENH_FILIAL_LABELS: Record<number, string> = {
  1: 'Unidade Oswaldo Cruz',
  2: 'Unidade Pindorama',
  3: 'Unidade Fundação Evangélica',
};

const FILIAL_BY_BRANCH_NAME: Record<string, number> = {
  'Unidade Oswaldo Cruz': 1,
  'Unidade Pindorama': 2,
  'Unidade Fundação Evangélica': 3,
};

export type SituacaoMatricula =
  | 'enrolled'
  | 'transferred'
  | 'cancelled'
  | 'pre_enrolled'
  | 'locked';

export function normalizeDocument(
  raw: string | number | null | undefined,
): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 11 ? digits : null;
}

export function parseTotvsDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isPreMatriculado(raw: string): boolean {
  const normalized = raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  return normalized.startsWith('pre-matricul');
}

export function mapSituacaoMatricula(raw: string): SituacaoMatricula | null {
  const v = raw.trim();
  if (v === 'Matriculado') return 'enrolled';
  if (v === 'Transferido') return 'transferred';
  if (v === 'Curso Cancelado') return 'cancelled';
  if (v === 'Trancado') return 'locked';
  if (isPreMatriculado(v)) return 'pre_enrolled';
  return null;
}

export function mapStatusAcessoToIsActive(status: string): boolean {
  return status.trim().toLowerCase() === 'liberado';
}

export function resolveFilialFromRecord(
  record: TotvsIenhRecord,
): number | null {
  const name = record.NOMEFILIAL?.trim();
  if (name && FILIAL_BY_BRANCH_NAME[name]) {
    return FILIAL_BY_BRANCH_NAME[name];
  }
  return null;
}

export function parsePerletYear(perlet: string): number {
  const match = /^(\d{4})/.exec(perlet.trim());
  if (match) {
    return Number.parseInt(match[1], 10);
  }
  return new Date().getFullYear();
}

/** Prioridade na deduplicação: menor = preferido (perlet anual vence sobre semestral). */
export function perletMergePriority(perlet: string): number {
  const trimmed = perlet.trim();
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) return 0;
  const semester = Number.parseInt(trimmed.slice(slashIdx + 1), 10);
  return Number.isFinite(semester) ? semester : 99;
}

/**
 * PERLET anual (ex.: "2026") inclui educação básica + busca automática de
 * "2026/1" e "2026/2" (técnico/faculdade). PERLET semestral explícito busca só ele.
 */
export function resolvePerlets(perlet: string): string[] {
  const trimmed = perlet.trim();
  if (!trimmed) {
    const year = String(new Date().getFullYear());
    return [year, `${year}/1`, `${year}/2`];
  }
  if (trimmed.includes('/')) {
    return [trimmed];
  }
  return [trimmed, `${trimmed}/1`, `${trimmed}/2`];
}

export function normalizeEnrollment(codAluno: string): string {
  return codAluno.trim();
}

export function normalizePhone(
  raw: string | number | null | undefined,
): string | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}
