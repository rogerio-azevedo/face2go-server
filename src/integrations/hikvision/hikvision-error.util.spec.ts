import {
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
