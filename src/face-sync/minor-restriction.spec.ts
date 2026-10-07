import {
  evaluatePersonAgeAccess,
  formatRestrictedReaderSyncError,
  isPersonAllowedOnReader,
  partitionReadersByMinorRestriction,
  restrictedReaderSkipReason,
} from './minor-restriction';

describe('minor-restriction', () => {
  const restricted = { restrictMinors: true };
  const open = { restrictMinors: false };
  const today = new Date('2026-09-15T12:00:00.000Z');

  it('leitor sem restrição aceita qualquer pessoa', () => {
    expect(isPersonAllowedOnReader(open, null)).toBe(true);
    expect(isPersonAllowedOnReader(open, '2015-01-01')).toBe(true);
  });

  it('leitor restrito recusa quem não tem data de nascimento', () => {
    expect(isPersonAllowedOnReader(restricted, null)).toBe(false);
  });

  it('leitor restrito recusa data ilegível (não trata como adulto)', () => {
    expect(isPersonAllowedOnReader(restricted, 'ontem')).toBe(false);
    expect(isPersonAllowedOnReader(restricted, '10/10/2012')).toBe(false);
  });

  it('leitor restrito recusa Date de menor (normaliza via toIsoDateString)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(today);
    expect(
      isPersonAllowedOnReader(restricted, new Date('2012-10-10T04:00:00.000Z')),
    ).toBe(false);
    jest.useRealTimers();
  });

  it('leitor restrito recusa menor de 18', () => {
    jest.useFakeTimers();
    jest.setSystemTime(today);
    expect(isPersonAllowedOnReader(restricted, '2008-09-16')).toBe(false);
    jest.useRealTimers();
  });

  it('leitor restrito aceita quem completa 18 hoje', () => {
    jest.useFakeTimers();
    jest.setSystemTime(today);
    expect(isPersonAllowedOnReader(restricted, '2008-09-15')).toBe(true);
    expect(isPersonAllowedOnReader(restricted, '2000-01-01')).toBe(true);
    jest.useRealTimers();
  });

  it('aceita quem completa a idade configurada e recusa quem ainda não completou', () => {
    const twelvePlus = { minimumAccessAge: 12, timezoneOffsetMinutes: -240 };
    expect(
      evaluatePersonAgeAccess(twelvePlus, '2014-09-15', today),
    ).toMatchObject({ allowed: true, age: 12, reason: 'allowed' });
    expect(
      evaluatePersonAgeAccess(twelvePlus, '2014-09-16', today),
    ).toMatchObject({
      allowed: false,
      age: 11,
      reason: 'below_minimum_age',
    });
  });

  it('nega data futura e data civil inválida', () => {
    const twelvePlus = { minimumAccessAge: 12 };
    expect(
      evaluatePersonAgeAccess(twelvePlus, '2027-01-01', today).reason,
    ).toBe('future_birth_date');
    expect(
      evaluatePersonAgeAccess(twelvePlus, '2020-02-31', today).reason,
    ).toBe('invalid_birth_date');
  });

  it('particiona leitores permitidos e restritos', () => {
    jest.useFakeTimers();
    jest.setSystemTime(today);
    const readers = [
      { id: 'a', restrictMinors: false },
      { id: 'b', restrictMinors: true },
      { id: 'c', restrictMinors: true },
    ];
    const minor = partitionReadersByMinorRestriction(readers, '2012-01-01');
    expect(minor.allowed.map((r) => r.id)).toEqual(['a']);
    expect(minor.restricted.map((r) => r.id)).toEqual(['b', 'c']);

    const adult = partitionReadersByMinorRestriction(readers, '2000-01-01');
    expect(adult.restricted).toHaveLength(0);
    expect(adult.allowed).toHaveLength(3);

    const missing = partitionReadersByMinorRestriction(readers, null);
    expect(missing.allowed.map((r) => r.id)).toEqual(['a']);
    jest.useRealTimers();
  });

  it('classifica skip sem data vs menor', () => {
    jest.useFakeTimers();
    jest.setSystemTime(today);
    expect(restrictedReaderSkipReason(restricted, null)).toBe(
      'missing_birth_date',
    );
    expect(restrictedReaderSkipReason(restricted, 'ontem')).toBe(
      'invalid_birth_date',
    );
    expect(restrictedReaderSkipReason(restricted, '2012-01-01')).toBe(
      'below_minimum_age',
    );
    expect(
      formatRestrictedReaderSyncError('Porta Cervejeira', 'missing_birth_date'),
    ).toBe('Porta Cervejeira: sem data de nascimento.');
    jest.useRealTimers();
  });
});
