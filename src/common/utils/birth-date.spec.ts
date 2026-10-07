import {
  calculateAge,
  calculateAgeOnDate,
  isMinor,
  parseIsoDateParts,
  toIsoDateString,
} from './birth-date';

describe('birth-date', () => {
  it('calcula idade sem usar UTC na data de nascimento', () => {
    const today = new Date(2026, 8, 15);
    expect(calculateAge('2008-09-16', today)).toBe(17);
    expect(calculateAge('2008-09-15', today)).toBe(18);
    expect(calculateAge('2008-09-14', today)).toBe(18);
  });

  it('isMinor usa 18 como padrão', () => {
    const today = new Date(2026, 8, 15);
    expect(isMinor('2008-09-16', 18, today)).toBe(true);
    expect(isMinor('2008-09-15', 18, today)).toBe(false);
  });

  it('toIsoDateString aceita string e Date', () => {
    expect(toIsoDateString('2010-01-02')).toBe('2010-01-02');
    expect(toIsoDateString(new Date(Date.UTC(2010, 0, 2)))).toBe('2010-01-02');
    expect(toIsoDateString(null)).toBeNull();
  });

  it('rejeita dias inexistentes e aceita ano bissexto', () => {
    expect(parseIsoDateParts('2026-02-31')).toBeNull();
    expect(parseIsoDateParts('2025-02-29')).toBeNull();
    expect(parseIsoDateParts('2024-02-29')).toEqual({ y: 2024, m: 2, d: 29 });
  });

  it('calcula idade usando duas datas civis', () => {
    expect(calculateAgeOnDate('2014-09-15', '2026-09-15')).toBe(12);
    expect(calculateAgeOnDate('2014-09-16', '2026-09-15')).toBe(11);
  });
});
