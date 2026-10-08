import type { AxiosResponse } from 'axios';

import {
  hikvisionGetDeviceInfo,
  parseHikvisionDeviceInfo,
} from './hikvision-device-info.client';
import { hikvisionIsapiRequest } from './hikvision-isapi-request';

jest.mock('./hikvision-isapi-request', () => ({
  hikvisionIsapiRequest: jest.fn(),
}));

describe('parseHikvisionDeviceInfo', () => {
  it('lê a resposta JSON do deviceInfo', () => {
    expect(
      parseHikvisionDeviceInfo({
        DeviceInfo: {
          model: 'DS-K1T343',
          serialNumber: 'SN-123',
          firmwareVersion: 'V3.17.0',
        },
      }),
    ).toEqual({
      model: 'DS-K1T343',
      serialNumber: 'SN-123',
      firmwareVersion: 'V3.17.0',
    });
  });

  it('aceita XML com namespace como fallback de firmware', () => {
    expect(
      parseHikvisionDeviceInfo(`
        <DeviceInfo xmlns="http://www.isapi.org/ver20/XMLSchema">
          <model> DS-K1T671 </model>
          <serialNumber><![CDATA[ABC987]]></serialNumber>
          <firmwareVersion>V4.2.1 build 260101</firmwareVersion>
        </DeviceInfo>
      `),
    ).toEqual({
      model: 'DS-K1T671',
      serialNumber: 'ABC987',
      firmwareVersion: 'V4.2.1 build 260101',
    });
  });

  it('mantém campos ausentes como nulos', () => {
    expect(
      parseHikvisionDeviceInfo({ DeviceInfo: { model: 'DS-K1T' } }),
    ).toEqual({
      model: 'DS-K1T',
      serialNumber: null,
      firmwareVersion: null,
    });
  });
});

describe('hikvisionGetDeviceInfo', () => {
  const request = jest.mocked(hikvisionIsapiRequest);
  const connection = {
    id: 'reader-1',
    baseUrl: 'http://leitor.local',
    username: 'admin',
    password: 'secret',
    connectionMode: 'auto_register' as const,
    autoRegisterDeviceId: 'reader-1',
  };

  beforeEach(() => request.mockReset());

  it('usa primeiro a rota XML no registro automático', async () => {
    request.mockResolvedValue({
      status: 200,
      data: '<DeviceInfo><model>DS-K1T343</model></DeviceInfo>',
    } as AxiosResponse);

    await expect(hikvisionGetDeviceInfo(connection)).resolves.toEqual({
      model: 'DS-K1T343',
      serialNumber: null,
      firmwareVersion: null,
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].url).toBe(
      'http://leitor.local/ISAPI/System/deviceInfo',
    );
  });

  it('tenta a segunda variante quando a primeira resposta não tem campos', async () => {
    request
      .mockResolvedValueOnce({ status: 200, data: '' } as AxiosResponse)
      .mockResolvedValueOnce({
        status: 200,
        data: { DeviceInfo: { serialNumber: 'SN-123' } },
      } as AxiosResponse);

    await expect(hikvisionGetDeviceInfo(connection)).resolves.toEqual({
      model: null,
      serialNumber: 'SN-123',
      firmwareVersion: null,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].url).toBe(
      'http://leitor.local/ISAPI/System/deviceInfo?format=json',
    );
  });
});
