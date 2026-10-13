import { Test } from '@nestjs/testing';
import request from 'supertest';
import { NotFoundException } from '@nestjs/common';
import type { Server } from 'node:http';
import { PublicChildApprovalsController } from './public-child-approvals.controller';
import { ChildApprovalService } from './child-approval.service';
import { ChildApprovalPhotoService } from './child-approval-photo.service';

describe('Child approval thumbnail response', () => {
  it('entrega a foto sem cache compartilhado e sem transformar erros em imagem', async () => {
    const photos = {
      load: jest.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
    };
    const module = await Test.createTestingModule({
      controllers: [PublicChildApprovalsController],
      providers: [
        { provide: ChildApprovalService, useValue: {} },
        { provide: ChildApprovalPhotoService, useValue: photos },
      ],
    }).compile();
    const app = module.createNestApplication();
    await app.init();
    const server = app.getHttpServer() as Server;
    try {
      const response = await request(server)
        .get(`/child-approvals/${'a'.repeat(64)}/photo`)
        .expect(200);
      expect(response.headers).toMatchObject({
        'cache-control': 'private, no-store',
        'content-type': 'image/jpeg',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      photos.load.mockRejectedValue(
        new NotFoundException('Foto indisponível.'),
      );
      await request(server).get('/child-approvals/invalid/photo').expect(404);
    } finally {
      await app.close();
    }
  });
});
