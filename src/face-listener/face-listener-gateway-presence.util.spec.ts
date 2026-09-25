import {
  AUTO_REGISTER_MISSING_ID_ERROR,
  AUTO_REGISTER_OFFLINE_ERROR,
  hikvisionSessionsToPresence,
  intelbrasSessionsToPresence,
  resolveAutoRegisterPresence,
  type GatewayPresenceSnapshot,
} from './face-listener-gateway-presence.util';

const empty: GatewayPresenceSnapshot = { ok: true, devices: [] };

const hikvisionOnline: GatewayPresenceSnapshot = {
  ok: true,
  devices: hikvisionSessionsToPresence([
    {
      ehomeId: 'loja-01',
      online: true,
      lastSeenAt: '2026-09-25T12:00:00.000Z',
    },
    {
      ehomeId: 'loja-02',
      online: false,
      lastSeenAt: '2026-09-25T11:00:00.000Z',
    },
  ]),
};

describe('resolveAutoRegisterPresence', () => {
  it('marca online quando a sessão ISUP do mesmo ID está ativa', () => {
    const presence = resolveAutoRegisterPresence({
      brand: 'hikvision',
      autoRegisterDeviceId: 'loja-01',
      previousConnected: false,
      hikvision: hikvisionOnline,
      intelbras: empty,
    });
    expect(presence.connected).toBe(true);
    expect(presence.lastConnectionError).toBeNull();
    expect(presence.lastSeenAt?.toISOString()).toBe('2026-09-25T12:00:00.000Z');
  });

  it('marca offline quando o ISUP registrou a queda', () => {
    const presence = resolveAutoRegisterPresence({
      brand: 'hikvision',
      autoRegisterDeviceId: 'loja-02',
      previousConnected: true,
      hikvision: hikvisionOnline,
      intelbras: empty,
    });
    expect(presence.connected).toBe(false);
    expect(presence.lastConnectionError).toBe(AUTO_REGISTER_OFFLINE_ERROR);
  });

  it('marca offline quando o ID não está na lista', () => {
    const presence = resolveAutoRegisterPresence({
      brand: 'hikvision',
      autoRegisterDeviceId: 'outro',
      previousConnected: true,
      hikvision: hikvisionOnline,
      intelbras: empty,
    });
    expect(presence.connected).toBe(false);
    expect(presence.lastConnectionError).toBe(AUTO_REGISTER_OFFLINE_ERROR);
  });

  it('mantém o último estado se o gateway não responde', () => {
    const presence = resolveAutoRegisterPresence({
      brand: 'hikvision',
      autoRegisterDeviceId: 'loja-01',
      previousConnected: true,
      hikvision: { ok: false, error: 'Gateway Hikvision indisponível: HTTP 502' },
      intelbras: empty,
    });
    expect(presence.connected).toBe(true);
    expect(presence.lastConnectionError).toBe(
      'Gateway Hikvision indisponível: HTTP 502',
    );
  });

  it('exige o ID de registro automático', () => {
    const presence = resolveAutoRegisterPresence({
      brand: 'intelbras',
      autoRegisterDeviceId: '  ',
      previousConnected: true,
      hikvision: empty,
      intelbras: empty,
    });
    expect(presence.connected).toBe(false);
    expect(presence.lastConnectionError).toBe(AUTO_REGISTER_MISSING_ID_ERROR);
  });

  it('trata a sessão TCP Intelbras presente na lista como online', () => {
    const presence = resolveAutoRegisterPresence({
      brand: 'intelbras',
      autoRegisterDeviceId: 'f2g-salao-01',
      previousConnected: false,
      hikvision: empty,
      intelbras: {
        ok: true,
        devices: intelbrasSessionsToPresence([
          { deviceId: 'f2g-salao-01', lastRxAt: '2026-09-25T12:05:00.000Z' },
        ]),
      },
    });
    expect(presence.connected).toBe(true);
    expect(presence.lastSeenAt?.toISOString()).toBe('2026-09-25T12:05:00.000Z');
  });
});
