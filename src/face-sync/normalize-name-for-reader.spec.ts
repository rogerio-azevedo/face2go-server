import {
  INTELBRAS_CARD_NAME_MAX_LENGTH,
  normalizeNameForFacialReader,
} from './normalize-name-for-reader';

describe('normalizeNameForFacialReader', () => {
  it('mantém o token do meio quando o nome cabe', () => {
    expect(normalizeNameForFacialReader('Maya 2 teste')).toBe('MAYA 2 TESTE');
  });

  it('remove acento e deixa em maiúsculas', () => {
    expect(normalizeNameForFacialReader('João Silva')).toBe('JOAO SILVA');
  });

  it('cai para primeiro e último quando passa de 50 caracteres', () => {
    const full = `Maria ${'Nomemeio '.repeat(5)}Silva`;
    expect(normalizeNameForFacialReader(full)).toBe('MARIA SILVA');
    expect(normalizeNameForFacialReader(full).length).toBeLessThanOrEqual(50);
  });

  it('limita CardName da Intelbras a 32 caracteres', () => {
    const name = 'MARIA APARECIDA DOS SANTOS PEREIRA';
    expect(name.length).toBeGreaterThan(INTELBRAS_CARD_NAME_MAX_LENGTH);
    expect(
      normalizeNameForFacialReader(name, INTELBRAS_CARD_NAME_MAX_LENGTH),
    ).toBe('MARIA PEREIRA');
  });
});
