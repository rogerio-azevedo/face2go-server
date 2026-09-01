import {
  describeIntelbrasFacialHttpError,
  getErrorInfo,
  isDuplicateFaceEnrollmentError,
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

  it('traduz FailCode 288686092 (features já existentes / gêmeos)', () => {
    const body = {
      code: 268632336,
      detail: { FailCodes: [288686092], FailCount: 1 },
      message: 'Batch Process Error',
    };

    const info = getErrorInfo(body);
    expect(info.isKnown).toBe(true);
    expect(info.failCodes).toEqual([288686092]);
    expect(info.message).toMatch(/já está cadastrado/i);
    expect(info.message).toMatch(/gêmeos/i);
    expect(info.message).not.toMatch(/qualidade insuficiente/i);

    expect(describeIntelbrasFacialHttpError(body)).toBe(info.message);
  });

  it('traduz FailCode 286064926 (foto duplicada / EnableRepFaceFilt)', () => {
    expect(
      describeIntelbrasFacialHttpError({
        code: 268632336,
        detail: { FailCodes: [286064926], FailCount: 1 },
        message: 'Batch Process Error',
      }),
    ).toMatch(/arquivo duplicado/i);
  });

  it('traduz FailCode de nenhum rosto detectado (288686087)', () => {
    expect(
      describeIntelbrasFacialHttpError({
        code: 268632336,
        detail: { FailCodes: [288686087], FailCount: 1 },
        message: 'Batch Process Error',
      }),
    ).toMatch(/nenhum rosto detectado/i);
  });

  it('reconhece duplicata de face no FailCode e no Axios', () => {
    const body = {
      code: 268632336,
      detail: { FailCodes: [288686092], FailCount: 1 },
      message: 'Batch Process Error',
    };
    expect(isDuplicateFaceEnrollmentError(body)).toBe(true);
    expect(
      isDuplicateFaceEnrollmentError({
        response: { status: 400, data: body },
      }),
    ).toBe(true);
    expect(
      isDuplicateFaceEnrollmentError({
        code: 268632336,
        detail: { FailCodes: [286064922], FailCount: 1 },
        message: 'Batch Process Error',
      }),
    ).toBe(false);
  });
});
