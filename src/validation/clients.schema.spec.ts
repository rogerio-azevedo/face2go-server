import { createClientSchema, updateClientSchema } from './clients.schema';

const baseClient = {
  name: 'Unidade teste',
  type: 'condominium' as const,
  timezoneOffsetMinutes: -240,
  isActive: true,
  autoApproveRegistrations: false,
};

describe('segmento do cliente', () => {
  it('mantém condomínio sem segmento para clientes existentes', () => {
    expect(createClientSchema.safeParse(baseClient).success).toBe(true);
  });

  it('permite mercado em condomínio sem trocar o tipo estrutural', () => {
    expect(
      createClientSchema.safeParse({
        ...baseClient,
        segment: 'condo_market',
      }).success,
    ).toBe(true);
    expect(
      updateClientSchema.safeParse({ segment: 'condo_market' }).success,
    ).toBe(true);
  });

  it('rejeita segmento de mercado em outros tipos de cliente', () => {
    const result = createClientSchema.safeParse({
      ...baseClient,
      type: 'school',
      segment: 'condo_market',
    });
    expect(result.success).toBe(false);
  });
});
