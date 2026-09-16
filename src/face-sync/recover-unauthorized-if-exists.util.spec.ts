import {
  isUnauthorizedDeviceError,
  recoverUnauthorizedIfExists,
} from './recover-unauthorized-if-exists.util';

describe('isUnauthorizedDeviceError', () => {
  it('reconhece HTTP 401/403 no response', () => {
    expect(
      isUnauthorizedDeviceError({ response: { status: 401 } }),
    ).toBe(true);
    expect(
      isUnauthorizedDeviceError({ response: { status: 403 } }),
    ).toBe(true);
  });

  it('reconhece texto Unauthorized e credenciais inválidas', () => {
    expect(isUnauthorizedDeviceError(new Error('Unauthorized'))).toBe(true);
    expect(
      isUnauthorizedDeviceError(
        new Error('Credenciais inválidas para o leitor.'),
      ),
    ).toBe(true);
  });

  it('segue o cause de erro encapsulado', () => {
    const wrapped = new Error('foto facial: Unauthorized');
    wrapped.cause = { response: { status: 401 } };
    expect(isUnauthorizedDeviceError(wrapped)).toBe(true);
  });

  it('não marca outros erros', () => {
    expect(isUnauthorizedDeviceError(new Error('timeout'))).toBe(false);
    expect(
      isUnauthorizedDeviceError({ response: { status: 500 } }),
    ).toBe(false);
  });
});

describe('recoverUnauthorizedIfExists', () => {
  it('Unauthorized + face presente → sucesso', async () => {
    const checkExists = jest.fn().mockResolvedValue(true);
    await expect(
      recoverUnauthorizedIfExists(new Error('Unauthorized'), checkExists),
    ).resolves.toBe(true);
    expect(checkExists).toHaveBeenCalled();
  });

  it('Unauthorized + face ausente → relança (false)', async () => {
    const checkExists = jest.fn().mockResolvedValue(false);
    await expect(
      recoverUnauthorizedIfExists(
        { response: { status: 401 } },
        checkExists,
      ),
    ).resolves.toBe(false);
  });

  it('Unauthorized + verify 401 → false', async () => {
    const checkExists = jest
      .fn()
      .mockRejectedValue(new Error('Unauthorized'));
    await expect(
      recoverUnauthorizedIfExists(new Error('Unauthorized'), checkExists),
    ).resolves.toBe(false);
  });

  it('erro que não é Unauthorized não consulta o leitor', async () => {
    const checkExists = jest.fn();
    await expect(
      recoverUnauthorizedIfExists(new Error('timeout'), checkExists),
    ).resolves.toBe(false);
    expect(checkExists).not.toHaveBeenCalled();
  });
});
