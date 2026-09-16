import {
  HIKVISION_MINOR_BLOCK_LIST,
  HIKVISION_MINOR_FACE_AUTH_SUCCESS,
  hikvisionEventToVideoEvent,
  hikvisionProbeAlertStreamSupported,
  isHikvisionBlockListEvent,
  normalizeHikvisionAccessEvent,
  parseHikvisionAlertStreamPart,
  resolveHikvisionEventUnixSeconds,
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

  it('retorna false quando alertStream resolve com status 404', async () => {
    jest.mocked(hikvisionOpenStreamRequest).mockResolvedValue({
      status: 404,
      statusText: 'Not Found',
      headers: {},
      data: {},
      config: {} as never,
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

  it('aceita acsEvent de lista de bloqueio (minor 113)', () => {
    const event = normalizeHikvisionAccessEvent(
      {
        AccessControllerEvent: {
          employeeNoString: '1',
          major: 5,
          minor: HIKVISION_MINOR_BLOCK_LIST,
          userType: 'blackList',
          name: 'ROGERIO',
        },
        eventType: 'AccessControllerEvent',
      },
      { source: 'acsEvent' },
    );

    expect(event).not.toBeNull();
    expect(event?.employeeNoString).toBe('1');
    expect(event?.minor).toBe(HIKVISION_MINOR_BLOCK_LIST);
    expect(event?.userType).toBe('blackList');
    expect(isHikvisionBlockListEvent(event!)).toBe(true);
  });

  it('aceita acsEvent com userType blackList mesmo sem minor 75', () => {
    const event = normalizeHikvisionAccessEvent(
      {
        AccessControllerEvent: {
          employeeNoString: '9',
          major: 5,
          minor: 76,
          userType: 'blackList',
          currentVerifyMode: 'card',
        },
        eventType: 'AccessControllerEvent',
      },
      { source: 'acsEvent' },
    );

    expect(event).not.toBeNull();
    expect(event?.userType).toBe('blackList');
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

describe('resolveHikvisionEventUnixSeconds', () => {
  const now = Date.parse('2026-09-16T00:40:00Z');

  it('usa a hora do evento quando é plausível', () => {
    expect(resolveHikvisionEventUnixSeconds('2026-09-16T00:39:10Z', now)).toBe(
      Math.floor(Date.parse('2026-09-16T00:39:10Z') / 1000),
    );
  });

  it('descarta relógio de fábrica 2015', () => {
    expect(
      resolveHikvisionEventUnixSeconds('2015-01-01T00:38:17+08:00', now),
    ).toBe(Math.floor(now / 1000));
  });
});

describe('hikvisionEventToVideoEvent', () => {
  it('não manda RecNo — serial do HIK colide depois de reboot/NTP', () => {
    const video = hikvisionEventToVideoEvent({
      eventType: 'AccessControllerEvent',
      employeeNoString: '1',
      serialNo: 62,
      time: '2026-09-16T00:40:00Z',
      status: 1,
      similarity: 100,
      raw: {},
    });
    expect(video.data.RecNo).toBeUndefined();
    expect(video.data.UserID).toBe('1');
    expect(video.data.CreateTime).toBe(
      Math.floor(Date.parse('2026-09-16T00:40:00Z') / 1000),
    );
  });

  it('mapeia lista de bloqueio para Status de negação e UserType=1', () => {
    const video = hikvisionEventToVideoEvent({
      eventType: 'AccessControllerEvent',
      employeeNoString: '1',
      minor: HIKVISION_MINOR_BLOCK_LIST,
      userType: 'blackList',
      time: '2026-09-16T00:40:00Z',
      similarity: 98,
      raw: {},
    });

    expect(video.data.Status).toBe(0);
    expect(video.data.UserType).toBe(1);
    expect(video.data.UserID).toBe('1');
  });

  it('preserva Status de negação já presente no evento de bloqueio', () => {
    const video = hikvisionEventToVideoEvent({
      eventType: 'AccessControllerEvent',
      employeeNoString: '1',
      userType: 'blackList',
      status: 2,
      raw: {},
    });

    expect(video.data.Status).toBe(2);
    expect(video.data.UserType).toBe(1);
  });
});
