import {
  formatCnpj,
  isValidCnpj,
  isValidCpf,
  isValidCpfOrCnpj,
  onlyDigits,
} from './document';

describe('document utils', () => {
  it('onlyDigits remove máscara', () => {
    expect(onlyDigits('11.222.333/0001-81')).toBe('11222333000181');
    expect(onlyDigits('529.982.247-25')).toBe('52998224725');
  });

  describe('isValidCpf', () => {
    it('aceita CPF válido', () => {
      expect(isValidCpf('529.982.247-25')).toBe(true);
      expect(isValidCpf('52998224725')).toBe(true);
    });

    it('rejeita dígito verificador errado', () => {
      expect(isValidCpf('529.982.247-24')).toBe(false);
    });

    it('rejeita sequência repetida', () => {
      expect(isValidCpf('00000000000')).toBe(false);
      expect(isValidCpf('111.111.111-11')).toBe(false);
    });

    it('rejeita tamanho inválido', () => {
      expect(isValidCpf('123')).toBe(false);
      expect(isValidCpf('')).toBe(false);
    });
  });

  describe('isValidCnpj', () => {
    it('aceita CNPJ válido', () => {
      expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
      expect(isValidCnpj('11222333000181')).toBe(true);
      expect(isValidCnpj('04.252.011/0001-10')).toBe(true);
    });

    it('rejeita dígito verificador errado', () => {
      expect(isValidCnpj('11.222.333/0001-80')).toBe(false);
    });

    it('rejeita sequência repetida', () => {
      expect(isValidCnpj('00000000000000')).toBe(false);
      expect(isValidCnpj('11.111.111/1111-11')).toBe(false);
    });

    it('rejeita tamanho inválido', () => {
      expect(isValidCnpj('123')).toBe(false);
    });
  });

  describe('isValidCpfOrCnpj', () => {
    it('aceita CPF ou CNPJ', () => {
      expect(isValidCpfOrCnpj('52998224725')).toBe(true);
      expect(isValidCpfOrCnpj('11222333000181')).toBe(true);
    });

    it('rejeita tamanho intermediário', () => {
      expect(isValidCpfOrCnpj('123456789012')).toBe(false);
    });
  });

  it('formatCnpj aplica máscara progressiva', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('11222')).toBe('11.222');
  });
});
