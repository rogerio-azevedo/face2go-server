import {
  enrichDeviceUserRecords,
  namesMismatch,
  parseDeviceUserFaceId,
} from './device-user-reconcile.util';

describe('parseDeviceUserFaceId', () => {
  it('aceita IDs com zeros à esquerda', () => {
    expect(parseDeviceUserFaceId('00000405')).toBe(405);
  });

  it('rejeita valores não numéricos ou não positivos', () => {
    expect(parseDeviceUserFaceId('abc')).toBeNull();
    expect(parseDeviceUserFaceId('0')).toBeNull();
    expect(parseDeviceUserFaceId('-1')).toBeNull();
    expect(parseDeviceUserFaceId('1.5')).toBeNull();
  });
});

describe('namesMismatch', () => {
  it('ignora caixa e acento', () => {
    expect(namesMismatch('JOAO SILVA', 'João Silva')).toBe(false);
  });

  it('aceita o formato gravado no leitor (primeiro + último)', () => {
    expect(namesMismatch('MARIA SILVA', 'Maria da Costa Silva')).toBe(false);
  });

  it('marca divergência quando os nomes são de pessoas diferentes', () => {
    expect(namesMismatch('RONALDO TORRES', 'Ana Souza')).toBe(true);
  });
});

describe('enrichDeviceUserRecords', () => {
  it('marca inSystem e nameMismatch', () => {
    const persons = new Map([
      [10, { faceId: 10, name: 'Maria Silva', personType: 'member' as const }],
    ]);
    const [inSystem, orphan] = enrichDeviceUserRecords(
      [
        { UserID: '00000010', CardName: 'MARIA SILVA', CardNo: '10' },
        { UserID: '00000405', CardName: 'RONALDO TORRES', CardNo: '405' },
      ],
      persons,
    );

    expect(inSystem.inSystem).toBe(true);
    expect(inSystem.personType).toBe('member');
    expect(inSystem.nameMismatch).toBe(false);
    expect(orphan.inSystem).toBe(false);
    expect(orphan.personType).toBeNull();
  });
});
