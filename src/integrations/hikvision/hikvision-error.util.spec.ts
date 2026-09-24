import {
  hikvisionFaceErrorMessage,
  isHikvisionFaceDuplicateError,
  isHikvisionSuccess,
  isHikvisionWipeUnsupported,
  isHikvisionWipeUnsupportedBody,
} from './hikvision-error.util';

describe('isHikvisionWipeUnsupported', () => {
  it('trata 401/404/405 como firmware sem UserInfoDetail', () => {
    expect(isHikvisionWipeUnsupported({ response: { status: 401 } })).toBe(
      true,
    );
    expect(isHikvisionWipeUnsupported({ response: { status: 404 } })).toBe(
      true,
    );
    expect(isHikvisionWipeUnsupported({ response: { status: 405 } })).toBe(
      true,
    );
  });

  it('reconhece subStatus notSupport no body', () => {
    expect(
      isHikvisionWipeUnsupportedBody({
        ResponseStatus: { subStatusCode: 'notSupport' },
      }),
    ).toBe(true);
    expect(
      isHikvisionWipeUnsupported({
        response: {
          status: 400,
          data: { ResponseStatus: { errorMsg: 'notSupport' } },
        },
      }),
    ).toBe(true);
  });

  it('não marca outros erros como unsupported', () => {
    expect(
      isHikvisionWipeUnsupported({
        response: {
          status: 500,
          data: { ResponseStatus: { subStatusCode: 'deviceBusy' } },
        },
      }),
    ).toBe(false);
  });
});

describe('hikvisionFaceErrorMessage', () => {
  it('traduz Unauthorized cru do axios', () => {
    expect(hikvisionFaceErrorMessage(new Error('Unauthorized'))).toMatch(/401/);
    expect(
      hikvisionFaceErrorMessage(
        new Error('Request failed with status code 401'),
      ),
    ).toMatch(/sincronizar de novo/);
  });

  it('reconhece faceDuplicate mesmo aninhado em cause', () => {
    const error = new Error('falha');
    error.cause = {
      response: { data: { subStatusCode: 'alreadyExistThisFace' } },
    };
    expect(isHikvisionFaceDuplicateError(error)).toBe(true);
    expect(
      isHikvisionFaceDuplicateError({
        response: { data: { subStatusCode: 'deviceUserAlreadyExistFace' } },
      }),
    ).toBe(false);
  });

  it('traduz faceDuplicate para foto já cadastrada', () => {
    expect(
      hikvisionFaceErrorMessage({
        response: {
          data: { statusCode: 6, subStatusCode: 'faceDuplicate' },
        },
      }),
    ).toBe('Foto já cadastrada.');
  });

  it('traduz alreadyExistThisFace (MinMoe) para foto já cadastrada', () => {
    expect(
      hikvisionFaceErrorMessage({
        response: {
          data: {
            statusCode: 4,
            subStatusCode: 'alreadyExistThisFace',
            errorMsg: 'saveFacePic',
          },
        },
      }),
    ).toBe('Foto já cadastrada.');
  });
});

describe('isHikvisionSuccess', () => {
  it('não trata faceDuplicate como sucesso mesmo com statusCode 1', () => {
    expect(
      isHikvisionSuccess({
        statusCode: 1,
        statusString: 'OK',
        subStatusCode: 'faceDuplicate',
      }),
    ).toBe(false);
  });

  it('aceita statusCode 1 sem duplicata', () => {
    expect(isHikvisionSuccess({ statusCode: 1, subStatusCode: 'ok' })).toBe(
      true,
    );
  });
});
