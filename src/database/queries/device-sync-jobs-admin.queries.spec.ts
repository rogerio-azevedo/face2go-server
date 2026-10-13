import { drizzle } from 'drizzle-orm/node-postgres';

import type { AppDb } from '../database.types';
import { clearFailedDeviceSyncJobs } from './device-sync-jobs-admin.queries';

describe('clearFailedDeviceSyncJobs', () => {
  it('exclui somente falhas do cliente solicitado em uma única operação', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [['job-1'], ['job-2']] });
    const db = drizzle({ client: { query } as never }) as AppDb;

    await expect(clearFailedDeviceSyncJobs(db, 'client-1')).resolves.toBe(2);

    expect(query).toHaveBeenCalledTimes(1);
    const [config, parameters] = query.mock.calls[0] as unknown as [
      { text: string },
      string[],
    ];
    expect(config.text).toBe(
      'delete from "device_sync_jobs" where ("device_sync_jobs"."client_id" = $1 and "device_sync_jobs"."status" = $2) returning "id"',
    );
    expect(parameters).toEqual(['client-1', 'failed']);
  });
});
