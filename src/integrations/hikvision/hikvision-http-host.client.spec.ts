import {
  buildHikvisionHttpHostBody,
  resolveHikvisionPushTarget,
} from './hikvision-http-host.client';

describe('hikvision http host', () => {
  const readerId = '87d1973f-2231-4b82-aa81-4758c1a8ebda';

  it('aponta o leitor para a URL pública do evento', () => {
    const target = resolveHikvisionPushTarget(
      readerId,
      'https://api.face2go.com.br',
    );
    expect(target).toEqual({
      hostName: 'api.face2go.com.br',
      port: 443,
      https: true,
      path: `/device-events/hikvision/${readerId}`,
    });
    expect(buildHikvisionHttpHostBody(target)).toEqual({
      HttpHostNotification: {
        id: 1,
        url: `/device-events/hikvision/${readerId}`,
        protocolType: 'HTTPS',
        parameterFormatType: 'JSON',
        addressingFormatType: 'hostname',
        hostName: 'api.face2go.com.br',
        portNo: 443,
        httpAuthenticationMethod: 'none',
      },
    });
  });

  it('recusa localhost', () => {
    expect(() =>
      resolveHikvisionPushTarget(readerId, 'http://localhost:6200'),
    ).toThrow(/localhost/);
  });
});
