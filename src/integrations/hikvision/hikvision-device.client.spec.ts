import { buildHikvisionFaceMultipartBody } from './hikvision-device.client';

describe('buildHikvisionFaceMultipartBody', () => {
  it('monta multipart com FaceDataRecord JSON e JPEG binário', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    const { body, contentType, imageFieldName } =
      buildHikvisionFaceMultipartBody('123', jpeg);

    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(imageFieldName).toBe('FaceImage');

    const text = body.toString('latin1');
    expect(text).toContain('name="FaceDataRecord"');
    expect(text).toContain('"FPID":"123"');
    expect(text).toContain('name="FaceImage"');
    expect(text).toContain('Content-Type: image/jpeg');
    expect(body.includes(jpeg)).toBe(true);
  });

  it('permite campo img como fallback de firmware', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff]);
    const { body, imageFieldName } = buildHikvisionFaceMultipartBody(
      '99',
      jpeg,
      {
        imageFieldName: 'img',
      },
    );

    expect(imageFieldName).toBe('img');
    expect(body.toString('latin1')).toContain('name="img"');
  });
});
