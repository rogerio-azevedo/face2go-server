import { enqueueDeviceSyncBodySchema } from './device-sync-jobs.schema';

describe('enqueueDeviceSyncBodySchema', () => {
  it('force false quando body vazio ou omitido', () => {
    expect(enqueueDeviceSyncBodySchema.parse(undefined)).toEqual({
      force: false,
    });
    expect(enqueueDeviceSyncBodySchema.parse({})).toEqual({ force: false });
  });

  it('aceita force true', () => {
    expect(enqueueDeviceSyncBodySchema.parse({ force: true })).toEqual({
      force: true,
    });
  });
});
