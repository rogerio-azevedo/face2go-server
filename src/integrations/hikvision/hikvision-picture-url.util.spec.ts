import { resolveHikvisionDevicePictureUrl } from './hikvision-picture-url.util';

const baseUrl = 'http://condroyal2026.ddns-intelbras.com.br:1530';

describe('resolveHikvisionDevicePictureUrl', () => {
  it('reescreve hostname truncado pelo firmware', () => {
    expect(
      resolveHikvisionDevicePictureUrl(
        'http://condroyal2026.ddns-inte/LOCALS/pic/enrlFace/0/0000000383.jpg@WEB000000002251',
        baseUrl,
      ),
    ).toBe(`${baseUrl}/LOCALS/pic/enrlFace/0/0000000383.jpg@WEB000000002251`);
  });

  it('troca IP LAN pelo origin cadastrado', () => {
    expect(
      resolveHikvisionDevicePictureUrl(
        'http://192.168.1.10/ISAPI/Streaming/channels/1/picture',
        baseUrl,
      ),
    ).toBe(`${baseUrl}/ISAPI/Streaming/channels/1/picture`);
  });

  it('prefixa caminho relativo', () => {
    expect(
      resolveHikvisionDevicePictureUrl(
        '/ISAPI/AccessControl/CaptureFaceData',
        baseUrl,
      ),
    ).toBe(`${baseUrl}/ISAPI/AccessControl/CaptureFaceData`);
  });

  it('prefixa caminho sem barra inicial', () => {
    expect(
      resolveHikvisionDevicePictureUrl('LOCALS/pic/snap.jpg', baseUrl),
    ).toBe(`${baseUrl}/LOCALS/pic/snap.jpg`);
  });

  it('preserva query string', () => {
    expect(
      resolveHikvisionDevicePictureUrl(
        'http://host-cortado/ISAPI/pic?type=snap',
        baseUrl,
      ),
    ).toBe(`${baseUrl}/ISAPI/pic?type=snap`);
  });
});
