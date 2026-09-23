import { enqueueDeviceSyncBodySchema } from './device-sync-jobs.schema';

describe('enqueueDeviceSyncBodySchema', () => {
  it('force false quando body vazio ou omitido', () => {
    expect(enqueueDeviceSyncBodySchema.parse(undefined)).toEqual({
      force: false,
      allowSimilarFace: false,
    });
    expect(enqueueDeviceSyncBodySchema.parse({})).toEqual({
      force: false,
      allowSimilarFace: false,
    });
  });

  it('aceita force true', () => {
    expect(enqueueDeviceSyncBodySchema.parse({ force: true })).toEqual({
      force: true,
      allowSimilarFace: false,
    });
  });

  it('aceita allowSimilarFace', () => {
    expect(
      enqueueDeviceSyncBodySchema.parse({ allowSimilarFace: true }),
    ).toEqual({
      force: false,
      allowSimilarFace: true,
    });
  });
});
