import {
  assertHikvisionEmployeeNoMatch,
  buildFuzzySearchCaseVariants,
  buildHikvisionFaceMultipartBody,
  chooseFaceLib,
  parseUserInfoSearchPage,
} from './hikvision-device.client';

const defaultFaceLib = { fdid: '1', faceLibType: 'blackFD' };

describe('buildHikvisionFaceMultipartBody', () => {
  it('monta multipart com FaceDataRecord JSON e JPEG binário', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);
    const { body, contentType, imageFieldName } =
      buildHikvisionFaceMultipartBody('123', jpeg, defaultFaceLib);

    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(imageFieldName).toBe('FaceImage');

    const text = body.toString('latin1');
    expect(text).toContain('name="FaceDataRecord";');
    expect(text).not.toContain('filename="FaceDataRecord.json"');
    expect(text).toContain('"faceLibType":"blackFD"');
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
      defaultFaceLib,
      {
        imageFieldName: 'img',
      },
    );

    expect(imageFieldName).toBe('img');
    expect(body.toString('latin1')).toContain('name="img"');
  });
});

describe('chooseFaceLib', () => {
  it('prefere blackFD quando ambas existem', () => {
    const chosen = chooseFaceLib([
      { fdid: '2', faceLibType: 'whiteFD' },
      { fdid: '1', faceLibType: 'blackFD' },
    ]);

    expect(chosen).toEqual({ fdid: '1', faceLibType: 'blackFD' });
  });

  it('usa whiteFD quando blackFD não existe', () => {
    const chosen = chooseFaceLib([{ fdid: '2', faceLibType: 'whiteFD' }]);

    expect(chosen).toEqual({ fdid: '2', faceLibType: 'whiteFD' });
  });

  it('fallback para blackFD/1 quando lista vazia', () => {
    expect(chooseFaceLib([])).toEqual({ fdid: '1', faceLibType: 'blackFD' });
  });
});

describe('buildFuzzySearchCaseVariants', () => {
  it('gera variantes de caixa incluindo original', () => {
    const variants = buildFuzzySearchCaseVariants('guilherme');

    expect(variants).toContain('guilherme');
    expect(variants).toContain('GUILHERME');
    expect(variants).toContain('Guilherme');
  });
});

describe('assertHikvisionEmployeeNoMatch', () => {
  it('lança quando records[0].userId difere do employeeNo buscado', () => {
    expect(() =>
      assertHikvisionEmployeeNoMatch(
        {
          userId: '999',
          name: 'Outro',
          cardNo: null,
          validFrom: null,
          validTo: null,
          hasFace: true,
        },
        '1',
      ),
    ).toThrow('Busca no leitor não retornou employeeNo 1 (retornou 999).');
  });

  it('retorna o usuário quando employeeNo coincide', () => {
    const user = assertHikvisionEmployeeNoMatch(
      {
        userId: '1',
        name: 'Guilherme',
        cardNo: null,
        validFrom: null,
        validTo: null,
        hasFace: true,
      },
      '1',
    );

    expect(user.userId).toBe('1');
  });
});

describe('parseUserInfoSearchPage', () => {
  it('extrai totalMatches e hasFace da resposta ISAPI', () => {
    const result = parseUserInfoSearchPage({
      UserInfoSearch: {
        totalMatches: 612,
        numOfMatches: 2,
        responseStatusStrg: 'MORE',
        UserInfo: [
          {
            employeeNo: '1',
            name: 'Guilherme Machado',
            numOfFace: 1,
          },
          {
            employeeNo: '2',
            name: 'Outro Usuário',
            numOfFace: 0,
          },
        ],
      },
    });

    expect(result.totalCount).toBe(612);
    expect(result.found).toBe(2);
    expect(result.records[0]?.hasFace).toBe(true);
    expect(result.records[1]?.hasFace).toBe(false);
  });

  it('retorna totalCount 0 quando NO MATCH', () => {
    const result = parseUserInfoSearchPage({
      UserInfoSearch: {
        responseStatusStrg: 'NO MATCH',
        UserInfo: [],
      },
    });

    expect(result.totalCount).toBe(0);
    expect(result.records).toEqual([]);
  });
});
