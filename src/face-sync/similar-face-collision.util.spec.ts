import {
  extractCollidingFaceId,
  withCollidingPerson,
} from './similar-face-collision.util';

describe('extractCollidingFaceId', () => {
  it('lê employeeNo do corpo Hikvision e ignora a pessoa que está sendo enviada', () => {
    const error = {
      response: {
        data: {
          statusCode: 6,
          subStatusCode: 'faceDuplicate',
          employeeNo: '22',
          UserID: '24',
        },
      },
    };
    expect(extractCollidingFaceId(error, 24)).toBe(22);
  });

  it('lê FPID aninhado e o cause do erro do leitor', () => {
    const error = new Error('Foto já cadastrada.');
    error.cause = {
      response: {
        data: { MatchList: [{ FPID: '7' }] },
      },
    };
    expect(extractCollidingFaceId(error, 9)).toBe(7);
  });

  it('devolve null quando o corpo não traz outro id', () => {
    expect(
      extractCollidingFaceId({
        response: { data: { subStatusCode: 'faceDuplicate' } },
      }),
    ).toBeNull();
    expect(
      extractCollidingFaceId(
        {
          response: { data: { UserID: '24' } },
        },
        24,
      ),
    ).toBeNull();
  });
});

describe('withCollidingPerson', () => {
  it('anexa o nome e o id do leitor', () => {
    expect(
      withCollidingPerson('Porta Saída: Foto já cadastrada.', {
        faceId: 22,
        name: 'Isadora de Castro Souza',
      }),
    ).toBe(
      'Porta Saída: Foto já cadastrada. Coincide com Isadora de Castro Souza (ID leitor 22).',
    );
  });

  it('usa só o id quando o cadastro não está na base', () => {
    expect(
      withCollidingPerson('Porta Saída: Foto já cadastrada.', { faceId: 22 }),
    ).toBe('Porta Saída: Foto já cadastrada. Coincide com ID leitor 22.');
  });
});
