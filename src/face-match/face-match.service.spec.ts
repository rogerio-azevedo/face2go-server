import { Test } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import * as galleryQueries from '../database/queries/client-face-embeddings.queries';
import { R2StorageService } from '../storage/r2-storage.service';
import { embedJpeg } from './face-embedder';
import { FaceMatchService } from './face-match.service';

jest.mock('./face-embedder', () => ({
  embedJpeg: jest.fn(),
}));

const blocked = {
  faceId: 22,
  name: 'João',
  photoKey: 'photos/joao.jpg',
  blocked: true,
};

describe('FaceMatchService', () => {
  let service: FaceMatchService;

  beforeEach(async () => {
    jest.mocked(embedJpeg).mockReset();
    const module = await Test.createTestingModule({
      providers: [
        FaceMatchService,
        { provide: DatabaseService, useValue: { db: {} } },
        { provide: R2StorageService, useValue: { getObjectBytes: jest.fn() } },
      ],
    }).compile();
    service = module.get(FaceMatchService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('anexa o bloqueado quando a duplicata veio sem id', async () => {
    jest
      .spyOn(galleryQueries, 'listClientGalleryFaces')
      .mockResolvedValue([blocked]);
    jest.spyOn(galleryQueries, 'listEmbeddingsByClient').mockResolvedValue([
      {
        faceId: 22,
        photoKey: 'photos/joao.jpg',
        blocked: true,
        embedding: [1, 0],
      },
    ]);
    jest.mocked(embedJpeg).mockResolvedValue([1, 0]);

    const messages = await service.annotateUnnamedDuplicates({
      clientId: 'client-1',
      faceId: 234,
      imageBuffer: Buffer.from('jpeg'),
      messages: ['Porta Saida: Foto já cadastrada.'],
      collidingFaceIds: [null],
    });

    expect(messages[0]).toBe(
      'Porta Saida: Foto já cadastrada. Parece com João (bloqueado, ID leitor 22, 100%).',
    );
  });

  it('não troca o nome que o leitor já devolveu', async () => {
    const listFaces = jest.spyOn(galleryQueries, 'listClientGalleryFaces');
    const messages = await service.annotateUnnamedDuplicates({
      clientId: 'client-1',
      faceId: 234,
      imageBuffer: Buffer.from('jpeg'),
      messages: [
        'Porta: Foto já cadastrada. Coincide com Isadora (ID leitor 22).',
      ],
      collidingFaceIds: [22],
    });

    expect(messages[0]).toMatch(/Coincide com Isadora/);
    expect(listFaces).not.toHaveBeenCalled();
  });

  it('mantém o erro do leitor quando a comparação falha', async () => {
    jest.spyOn(galleryQueries, 'listClientGalleryFaces').mockResolvedValue([]);
    jest.spyOn(galleryQueries, 'listEmbeddingsByClient').mockResolvedValue([]);
    jest.mocked(embedJpeg).mockRejectedValue(new Error('modelo ausente'));

    const messages = await service.annotateUnnamedDuplicates({
      clientId: 'client-1',
      faceId: 234,
      imageBuffer: Buffer.from('jpeg'),
      messages: ['Porta: Foto já cadastrada.'],
      collidingFaceIds: [null],
    });

    expect(messages[0]).toMatch(/Não foi possível comparar/);
    expect(messages[0]).toMatch(/Foto já cadastrada/);
  });
});
