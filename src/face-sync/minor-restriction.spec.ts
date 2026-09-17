import {
  formatRestrictedReaderSyncError,
  isPersonAllowedOnReader,
  partitionReadersByMinorRestriction,
  restrictedReaderSkipReason,
} from './minor-restriction';

describe('minor-restriction', () => {
  const restricted = { restrictMinors: true };
  const open = { restrictMinors: false };
  const today = new Date(2026, 8, 15);

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
    expect(restrictedReaderSkipReason(null)).toBe('missing_birth_date');
    expect(restrictedReaderSkipReason('ontem')).toBe('missing_birth_date');
    expect(restrictedReaderSkipReason('2012-01-01')).toBe('minor');
    expect(
      formatRestrictedReaderSyncError('Porta Cervejeira', 'missing_birth_date'),
    ).toBe('Porta Cervejeira: sem data de nascimento.');
  });
});
