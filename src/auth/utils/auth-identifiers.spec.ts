import { normalizeEmail, normalizeLoginIdentifier } from './auth-identifiers';

describe('normalizeEmail', () => {
  it('remove espaços e converte para minúsculas', () => {
    expect(normalizeEmail('  PSuelrocha@Gmail.com ')).toBe(
      'psuelrocha@gmail.com',
    );
  });
});

describe('normalizeLoginIdentifier', () => {
  it('normaliza e-mail ignorando maiúsculas', () => {
    expect(normalizeLoginIdentifier('PSuelrocha@Gmail.com')).toEqual({
      kind: 'email',
      value: 'psuelrocha@gmail.com',
    });
  });
});
