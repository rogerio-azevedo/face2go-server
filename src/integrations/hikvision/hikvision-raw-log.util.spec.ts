import {
  isHikvisionRawLogEnabled,
  logHikvisionRaw,
  previewHikvisionRawBody,
} from './hikvision-raw-log.util';

describe('previewHikvisionRawBody', () => {
  it('mantém JSON e XML inteiros', () => {
    const body = {
      statusCode: 4,
      subStatusCode: 'alreadyExistThisFace',
      errorMsg: 'saveFacePic',
    };
    expect(previewHikvisionRawBody(body)).toEqual(body);
    const xml = '<ResponseStatus><employeeNo>22</employeeNo></ResponseStatus>';
    expect(previewHikvisionRawBody(xml)).toBe(xml);
  });

  it('omite JPEG e multipart', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    expect(previewHikvisionRawBody(jpeg)).toBe('<omitido 4 bytes>');
    expect(
      previewHikvisionRawBody(
        'nao-imprimir',
        'multipart/form-data; boundary=x',
      ),
    ).toBe('<omitido 12 bytes>');
  });
});

describe('logHikvisionRaw', () => {
  const original = process.env.HIKVISION_DEBUG_RAW;

  afterEach(() => {
    if (original === undefined) delete process.env.HIKVISION_DEBUG_RAW;
    else process.env.HIKVISION_DEBUG_RAW = original;
  });

  it('fica quieto sem a flag', () => {
    delete process.env.HIKVISION_DEBUG_RAW;
    expect(isHikvisionRawLogEnabled()).toBe(false);
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    logHikvisionRaw({
      transport: 'local',
      method: 'POST',
      url: 'http://10.0.0.9/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
      responseData: { subStatusCode: 'alreadyExistThisFace' },
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('imprime o corpo inteiro com HIKVISION_DEBUG_RAW=1', () => {
    process.env.HIKVISION_DEBUG_RAW = '1';
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const jpeg = Buffer.from([0xff, 0xd8]);
    logHikvisionRaw({
      transport: 'gateway',
      method: 'post',
      url: 'http://10.0.0.9/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
      requestHeaders: { 'Content-Type': 'multipart/form-data; boundary=hik' },
      requestData: jpeg,
      httpStatus: 200,
      responseData: {
        statusCode: 4,
        subStatusCode: 'alreadyExistThisFace',
        errorCode: 1073782792,
        errorMsg: 'saveFacePic',
      },
    });
    expect(spy).toHaveBeenCalledWith(
      '[HikvisionRAW]',
      expect.stringContaining('alreadyExistThisFace'),
    );
    const line = String(spy.mock.calls[0]?.[1]);
    expect(line).toContain('saveFacePic');
    expect(line).toContain('<omitido 2 bytes>');
    expect(line).not.toContain(jpeg.toString('base64'));
    spy.mockRestore();
  });
});
