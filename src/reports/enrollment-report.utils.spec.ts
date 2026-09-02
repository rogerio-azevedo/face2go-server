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

  it('gera CSV de alunos com turma, sincronismo e face', () => {
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
        deviceSyncError: null,
        hasLogin: false,
      },
    ]);
    expect(csv).toContain('Nome,Turma,Sincronismo,Face');
    expect(csv).toContain('"Ana, Silva"');
    expect(csv).toContain('1º A');
    expect(csv).toContain('Sincronizado');
    expect(csv).toContain('Sim');
    expect(csv).not.toContain('Veículo');
    expect(csv).not.toContain('Acesso login');
  });

  it('gera CSV de responsáveis com login, sincronismo e veículo', () => {
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
        deviceSyncError: null,
        hasLogin: true,
      },
    ]);
    expect(csv).toContain('Nome,Acesso login,Sincronismo,Face,Veículo');
    expect(csv).toContain('Carlos,Sim,Sem foto,Não,Sim');
  });

  it('marca falha de sincronismo no CSV', () => {
    const csv = buildEnrollmentCsv('members', [
      {
        id: '1',
        name: 'Maria',
        className: null,
        photoKey: null,
        roleName: 'Professor',
        hasFace: true,
        hasVehicle: false,
        deviceSyncStatus: 'sync_failed',
        deviceSyncError: 'Timeout',
        hasLogin: false,
      },
    ]);
    expect(csv).toContain('Nome,Função,Acesso login,Sincronismo,Face,Veículo');
    expect(csv).toContain('Maria,Professor,—,Erro,Sim,Não');
  });
});
