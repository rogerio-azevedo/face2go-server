import {
  describeIntelbrasFacialHttpError,
  getErrorInfo,
} from './intelbras-error-codes.util';

describe('intelbras-error-codes.util', () => {
  it('expande FailCodes em vez da mensagem Batch Process Error', () => {
    const info = getErrorInfo({
      code: 268632336,
      detail: { FailCodes: [286064922], FailCount: 1 },
      message: 'Batch Process Error',
    });

    expect(info.isKnown).toBe(true);
    expect(info.failCodes).toEqual([286064922]);
    expect(info.message).toMatch(/não conseguiu extrair o rosto/i);
  });

  it('ignora o envelope de lote sem FailCodes', () => {
    expect(
      describeIntelbrasFacialHttpError({
        code: 268632336,
        message: 'Batch Process Error',
      }),
    ).toBeNull();
  });

  it('traduz código de face inválida', () => {
    expect(
      describeIntelbrasFacialHttpError({
        code: 286064900,
        message: 'The issued face data is wrong',
      }),
    ).toMatch(/dados de face inválidos/i);
  });
});
