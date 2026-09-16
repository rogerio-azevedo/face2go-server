import {
  clearHikvisionSnapshotChannelCache,
  hikvisionCaptureLiveSnapshot,
  hikvisionSnapshotPictureUrl,
  isJpegBuffer,
  pickHikvisionSnapshotChannelId,
} from './hikvision-snapshot.client';

jest.mock('./hikvision-isapi-request', () => ({
  hikvisionIsapiRequest: jest.fn(),
}));

import { hikvisionIsapiRequest } from './hikvision-isapi-request';

const connection = {
  baseUrl: 'http://192.168.1.181',
  username: 'admin',
  password: 'secret',
};

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

describe('isJpegBuffer', () => {
  it('exige magic FF D8', () => {
    expect(isJpegBuffer(jpeg)).toBe(true);
    expect(isJpegBuffer(Buffer.from([0x00, 0x00]))).toBe(false);
    expect(isJpegBuffer(null)).toBe(false);
  });
});

describe('pickHikvisionSnapshotChannelId', () => {
  it('prefere 101 no XML da bancada', () => {
    expect(
      pickHikvisionSnapshotChannelId(
        '<StreamingChannelList><StreamingChannel><id>101</id></StreamingChannel></StreamingChannelList>',
      ),
    ).toBe(101);
  });

  it('usa o primeiro id quando 101 não existe', () => {
    expect(
      pickHikvisionSnapshotChannelId(
        '<StreamingChannel><id>1</id></StreamingChannel>',
      ),
    ).toBe(1);
  });

  it('lê JSON StreamingChannelList', () => {
    expect(
      pickHikvisionSnapshotChannelId({
        StreamingChannelList: {
          StreamingChannel: [{ id: '102' }, { id: 101 }],
        },
      }),
    ).toBe(101);
  });
});

describe('hikvisionSnapshotPictureUrl', () => {
  it('monta URL do snapshot JPEG', () => {
    expect(hikvisionSnapshotPictureUrl(connection, 101)).toBe(
      'http://192.168.1.181/ISAPI/Streaming/channels/101/picture?snapShotImageType=JPEG',
    );
  });
});

describe('hikvisionCaptureLiveSnapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearHikvisionSnapshotChannelCache();
  });

  it('baixa JPEG do canal descoberto', async () => {
    jest
      .mocked(hikvisionIsapiRequest)
      .mockResolvedValueOnce({
        data: '<StreamingChannel><id>101</id></StreamingChannel>',
      } as never)
      .mockResolvedValueOnce({ data: jpeg } as never);

    const result = await hikvisionCaptureLiveSnapshot(connection);
    expect(result?.equals(jpeg)).toBe(true);
    expect(hikvisionIsapiRequest).toHaveBeenNthCalledWith(
      2,
      connection,
      expect.objectContaining({
        url: hikvisionSnapshotPictureUrl(connection, 101),
        responseType: 'arraybuffer',
      }),
    );
  });

  it('tenta canal 101 se a listagem falhar', async () => {
    jest
      .mocked(hikvisionIsapiRequest)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: jpeg } as never);

    const result = await hikvisionCaptureLiveSnapshot(connection);
    expect(result?.equals(jpeg)).toBe(true);
  });
});
