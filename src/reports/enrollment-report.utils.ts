import type { EnrollmentGroup } from '../validation/reports.schema';
import type { EnrollmentListRow } from '../database/queries/reports.queries';

export function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

export function groupIncludesVehicle(group: EnrollmentGroup): boolean {
  return group !== 'students';
}

export const ENROLLMENT_GROUP_LABEL: Record<EnrollmentGroup, string> = {
  students: 'Alunos',
  responsibles: 'Responsáveis',
  members: 'Membros',
};

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function simNao(value: boolean): string {
  return value ? 'Sim' : 'Não';
}

export function buildEnrollmentCsv(
  group: EnrollmentGroup,
  rows: EnrollmentListRow[],
): string {
  const includeClass = group === 'students';
  const includeRole = group === 'members';
  const includeVehicle = groupIncludesVehicle(group);
  const header = [
    'Nome',
    ...(includeClass ? ['Turma'] : []),
    ...(includeRole ? ['Função'] : []),
    'Face',
    ...(includeVehicle ? ['Veículo'] : []),
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    const cells = [
      csvCell(row.name),
      ...(includeClass ? [csvCell(row.className ?? '')] : []),
      ...(includeRole ? [csvCell(row.roleName ?? '')] : []),
      csvCell(simNao(row.hasFace)),
      ...(includeVehicle ? [csvCell(simNao(row.hasVehicle))] : []),
    ];
    lines.push(cells.join(','));
  }
  return lines.join('\r\n');
}

export function enrollmentExportFilename(group: EnrollmentGroup): string {
  const slug: Record<EnrollmentGroup, string> = {
    students: 'alunos',
    responsibles: 'responsaveis',
    members: 'membros',
  };
  return `relatorio-cadastro-${slug[group]}.csv`;
}
