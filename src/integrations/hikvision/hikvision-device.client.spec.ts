import {
  assertHikvisionEmployeeNoMatch,
  buildFuzzySearchCaseVariants,
  buildHikvisionFaceMultipartBody,
  buildUserInfoBody,
  chooseFaceLib,
  HIKVISION_USER_TYPE_BLACK_LIST,
  HIKVISION_USER_TYPE_NORMAL,
  hikvisionFdSearchIndicatesFace,
  hikvisionUserHasRecordedFace,
  hikvisionUserInfoSearchId,
  isHikvisionHttp401,
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

describe('hikvisionUserInfoSearchId', () => {
  it('é estável para o mesmo leitor e filtro', () => {
    const a = hikvisionUserInfoSearchId('http://leitor:80', '');
    const b = hikvisionUserInfoSearchId('http://leitor:80', '');
    expect(a).toBe(b);
    expect(a).toMatch(/^face2go-[0-9a-f]{12}$/);
  });

  it('muda quando o leitor ou o filtro mudam', () => {
    const list = hikvisionUserInfoSearchId('http://leitor:80', '');
    expect(hikvisionUserInfoSearchId('http://outro:80', '')).not.toBe(list);
    expect(hikvisionUserInfoSearchId('http://leitor:80', 'ANA')).not.toBe(list);
  });
});

describe('hikvisionUserHasRecordedFace', () => {
  const user = {
    userId: '5',
    name: 'Sueli',
    cardNo: null,
    validFrom: null,
    validTo: null,
    hasFace: false,
  };

  it('recusa user sem face e sem foto na busca', () => {
    expect(hikvisionUserHasRecordedFace(user, '5', {})).toBe(false);
    expect(hikvisionUserHasRecordedFace(null, '5')).toBe(false);
    expect(hikvisionUserHasRecordedFace({ ...user, userId: '9' }, '5')).toBe(
      false,
    );
  });

  it('aceita user com hasFace mesmo sem FDSearch', () => {
    expect(hikvisionUserHasRecordedFace({ ...user, hasFace: true }, '5')).toBe(
      true,
    );
  });

  it('aceita foto encontrada no FDSearch', () => {
    expect(
      hikvisionUserHasRecordedFace(user, '5', {
        pictureURL: 'http://leitor/face.jpg',
      }),
    ).toBe(true);
  });

  it('aceita FDSearch com matches sem URL (DS-K1T343)', () => {
    expect(hikvisionFdSearchIndicatesFace({ numOfMatches: 1 })).toBe(true);
    expect(
      hikvisionUserHasRecordedFace(user, '5', {
        MatchList: [{ FPID: '5' }],
      }),
    ).toBe(true);
  });
});

describe('isHikvisionHttp401', () => {
  it('reconhece 401 do axios', () => {
    expect(
      isHikvisionHttp401({
        message: 'Request failed with status code 401',
        response: { status: 401 },
      }),
    ).toBe(true);
    expect(isHikvisionHttp401(new Error('timeout'))).toBe(false);
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

describe('buildUserInfoBody', () => {
  it('usa userType normal por padrão', () => {
    const body = buildUserInfoBody({
      employeeNo: '1',
      name: 'ROGERIO',
    });
    const userInfo = body.UserInfo as Record<string, unknown>;

    expect(userInfo.userType).toBe(HIKVISION_USER_TYPE_NORMAL);
    expect(userInfo.employeeNo).toBe('1');
  });

  it('usa userType blackList quando blocked=true', () => {
    const body = buildUserInfoBody({
      employeeNo: '1',
      name: 'ROGERIO',
      blocked: true,
    });
    const userInfo = body.UserInfo as Record<string, unknown>;

    expect(userInfo.userType).toBe(HIKVISION_USER_TYPE_BLACK_LIST);
  });
});
