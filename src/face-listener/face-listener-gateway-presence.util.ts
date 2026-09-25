import type { ReaderBrand } from '../database/queries/readers.queries';

export const AUTO_REGISTER_OFFLINE_ERROR =
  'Sem sessão no gateway de registro automático';

export const AUTO_REGISTER_MISSING_ID_ERROR =
  'Leitor em registro automático sem ID de dispositivo';

export type GatewayDevicePresence = {
  deviceId: string;
  online: boolean;
  lastSeenAt: Date | null;
};

export type GatewayPresenceSnapshot =
  | { ok: true; devices: GatewayDevicePresence[] }
  | { ok: false; error: string };

export type AutoRegisterPresence = {
  connected: boolean;
  lastConnectionError: string | null;
  lastSeenAt: Date | null;
};

function parseSeenAt(value: string | null): Date | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

export function hikvisionSessionsToPresence(
  devices: { ehomeId: string; online: boolean; lastSeenAt: string | null }[],
): GatewayDevicePresence[] {
  return devices.map((device) => ({
    deviceId: device.ehomeId,
    online: device.online,
    lastSeenAt: parseSeenAt(device.lastSeenAt),
  }));
}

export function intelbrasSessionsToPresence(
  devices: { deviceId: string; lastRxAt: string | null }[],
): GatewayDevicePresence[] {
  return devices.map((device) => ({
    deviceId: device.deviceId,
    online: true,
    lastSeenAt: parseSeenAt(device.lastRxAt),
  }));
}

/**
 * Online no registro automático = sessão do gateway com o mesmo ID.
 * Falha ao consultar o gateway preserva o último `connected`.
 */
export function resolveAutoRegisterPresence(input: {
  brand: ReaderBrand;
  autoRegisterDeviceId: string | null;
  previousConnected: boolean;
  hikvision: GatewayPresenceSnapshot;
  intelbras: GatewayPresenceSnapshot;
}): AutoRegisterPresence {
  const deviceId = input.autoRegisterDeviceId?.trim() ?? '';
  if (!deviceId) {
    return {
      connected: false,
      lastConnectionError: AUTO_REGISTER_MISSING_ID_ERROR,
      lastSeenAt: null,
    };
  }

  const snapshot = input.brand === 'hikvision' ? input.hikvision : input.intelbras;
  if (!snapshot.ok) {
    return {
      connected: input.previousConnected,
      lastConnectionError: snapshot.error,
      lastSeenAt: null,
    };
  }

  const match = snapshot.devices.find(
    (device) => device.deviceId.toLowerCase() === deviceId.toLowerCase(),
  );
  if (!match?.online) {
    return {
      connected: false,
      lastConnectionError: AUTO_REGISTER_OFFLINE_ERROR,
      lastSeenAt: match?.lastSeenAt ?? null,
    };
  }

  return {
    connected: true,
    lastConnectionError: null,
    lastSeenAt: match.lastSeenAt,
  };
}
