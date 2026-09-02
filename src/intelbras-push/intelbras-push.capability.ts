import type { PlainReaderCredential } from '../integrations/intelbras/intelbras-device.client';
import {
  intelbrasGetConfig,
  intelbrasGetDeviceType,
  intelbrasGetSoftwareVersion,
} from './intelbras-push.config.client';

export const INTELBRAS_V2_MIN_BUILD = 20250625;

const V2_MODELS = [
  'SS3531MFLITE',
  'SS3542MFLITE',
  'SS3532MF',
  'SS3532MFW',
  'SS3542MFW',
  'SS5531MFW',
  'SS5531MFEX',
  'SS5541MFW',
  'SS5532MFW',
  'SS5542MFW',
];

export type IntelbrasPushCapability = {
  pushMode: '1.0' | '2.0' | 'off' | 'online' | null;
  pushEligible: boolean;
  pushNeedsFirmware: boolean;
  pushModel: string | null;
  pushFirmwareDate: number | null;
};

function normalizeModel(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isIntelbrasV2Model(model: string | null): boolean {
  if (!model) return false;
  const n = normalizeModel(model);
  return V2_MODELS.some((listed) => n.includes(listed) || listed.includes(n));
}

export function deviceModeToPushMode(
  deviceMode: string | null,
): IntelbrasPushCapability['pushMode'] {
  if (deviceMode === '3') return '2.0';
  if (deviceMode === '1') return '1.0';
  if (deviceMode === '2') return 'online';
  if (deviceMode === '0') return 'off';
  return null;
}

export async function probeIntelbrasPushCapability(
  reader: PlainReaderCredential,
): Promise<IntelbrasPushCapability> {
  const [version, model, modeCfg] = await Promise.all([
    intelbrasGetSoftwareVersion(reader),
    intelbrasGetDeviceType(reader).catch(() => ''),
    intelbrasGetConfig(reader, 'Intelbras_ModeCfg').catch(
      (): Record<string, string> => ({}),
    ),
  ]);
  const firmware = version.buildDate;
  const listed = isIntelbrasV2Model(model);
  const firmwareOk = firmware != null && firmware >= INTELBRAS_V2_MIN_BUILD;
  const deviceModeRaw = modeCfg['Intelbras_ModeCfg.DeviceMode'];
  const deviceMode = typeof deviceModeRaw === 'string' ? deviceModeRaw : null;
  return {
    pushMode: deviceModeToPushMode(deviceMode),
    pushEligible: listed && firmwareOk,
    pushNeedsFirmware: listed && !firmwareOk,
    pushModel: model || null,
    pushFirmwareDate: firmware,
  };
}
