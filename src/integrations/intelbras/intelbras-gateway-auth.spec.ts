import axios from 'axios';

import { digestAuthForReader } from './intelbras-digest-auth';
import {
  cgiPathFromUrl,
  createGatewayDigestAuth,
  gatewayDeviceId,
} from './intelbras-gateway-auth';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({})),
    post: jest.fn(),
  },
}));

describe('cgiPathFromUrl', () => {
  it('descarta o host e preserva a query', () => {
    expect(
      cgiPathFromUrl(
        'http://10.0.0.8:8089/cgi-bin/magicBox.cgi?action=getSoftwareVersion',
      ),
    ).toBe('/cgi-bin/magicBox.cgi?action=getSoftwareVersion');
  });
});

describe('gatewayDeviceId', () => {
  it('usa o ID gravado', () => {
    expect(
      gatewayDeviceId({
        id: 'uuid',
        username: 'admin',
        plainPassword: 'x',
        autoRegisterDeviceId: 'f2g-salao-01',
      }),
    ).toBe('f2g-salao-01');
  });

  it('não cai no UUID com hífen', () => {
    expect(() =>
      gatewayDeviceId({
        id: '732d7413-1f50-486c-9ca4-888ae4bd44d7',
        username: 'admin',
        plainPassword: 'x',
        autoRegisterDeviceId: null,
      }),
    ).toThrow(/ID de dispositivo/);
  });
});

describe('createGatewayDigestAuth', () => {
  const post = jest.mocked(axios.post);

  beforeEach(() => {
    post.mockReset();
    process.env.READER_GATEWAY_URL = 'https://172.31.4.98:8090';
    process.env.READER_GATEWAY_TOKEN = 'token-de-teste-123456';
    process.env.READER_GATEWAY_TLS_INSECURE = '1';
  });

  it('envia o CGI pelo gateway e devolve o corpo como texto', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { status: 200, body: 'OK\r\n' },
    });
    const auth = createGatewayDigestAuth({
      id: 'uuid',
      username: 'admin',
      plainPassword: 'segredo',
      autoRegisterDeviceId: 'f2g-salao-01',
    });
    const res = await auth.request({
      method: 'GET',
      url: 'http://leitor.local/cgi-bin/magicBox.cgi?action=getDeviceType',
    });
    expect(res).toEqual({ status: 200, data: 'OK\r\n' });
    expect(post).toHaveBeenCalledWith(
      'https://172.31.4.98:8090/devices/f2g-salao-01/cgi',
      expect.objectContaining({
        method: 'GET',
        path: '/cgi-bin/magicBox.cgi?action=getDeviceType',
        credentials: { username: 'admin', password: 'segredo' },
      }),
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-de-teste-123456' },
      }),
    );
  });

  it('digestAuthForReader no modo auto_register não abre HTTP direto', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { status: 200, body: 'type=SS\r\n' },
    });
    const auth = digestAuthForReader({
      id: 'uuid',
      ip: '10.0.0.8',
      port: 80,
      username: 'admin',
      plainPassword: 'segredo',
      connectionMode: 'auto_register',
      autoRegisterDeviceId: 'f2g-salao-01',
    });
    const res = await auth.request({
      method: 'GET',
      url: 'http://10.0.0.8/cgi-bin/magicBox.cgi?action=getDeviceType',
    });
    expect(res.data).toBe('type=SS\r\n');
    expect(axios.create).not.toHaveBeenCalled();
  });
});
