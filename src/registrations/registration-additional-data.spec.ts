import { defaultConfigForClientType } from './registration-fields-config';
import { normalizeRegistrationFields } from './registration-additional-data';

describe('normalizeRegistrationFields', () => {
  it('grava CPF/CNPJ somente com dígitos', () => {
    const config = {
      ...defaultConfigForClientType('other'),
      document: 'required' as const,
      phone: 'optional' as const,
      email: 'optional' as const,
      birthDate: 'hidden' as const,
      block: 'hidden' as const,
      unit: 'hidden' as const,
      room: 'hidden' as const,
    };

    const cpf = normalizeRegistrationFields(config, {
      document: '529.982.247-25',
    });
    expect(cpf.document).toBe('52998224725');

    const cnpj = normalizeRegistrationFields(config, {
      document: '11.222.333/0001-81',
    });
    expect(cnpj.document).toBe('11222333000181');
  });
});
