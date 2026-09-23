import ExcelJS from 'exceljs';

import {
  buildRegistrationsXlsx,
  registrationsExportFilename,
  type RegistrationExportSource,
} from './registration-export.utils';

function row(
  overrides: Partial<RegistrationExportSource> = {},
): RegistrationExportSource {
  return {
    name: 'Ana Silva',
    document: '52998224725',
    phone: '11999999999',
    email: 'ana@example.com',
    birthDate: '1993-07-26',
    additionalData: { block: '12', unit: '304', room: 'A' },
    registrationLinkCode: '3UP0TGV9',
    submittedAt: new Date('2026-09-23T09:25:00.000Z'),
    blockReason: null,
    rejectionNotes: null,
    status: 'approved',
    isActive: true,
    ...overrides,
  };
}

async function sheetOf(rows: RegistrationExportSource[], includeTipo: boolean) {
  const buffer = await buildRegistrationsXlsx(rows, includeTipo);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Cadastros');
  if (!sheet) throw new Error('Planilha Cadastros ausente.');
  return sheet;
}

function headerOf(sheet: ExcelJS.Worksheet): string[] {
  const values = sheet.getRow(1).values;
  return Array.isArray(values) ? values.slice(1).map(String) : [];
}

function lineOf(sheet: ExcelJS.Worksheet, rowNumber: number): string[] {
  const values = sheet.getRow(rowNumber).values;
  return Array.isArray(values) ? values.slice(1).map(String) : [];
}

describe('registration-export.utils', () => {
  it('gera planilha de um status sem a coluna Tipo e mascara o CPF', async () => {
    const sheet = await sheetOf(
      [row({ name: 'Ana, Silva', rejectionNotes: 'Documento ilegível' })],
      false,
    );
    expect(headerOf(sheet)).toEqual([
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
    ]);
    const line = lineOf(sheet, 2);
    expect(line).toContain('Ana, Silva');
    expect(line).toContain('529.982.247-25');
    expect(line).toContain('11999999999');
    expect(line).toContain('26/07/1993');
    expect(line).toContain('23/09/2026 06:25');
    expect(line).toContain('Documento ilegível');
    expect(line).toContain('3UP0TGV9');
    expect(headerOf(sheet)).not.toContain('Tipo');
  });

  it('inclui Tipo em Todos e Excluído prevalece sobre o status', async () => {
    const sheet = await sheetOf(
      [
        row({ status: 'approved', isActive: false, blockReason: 'Saída' }),
        row({
          name: 'Bruno',
          status: 'draft',
          isActive: true,
          document: '11222333000181',
        }),
      ],
      true,
    );
    expect(headerOf(sheet)).toEqual([
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
      'Tipo',
    ]);
    const excluded = lineOf(sheet, 2).join('|');
    expect(excluded).toContain('Excluído');
    expect(excluded).not.toContain('Aprovado');
    expect(excluded).toContain('Saída');
    const draft = lineOf(sheet, 3).join('|');
    expect(draft).toContain('Aguardando aprovação');
    expect(draft).toContain('11.222.333/0001-81');
  });

  it('nomeia o arquivo pelo status escolhido', () => {
    expect(registrationsExportFilename('approved')).toBe(
      'cadastros-aprovados.xlsx',
    );
    expect(registrationsExportFilename('deleted')).toBe(
      'cadastros-excluidos.xlsx',
    );
    expect(registrationsExportFilename('all')).toBe('cadastros-todos.xlsx');
  });
});
