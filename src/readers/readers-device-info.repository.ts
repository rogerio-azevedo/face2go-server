import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import { clients, facialReaders } from '../database/schema';

export type ReaderDeviceInfoPatch = {
  model?: string;
  serialNumber?: string;
  firmwareVersion?: string;
};

export type PersistedReaderDeviceInfo = {
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  deviceInfoSyncedAt: Date | null;
  deviceInfoLastError: string | null;
};

@Injectable()
export class ReadersDeviceInfoRepository {
  constructor(private readonly database: DatabaseService) {}

  private companyReaderWhere(companyId: string, readerId: string) {
    const clientIds = this.database.db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(clients.companyId, companyId));
    return and(
      eq(facialReaders.id, readerId),
      inArray(facialReaders.clientId, clientIds),
    );
  }

  async saveSuccess(
    companyId: string,
    readerId: string,
    patch: ReaderDeviceInfoPatch,
    syncedAt: Date,
  ): Promise<PersistedReaderDeviceInfo | undefined> {
    const [row] = await this.database.db
      .update(facialReaders)
      .set({
        ...(patch.model ? { model: patch.model } : {}),
        ...(patch.serialNumber ? { serialNumber: patch.serialNumber } : {}),
        ...(patch.firmwareVersion
          ? { firmwareVersion: patch.firmwareVersion }
          : {}),
        deviceInfoSyncedAt: syncedAt,
        deviceInfoLastError: null,
      })
      .where(this.companyReaderWhere(companyId, readerId))
      .returning({
        model: facialReaders.model,
        serialNumber: facialReaders.serialNumber,
        firmwareVersion: facialReaders.firmwareVersion,
        deviceInfoSyncedAt: facialReaders.deviceInfoSyncedAt,
        deviceInfoLastError: facialReaders.deviceInfoLastError,
      });
    return row;
  }

  async saveError(
    companyId: string,
    readerId: string,
    error: string,
  ): Promise<void> {
    await this.database.db
      .update(facialReaders)
      .set({ deviceInfoLastError: error })
      .where(this.companyReaderWhere(companyId, readerId));
  }
}
