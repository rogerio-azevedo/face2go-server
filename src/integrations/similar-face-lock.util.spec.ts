import { restoreSimilarFaceLock } from './similar-face-lock.util';

describe('restoreSimilarFaceLock', () => {
  it('aceita a primeira religação', async () => {
    const enable = jest.fn().mockResolvedValue(undefined);
    await restoreSimilarFaceLock(enable);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it('tenta de novo e avisa se a trava continuar aberta', async () => {
    const enable = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('offline'));
    await expect(restoreSimilarFaceLock(enable)).rejects.toThrow(
      /pode ter ficado desligada/,
    );
    expect(enable).toHaveBeenCalledTimes(2);
  });
});
