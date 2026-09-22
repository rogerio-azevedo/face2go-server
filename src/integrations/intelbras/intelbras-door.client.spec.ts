import {
  intelbrasOpenDoor,
  intelbrasOpenDoorUrl,
} from './intelbras-door.client';

jest.mock('./intelbras-digest-auth', () => ({
  digestAuthForReader: jest.fn(),
}));

import { digestAuthForReader } from './intelbras-digest-auth';

const reader = {
  id: 'reader-1',
  name: 'Porta Principal',
  ip: '10.0.0.10',
  port: 80,
  username: 'admin',
  plainPassword: 'secret',
};

describe('intelbrasOpenDoorUrl', () => {
  it('omite a porta 80 e usa channel 1 por padrão', () => {
    expect(intelbrasOpenDoorUrl(reader)).toBe(
      'http://10.0.0.10/cgi-bin/accessControl.cgi?action=openDoor&channel=1&UserID=999999&Type=Remote',
    );
  });

  it('inclui porta não-padrão', () => {
    expect(intelbrasOpenDoorUrl({ ip: 'host.local', port: 37777 }, 1)).toBe(
      'http://host.local:37777/cgi-bin/accessControl.cgi?action=openDoor&channel=1&UserID=999999&Type=Remote',
    );
  });
});

describe('intelbrasOpenDoor', () => {
  const request = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(digestAuthForReader).mockReturnValue({ request });
  });

  it('aciona a porta com Digest GET', async () => {
    request.mockResolvedValue({ status: 200, data: 'OK\r\n' });

    await expect(intelbrasOpenDoor(reader)).resolves.toBeUndefined();

    expect(digestAuthForReader).toHaveBeenCalledWith({
      ip: reader.ip,
      port: reader.port,
      username: reader.username,
      plainPassword: reader.plainPassword,
    });
    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      url: intelbrasOpenDoorUrl(reader),
    });
  });

  it('falha quando o corpo CGI contém error', async () => {
    request.mockResolvedValue({
      status: 200,
      data: 'Error\r\nErrorID=1',
    });

    await expect(intelbrasOpenDoor(reader)).rejects.toThrow(/error/i);
  });

  it('mapeia 401 para credenciais inválidas', async () => {
    request.mockRejectedValue({
      response: { status: 401 },
      message: 'Request failed with status code 401',
    });

    await expect(intelbrasOpenDoor(reader)).rejects.toThrow(
      'Credenciais inválidas para o leitor.',
    );
  });

  it('mapeia dispositivo offline', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    request.mockRejectedValue(err);

    await expect(intelbrasOpenDoor(reader)).rejects.toThrow(
      'Leitor offline ou inacessível',
    );
  });
});
