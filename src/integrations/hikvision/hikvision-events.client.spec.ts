import {
  HIKVISION_MINOR_FACE_AUTH_SUCCESS,
  hikvisionProbeAlertStreamSupported,
  normalizeHikvisionAccessEvent,
  parseHikvisionAlertStreamPart,
} from './hikvision-events.client';

jest.mock('./hikvision-isapi-request', () => ({
  hikvisionOpenStreamRequest: jest.fn(),
}));

import { hikvisionOpenStreamRequest } from './hikvision-isapi-request';

const connection = {
  baseUrl: 'http://192.168.1.10:80',
  username: 'admin',
  password: 'secret',
};

describe('hikvisionProbeAlertStreamSupported', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retorna false em timeout (abort) — preferir poll', async () => {
    jest.useFakeTimers();
    jest.mocked(hikvisionOpenStreamRequest).mockImplementation(
      (_conn, _url, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new Error('Aborted'));
          });
        }),
    );

    const probePromise = hikvisionProbeAlertStreamSupported(connection);
    await jest.advanceTimersByTimeAsync(5000);
    const supported = await probePromise;
    expect(supported).toBe(false);
    jest.useRealTimers();
  });

  it('retorna false quando alertStream responde 404', async () => {
    jest.mocked(hikvisionOpenStreamRequest).mockRejectedValue({
      response: { status: 404 },
    });

    const supported = await hikvisionProbeAlertStreamSupported(connection);
    expect(supported).toBe(false);
  });

  it('retorna true quando alertStream conecta', async () => {
    jest.mocked(hikvisionOpenStreamRequest).mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'multipart/mixed; boundary=xyz' },
      data: {},
      config: {} as never,
    });

    const supported = await hikvisionProbeAlertStreamSupported(connection);
    expect(supported).toBe(true);
  });
});

describe('normalizeHikvisionAccessEvent', () => {
  it('extrai employeeNo de AccessControllerEvent aninhado', () => {
    const event = normalizeHikvisionAccessEvent({
      AccessControllerEvent: {
        employeeNoString: '42',
        name: 'JOAO',
        similarity: 95,
        status: 1,
        major: 5,
        minor: HIKVISION_MINOR_FACE_AUTH_SUCCESS,
        serialNo: 100,
      },
      eventType: 'AccessControllerEvent',
    });

    expect(event).not.toBeNull();
    expect(event?.employeeNoString).toBe('42');
    expect(event?.name).toBe('JOAO');
    expect(event?.similarity).toBe(95);
  });

  it('filtra acsEvent sem minor 75 nem verifyMode face', () => {
    const event = normalizeHikvisionAccessEvent(
      {
        AccessControllerEvent: {
          employeeNoString: '10',
          major: 5,
          minor: 1,
          currentVerifyMode: 'card',
        },
        eventType: 'AccessControllerEvent',
      },
      { source: 'acsEvent' },
    );

    expect(event).toBeNull();
  });

  it('aceita acsEvent com currentVerifyMode face', () => {
    const event = normalizeHikvisionAccessEvent(
      {
        AccessControllerEvent: {
          employeeNoString: '10',
          major: 5,
          minor: 1,
          currentVerifyMode: 'face',
          similarity: 88,
        },
        eventType: 'AccessControllerEvent',
      },
      { source: 'acsEvent' },
    );

    expect(event).not.toBeNull();
    expect(event?.employeeNoString).toBe('10');
  });

  it('retorna null sem employeeNo', () => {
    const event = normalizeHikvisionAccessEvent({
      AccessControllerEvent: { major: 5, minor: 75 },
    });
    expect(event).toBeNull();
  });
});

describe('parseHikvisionAlertStreamPart', () => {
  it('parseia part JSON do alertStream', () => {
    const body = Buffer.from(
      JSON.stringify({
        EventNotificationAlert: {
          AccessControllerEvent: {
            employeeNoString: '7',
            similarity: 90,
            status: 1,
          },
        },
      }),
    );

    const event = parseHikvisionAlertStreamPart(body);
    expect(event?.employeeNoString).toBe('7');
    expect(event?.similarity).toBe(90);
  });

  it('retorna null para JSON inválido', () => {
    expect(parseHikvisionAlertStreamPart(Buffer.from('not json'))).toBeNull();
  });
});
