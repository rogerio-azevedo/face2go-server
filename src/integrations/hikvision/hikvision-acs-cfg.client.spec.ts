import {
  collectBlockListAuthFieldNames,
  hikvisionEnsureBlockListAuth,
  isHikvisionEnabledFlag,
  resetHikvisionAcsCfgCache,
} from './hikvision-acs-cfg.client';

jest.mock('./hikvision-isapi-request', () => ({
  hikvisionIsapiRequest: jest.fn(),
}));

import { hikvisionIsapiRequest } from './hikvision-isapi-request';

const connection = {
  baseUrl: 'http://192.168.1.181:80',
  username: 'admin',
  password: 'secret',
};

describe('collectBlockListAuthFieldNames', () => {
  it('encontra blockListAuth e blackListAuth aninhados', () => {
    const names = collectBlockListAuthFieldNames({
      AcsCfg: {
        blockListAuth: { '@opt': 'true,false' },
        nested: { blackListAuth: false },
      },
    });

    expect(names).toEqual(
      expect.arrayContaining(['blockListAuth', 'blackListAuth']),
    );
  });
});

describe('isHikvisionEnabledFlag', () => {
  it('aceita true/1/"true"', () => {
    expect(isHikvisionEnabledFlag(true)).toBe(true);
    expect(isHikvisionEnabledFlag(1)).toBe(true);
    expect(isHikvisionEnabledFlag('true')).toBe(true);
    expect(isHikvisionEnabledFlag(false)).toBe(false);
  });
});

describe('hikvisionEnsureBlockListAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetHikvisionAcsCfgCache();
  });

  it('não faz PUT quando o toggle já está habilitado', async () => {
    jest
      .mocked(hikvisionIsapiRequest)
      .mockResolvedValueOnce({
        status: 200,
        data: { AcsCfg: { blockListAuth: { '@opt': 'true,false' } } },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        data: { AcsCfg: { blockListAuth: true } },
      } as never);

    await hikvisionEnsureBlockListAuth(connection);

    expect(hikvisionIsapiRequest).toHaveBeenCalledTimes(2);
    expect(jest.mocked(hikvisionIsapiRequest).mock.calls[1]?.[1]).toMatchObject(
      {
        method: 'GET',
      },
    );
  });

  it('faz PUT mesclando o AcsCfg completo quando o toggle está desligado', async () => {
    jest
      .mocked(hikvisionIsapiRequest)
      .mockResolvedValueOnce({
        status: 200,
        data: { AcsCfg: { blockListAuth: { '@opt': 'true,false' } } },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        data: { AcsCfg: { blockListAuth: false, other: 1 } },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        data: { statusCode: 1, subStatusCode: 'ok' },
      } as never);

    await hikvisionEnsureBlockListAuth(connection);

    expect(hikvisionIsapiRequest).toHaveBeenCalledTimes(3);
    const putCall = jest.mocked(hikvisionIsapiRequest).mock.calls[2]?.[1];
    expect(putCall).toMatchObject({ method: 'PUT' });
    expect(putCall?.data).toEqual({
      AcsCfg: { blockListAuth: true, other: 1 },
    });
  });

  it('não relança erro de ISAPI — sync de face deve seguir', async () => {
    jest.mocked(hikvisionIsapiRequest).mockRejectedValue(new Error('timeout'));

    await expect(
      hikvisionEnsureBlockListAuth(connection),
    ).resolves.toBeUndefined();
  });

  it('usa cache por baseUrl e não consulta o leitor de novo', async () => {
    jest
      .mocked(hikvisionIsapiRequest)
      .mockResolvedValueOnce({
        status: 200,
        data: {},
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        data: { AcsCfg: { blackListAuth: true } },
      } as never);

    await hikvisionEnsureBlockListAuth(connection);
    await hikvisionEnsureBlockListAuth(connection);

    expect(hikvisionIsapiRequest).toHaveBeenCalledTimes(2);
  });

  it('não faz PUT quando o firmware não expõe o campo', async () => {
    jest
      .mocked(hikvisionIsapiRequest)
      .mockResolvedValueOnce({
        status: 200,
        data: { statusCode: 1 },
      } as never)
      .mockResolvedValueOnce({
        status: 200,
        data: { statusCode: 1, statusString: 'OK' },
      } as never);

    await hikvisionEnsureBlockListAuth(connection);

    expect(hikvisionIsapiRequest).toHaveBeenCalledTimes(2);
    expect(
      jest
        .mocked(hikvisionIsapiRequest)
        .mock.calls.some((call) => call[1]?.method === 'PUT'),
    ).toBe(false);
  });
});
