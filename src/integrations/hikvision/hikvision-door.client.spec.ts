import {
  HIKVISION_REMOTE_OPEN_XML,
  hikvisionOpenDoor,
  hikvisionOpenDoorUrl,
} from './hikvision-door.client';

jest.mock('./hikvision-isapi-request', () => ({
  hikvisionIsapiRequest: jest.fn(),
}));

import { hikvisionIsapiRequest } from './hikvision-isapi-request';

const connection = {
  baseUrl: 'http://192.168.1.50:80',
  username: 'admin',
  password: 'secret',
};

describe('hikvisionOpenDoorUrl', () => {
  it('aponta para RemoteControl door/1', () => {
    expect(hikvisionOpenDoorUrl(connection)).toBe(
      'http://192.168.1.50:80/ISAPI/AccessControl/RemoteControl/door/1',
    );
  });
});

describe('hikvisionOpenDoor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('envia PUT XML com cmd open', async () => {
    jest.mocked(hikvisionIsapiRequest).mockResolvedValue({
      status: 200,
      data: '<ResponseStatus><statusCode>1</statusCode></ResponseStatus>',
    } as never);

    await expect(hikvisionOpenDoor(connection)).resolves.toBeUndefined();

    expect(hikvisionIsapiRequest).toHaveBeenCalledWith(connection, {
      method: 'PUT',
      url: hikvisionOpenDoorUrl(connection),
      headers: { 'Content-Type': 'application/xml' },
      data: HIKVISION_REMOTE_OPEN_XML,
    });
  });

  it('falha quando o ISAPI devolve statusCode diferente de 1', async () => {
    jest.mocked(hikvisionIsapiRequest).mockResolvedValue({
      status: 200,
      data: '<ResponseStatus><statusCode>4</statusCode><statusString>Invalid Operation</statusString></ResponseStatus>',
    } as never);

    await expect(hikvisionOpenDoor(connection)).rejects.toThrow(
      /Invalid Operation/,
    );
  });

  it('mapeia 401 para credenciais inválidas', async () => {
    jest.mocked(hikvisionIsapiRequest).mockRejectedValue({
      response: { status: 401 },
      message: 'Request failed with status code 401',
    });

    await expect(hikvisionOpenDoor(connection)).rejects.toThrow(
      'Credenciais inválidas para o leitor.',
    );
  });

  it('mapeia dispositivo offline', async () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), {
      code: 'ETIMEDOUT',
    });
    jest.mocked(hikvisionIsapiRequest).mockRejectedValue(err);

    await expect(hikvisionOpenDoor(connection)).rejects.toThrow(
      'Leitor offline ou inacessível',
    );
  });
});
