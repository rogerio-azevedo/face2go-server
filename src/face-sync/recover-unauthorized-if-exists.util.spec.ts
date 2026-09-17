import {
  isUnauthorizedDeviceError,
  recoverUnauthorizedIfExists,
  retryOnUnauthorizedDeviceError,
} from './recover-unauthorized-if-exists.util';

describe('isUnauthorizedDeviceError', () => {
  it('reconhece HTTP 401/403 no response', () => {
    expect(isUnauthorizedDeviceError({ response: { status: 401 } })).toBe(true);
    expect(isUnauthorizedDeviceError({ response: { status: 403 } })).toBe(true);
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
    expect(isUnauthorizedDeviceError({ response: { status: 500 } })).toBe(
      false,
    );
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
      recoverUnauthorizedIfExists({ response: { status: 401 } }, checkExists),
    ).resolves.toBe(false);
  });

  it('Unauthorized + verify 401 → false', async () => {
    const checkExists = jest.fn().mockRejectedValue(new Error('Unauthorized'));
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

describe('retryOnUnauthorizedDeviceError', () => {
  it('refaz a operação após Unauthorized e conclui', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('Unauthorized'))
      .mockResolvedValueOnce('ok');
    const beforeRetry = jest.fn();

    await expect(
      retryOnUnauthorizedDeviceError(fn, { delayMs: 0, beforeRetry }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(beforeRetry).toHaveBeenCalledTimes(1);
  });

  it('não tenta de novo em timeout', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(
      retryOnUnauthorizedDeviceError(fn, { delayMs: 0 }),
    ).rejects.toThrow('timeout');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('esgota retries e relança o 401', async () => {
    const fn = jest.fn().mockRejectedValue({ response: { status: 401 } });
    await expect(
      retryOnUnauthorizedDeviceError(fn, { retries: 1, delayMs: 0 }),
    ).rejects.toEqual({ response: { status: 401 } });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
