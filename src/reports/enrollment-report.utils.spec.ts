import {
  buildEnrollmentCsv,
  groupIncludesVehicle,
  percentOf,
} from './enrollment-report.utils';

describe('enrollment-report.utils', () => {
  it('calcula percentual inteiro e trata total zero', () => {
    expect(percentOf(1, 2)).toBe(50);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(3, 3)).toBe(100);
  });

  it('veículo só entra para responsáveis e membros', () => {
    expect(groupIncludesVehicle('students')).toBe(false);
    expect(groupIncludesVehicle('responsibles')).toBe(true);
    expect(groupIncludesVehicle('members')).toBe(true);
  });

  it('gera CSV de alunos com turma e face', () => {
    const csv = buildEnrollmentCsv('students', [
      {
        id: '1',
        name: 'Ana, Silva',
        className: '1º A',
        photoKey: null,
        roleName: null,
        hasFace: true,
        hasVehicle: false,
        deviceSyncStatus: 'synced',
      },
    ]);
    expect(csv).toContain('Nome,Turma,Face');
    expect(csv).toContain('"Ana, Silva"');
    expect(csv).toContain('1º A');
    expect(csv).toContain('Sim');
    expect(csv).not.toContain('Veículo');
  });

  it('gera CSV de responsáveis com veículo', () => {
    const csv = buildEnrollmentCsv('responsibles', [
      {
        id: '1',
        name: 'Carlos',
        className: null,
        photoKey: null,
        roleName: null,
        hasFace: false,
        hasVehicle: true,
        deviceSyncStatus: null,
      },
    ]);
    expect(csv).toContain('Nome,Face,Veículo');
    expect(csv).toContain('Carlos,Não,Sim');
  });
});
