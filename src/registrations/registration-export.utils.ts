import ExcelJS from 'exceljs';

import { toIsoDateString } from '../common/utils/birth-date';
import type { RegistrationListFilter } from '../database/queries/registrations.queries';

export const REGISTRATIONS_XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type RegistrationExportSource = {
  name: string | null;
  document: string | null;
  phone: string | null;
  email: string | null;
  birthDate: unknown;
  additionalData: unknown;
  registrationLinkCode: string | null;
  submittedAt: Date | string | null;
  blockReason: string | null;
  rejectionNotes: string | null;
  status: 'draft' | 'approved' | 'rejected' | 'blocked';
  isActive: boolean;
};

const STATUS_LABEL: Record<RegistrationExportSource['status'], string> = {
  draft: 'Aguardando aprovação',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
  blocked: 'Bloqueado',
};

const FILENAME_SLUG: Record<RegistrationListFilter, string> = {
  draft: 'aguardando-aprovacao',
  approved: 'aprovados',
  rejected: 'rejeitados',
  blocked: 'bloqueados',
  deleted: 'excluidos',
  all: 'todos',
};

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function formatCpf(digits: string): string {
  const d = digits.slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function formatCnpj(digits: string): string {
  const d = digits.slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  }
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function formatDocument(value: string | null): string {
  if (!value) return '';
  const digits = onlyDigits(value);
  if (!digits) return '';
  if (digits.length <= 11) return formatCpf(digits);
  return formatCnpj(digits);
}

function formatBirthDate(value: unknown): string {
  const iso = toIsoDateString(value);
  if (!iso) return '';
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
}

function formatSubmittedAt(value: Date | string | null): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('day')}/${pick('month')}/${pick('year')} ${pick('hour')}:${pick('minute')}`;
}

function extraField(data: unknown, key: 'block' | 'unit' | 'room'): string {
  if (!data || typeof data !== 'object') return '';
  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function tipoLabel(row: RegistrationExportSource): string {
  if (!row.isActive) return 'Excluído';
  return STATUS_LABEL[row.status];
}

function motivo(row: RegistrationExportSource): string {
  const block = row.blockReason?.trim();
  if (block) return block;
  return row.rejectionNotes?.trim() ?? '';
}

function rowCells(
  row: RegistrationExportSource,
  includeTipo: boolean,
): string[] {
  return [
    row.name ?? '',
    formatDocument(row.document),
    row.phone ?? '',
    row.email ?? '',
    formatBirthDate(row.birthDate),
    extraField(row.additionalData, 'block'),
    extraField(row.additionalData, 'unit'),
    extraField(row.additionalData, 'room'),
    row.registrationLinkCode ?? '',
    formatSubmittedAt(row.submittedAt),
    motivo(row),
    ...(includeTipo ? [tipoLabel(row)] : []),
  ];
}

export async function buildRegistrationsXlsx(
  rows: RegistrationExportSource[],
  includeTipo: boolean,
): Promise<Buffer> {
  const header = [
    'Nome',
    'CPF',
    'Telefone',
    'E-mail',
    'Nascimento',
    'Bloco',
    'Unidade',
    'Sala',
    'Link',
    'Enviado',
    'Motivo',
    ...(includeTipo ? ['Tipo'] : []),
  ];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Cadastros');
  sheet.addRow(header);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    const added = sheet.addRow(rowCells(row, includeTipo));
    added.getCell(2).numFmt = '@';
    added.getCell(3).numFmt = '@';
  }
  sheet.columns.forEach((column, index) => {
    const title = header[index];
    column.width = title === 'E-mail' || title === 'Motivo' ? 28 : 18;
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function registrationsExportFilename(
  status: RegistrationListFilter,
): string {
  return `cadastros-${FILENAME_SLUG[status]}.xlsx`;
}
