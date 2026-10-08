import { parseHikvisionDeviceInfo } from './hikvision-device-info.client';

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
