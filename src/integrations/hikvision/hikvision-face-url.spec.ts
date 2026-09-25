import type { AxiosRequestConfig } from 'axios';

import type { HikvisionReaderConnection } from './hikvision-connection.types';
import {
  buildHikvisionFaceUrlBody,
  hikvisionUpsertFace,
} from './hikvision-device.client';
import { hikvisionGatewayPublishMedia } from './hikvision-gateway-auth';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';

jest.mock('./hikvision-isapi-request', () => ({
  hikvisionIsapiRequest: jest.fn(),
  invalidateHikvisionClientCache: jest.fn(),
}));

jest.mock('./hikvision-gateway-auth', () => ({
  hikvisionGatewayPublishMedia: jest.fn(),
}));

const isapi = jest.mocked(hikvisionIsapiRequest);
const publishMedia = jest.mocked(hikvisionGatewayPublishMedia);

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);
const faceUrl = 'http://184.194.233.81:8092/f/abc.jpg';

let readerSeq = 0;

/** baseUrl distinta por teste: o client guarda a biblioteca de faces em cache por leitor. */
function connection(
  overrides: Partial<HikvisionReaderConnection>,
): HikvisionReaderConnection {
  readerSeq += 1;
  return {
    id: 'uuid',
    baseUrl: `http://10.0.0.${readerSeq}`,
    username: 'admin',
    password: 'segredo',
    ...overrides,
  };
}

function faceWrites(): AxiosRequestConfig[] {
  return isapi.mock.calls
    .map(([, opts]) => opts)
    .filter((opts) => String(opts.url).includes('FaceDataRecord'));
}

beforeEach(() => {
  isapi.mockReset();
  publishMedia.mockReset();
  publishMedia.mockResolvedValue(faceUrl);
  isapi.mockImplementation((_conn, opts) => {
    const url = String(opts.url);
    if (url.includes('/FDLib?format=json')) {
      return Promise.resolve({
        status: 200,
        data: { FDLib: [{ FDID: '1', faceLibType: 'blackFD' }] },
      } as never);
    }
    if (url.includes('FaceDataRecord')) {
      return Promise.resolve({ status: 200, data: { statusCode: 1 } } as never);
    }
    return Promise.reject(new Error('fora do teste'));
  });
});

describe('buildHikvisionFaceUrlBody', () => {
  it('monta o JSON do FaceDataRecord com faceURL', () => {
    expect(
      buildHikvisionFaceUrlBody('3', faceUrl, {
        fdid: '1',
        faceLibType: 'blackFD',
      }),
    ).toEqual({
      faceLibType: 'blackFD',
      FDID: '1',
      FPID: '3',
      faceURL: faceUrl,
    });
  });
});

describe('hikvisionUpsertFace', () => {
  it('no auto_register publica a foto no gateway e envia JSON com faceURL', async () => {
    await hikvisionUpsertFace(
      connection({
        connectionMode: 'auto_register',
        autoRegisterDeviceId: 'e5d9',
      }),
      '3',
      jpeg,
      { alreadyNormalized: true },
    );

    expect(publishMedia).toHaveBeenCalledWith(jpeg);
    const writes = faceWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(writes[0]?.data).toEqual({
      faceLibType: 'blackFD',
      FDID: '1',
      FPID: '3',
      faceURL: faceUrl,
    });
  });

  it('no auto_register não repete com o campo img quando o leitor recusa', async () => {
    isapi.mockImplementation((_conn, opts) => {
      if (String(opts.url).includes('/FDLib?format=json')) {
        return Promise.resolve({ status: 200, data: {} } as never);
      }
      return Promise.reject(new Error('Hikvision ISAPI 502'));
    });

    await expect(
      hikvisionUpsertFace(
        connection({
          connectionMode: 'auto_register',
          autoRegisterDeviceId: 'e5d9',
        }),
        '3',
        jpeg,
        { alreadyNormalized: true },
      ),
    ).rejects.toThrow('Hikvision ISAPI 502');
    expect(faceWrites()).toHaveLength(1);
  });

  it('no modo direto continua mandando multipart sem passar pelo gateway', async () => {
    await hikvisionUpsertFace(
      connection({ connectionMode: 'direct' }),
      '3',
      jpeg,
      { alreadyNormalized: true },
    );

    expect(publishMedia).not.toHaveBeenCalled();
    const writes = faceWrites();
    expect(writes).toHaveLength(1);
    expect(Buffer.isBuffer(writes[0]?.data)).toBe(true);
    expect(
      String((writes[0]?.headers as Record<string, string>)['Content-Type']),
    ).toMatch(/^multipart\/form-data/);
  });
});
