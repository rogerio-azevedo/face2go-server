import { normalizeNameForFacialReader } from '../face-sync/normalize-name-for-reader';
import type { AccessPersonType } from '../common/access-person.types';
import type { DeviceUserSystemPerson } from '../database/queries/device-user-reconcile.queries';

export type DeviceUserRecord = {
  UserID: string;
  CardName: string;
  CardNo: string;
  ValidDateStart?: string;
  ValidDateEnd?: string;
  HasFace?: boolean | null;
  inSystem: boolean;
  systemName: string | null;
  personType: AccessPersonType | null;
  nameMismatch: boolean;
};

export function parseDeviceUserFaceId(userId: string): number | null {
  const n = Number(String(userId).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function normalizeCompareName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ç/gi, 'c')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function namesMismatch(deviceName: string, systemName: string): boolean {
  const device = normalizeCompareName(deviceName);
  const system = normalizeCompareName(systemName);
  if (!device || !system) return false;
  if (device === system) return false;

  const readerForm = normalizeNameForFacialReader(systemName);
  if (readerForm && device === readerForm) return false;
  if (device.includes(system) || system.includes(device)) return false;
  if (
    readerForm &&
    (device.includes(readerForm) || readerForm.includes(device))
  ) {
    return false;
  }
  return true;
}

export function enrichDeviceUserRecords<
  T extends {
    UserID: string;
    CardName: string;
    CardNo?: string;
    ValidDateStart?: string;
    ValidDateEnd?: string;
    HasFace?: boolean | null;
  },
>(
  records: T[],
  persons: Map<number, DeviceUserSystemPerson>,
): DeviceUserRecord[] {
  return records.map((row) => {
    const faceId = parseDeviceUserFaceId(row.UserID);
    const person = faceId != null ? (persons.get(faceId) ?? null) : null;
    return {
      UserID: row.UserID,
      CardName: row.CardName,
      CardNo: row.CardNo || row.UserID,
      ValidDateStart: row.ValidDateStart,
      ValidDateEnd: row.ValidDateEnd,
      HasFace: row.HasFace ?? null,
      inSystem: person != null,
      systemName: person?.name || null,
      personType: person?.personType ?? null,
      nameMismatch:
        person != null ? namesMismatch(row.CardName, person.name) : false,
    };
  });
}
