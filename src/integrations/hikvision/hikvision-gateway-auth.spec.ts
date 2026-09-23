import axios from 'axios';

import type { HikvisionReaderConnection } from './hikvision-connection.types';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';
import {
  hikvisionGatewayDeviceId,
  hikvisionGatewayIsapiRequest,
  isapiPathFromUrl,
} from './hikvision-gateway-auth';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({})),
    post: jest.fn(),
  },
}));

const connection: HikvisionReaderConnection = {
  id: 'uuid',
  baseUrl: 'http://10.0.0.9',
  username: 'admin',
  password: 'segredo',
  connectionMode: 'auto_register',
  autoRegisterDeviceId: 'catraca-01',
};

describe('isapiPathFromUrl', () => {
  it('descarta o host e preserva a query', () => {
    expect(
      isapiPathFromUrl(
        'http://10.0.0.9/ISAPI/System/deviceInfo?format=json',
      ),
    ).toBe('/ISAPI/System/deviceInfo?format=json');
  });
});

describe('hikvisionGatewayDeviceId', () => {
  it('prefere o ID EHome', () => {
    expect(hikvisionGatewayDeviceId(connection)).toBe('catraca-01');
  });
});

describe('hikvisionGatewayIsapiRequest', () => {
  const post = jest.mocked(axios.post);

  beforeEach(() => {
    post.mockReset();
    process.env.HIK_GATEWAY_URL = 'https://172.31.4.98:8091';
    process.env.HIK_GATEWAY_TOKEN = 'token-de-teste-123456';
    process.env.READER_GATEWAY_TLS_INSECURE = '1';
  });

  it('envia o ISAPI pelo gateway e devolve o JSON parseado', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { status: 200, body: '{"DeviceInfo":{"model":"DS"}}' },
    });
    const res = await hikvisionGatewayIsapiRequest(connection, {
      method: 'GET',
      url: 'http://10.0.0.9/ISAPI/System/deviceInfo?format=json',
    });
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ DeviceInfo: { model: 'DS' } });
    expect(post).toHaveBeenCalledWith(
      'https://172.31.4.98:8091/devices/catraca-01/isapi',
      expect.objectContaining({
        method: 'GET',
        path: '/ISAPI/System/deviceInfo?format=json',
        credentials: { username: 'admin', password: 'segredo' },
      }),
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-de-teste-123456' },
      }),
    );
  });

  it('manda JPEG como bodyBase64', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { status: 200, body: '{"statusCode":1}' },
    });
    await hikvisionGatewayIsapiRequest(connection, {
      method: 'POST',
      url: 'http://10.0.0.9/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
      data: Buffer.from([0xff, 0xd8, 0xff]),
    });
    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        bodyBase64: Buffer.from([0xff, 0xd8, 0xff]).toString('base64'),
      }),
      expect.any(Object),
    );
  });

  it('falha sem as envs em vez de abrir o IP do leitor', async () => {
    delete process.env.HIK_GATEWAY_URL;
    delete process.env.HIK_GATEWAY_TOKEN;
    await expect(
      hikvisionIsapiRequest(connection, {
        method: 'GET',
        url: 'http://10.0.0.9/ISAPI/System/deviceInfo',
      }),
    ).rejects.toThrow(/HIK_GATEWAY_URL/);
    expect(post).not.toHaveBeenCalled();
  });
});
