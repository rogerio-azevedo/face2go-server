import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ClientsRepository } from '../database/repositories/clients.repository';
import { RegistrationFaceRetakeRepository } from '../database/repositories/registration-face-retake.repository';
import * as faceVariants from '../face-sync/face-image-variants';
import { FaceSyncService } from '../face-sync/face-sync.service';
import { PermissionsService } from '../permissions/permissions.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { RegistrationFaceRetakeService } from './registration-face-retake.service';
import { FACE_RETAKE_GUIDANCE } from './registration-face-retake.util';

const user: JwtPayload = {
  sub: 'user-1',
  email: 'op@example.com',
  role: 'client_admin',
  contextType: 'client',
  clientId: 'client-1',
};

const registrationId = '3c1b0e5a-6d7f-4a91-9b2c-8e4d1f0a7c33';

describe('RegistrationFaceRetakeService', () => {
  let service: RegistrationFaceRetakeService;
  const retakes = {
    findRegistration: jest.fn(),
    findBundleByCode: jest.fn(),
    insertReplacingOpen: jest.fn(),
    consumeAndSetFace: jest.fn(),
  };
  const faceSync = { enqueueApprovedRegistrationJob: jest.fn() };
  const r2 = {
    extForImageMime: jest.fn().mockReturnValue('jpg'),
    buildFaceDraftKey: jest.fn().mockReturnValue('co/client-1/reg/face.jpg'),
    putObject: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        RegistrationFaceRetakeService,
        { provide: RegistrationFaceRetakeRepository, useValue: retakes },
        {
          provide: ClientsRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue({
              id: 'client-1',
              isActive: true,
              companyId: 'company-1',
            }),
          },
        },
        { provide: PermissionsService, useValue: {} },
        { provide: R2StorageService, useValue: r2 },
        { provide: FaceSyncService, useValue: faceSync },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('https://app.example.com'),
          },
        },
      ],
    }).compile();
    service = module.get(RegistrationFaceRetakeService);
    jest
      .spyOn(faceVariants, 'storeReaderFaceVariants')
      .mockResolvedValue(undefined);
  });

  it('recusa gerar link para cadastro rejeitado', async () => {
    retakes.findRegistration.mockResolvedValue({
      isActive: true,
      submittedAt: new Date(),
      status: 'rejected',
    });
    await expect(
      service.createForClientTenant(user, registrationId),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(retakes.insertReplacingOpen).not.toHaveBeenCalled();
  });

  it('devolve a URL pública e a mensagem padrão', async () => {
    retakes.findRegistration.mockResolvedValue({
      isActive: true,
      submittedAt: new Date(),
      status: 'draft',
    });
    retakes.insertReplacingOpen.mockImplementation(
      (input: { code: string; expiresAt: Date }) => input,
    );
    const result = await service.createForClientTenant(user, registrationId);
    expect(result.url).toMatch(
      /^https:\/\/app\.example\.com\/cadastro\/refazer\/[A-Z0-9]+$/,
    );
    expect(result.message).toContain(FACE_RETAKE_GUIDANCE);
    expect(result.message).toContain(result.url);
  });

  it('enfileira sync quando o cadastro aprovado recebe foto nova', async () => {
    retakes.findBundleByCode.mockResolvedValue({
      companyId: 'company-1',
      clientIsActive: true,
      clientName: 'Portaria',
      clientLogoUrl: null,
      link: { usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
      registration: {
        id: registrationId,
        clientId: 'client-1',
        name: 'Maria Souza',
        isActive: true,
        submittedAt: new Date(),
        status: 'approved',
      },
    });
    retakes.consumeAndSetFace.mockResolvedValue({
      ok: true,
      registration: {
        id: registrationId,
        clientId: 'client-1',
        status: 'approved',
        faceId: 12,
      },
    });

    const file = {
      buffer: Buffer.alloc(2048, 1),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;
    const result = await service.uploadPhoto('ABC123', file);

    expect(result.faceImageKey).toBe('co/client-1/reg/face.jpg');
    expect(faceSync.enqueueApprovedRegistrationJob).toHaveBeenCalledWith(
      registrationId,
      'client-1',
      undefined,
      { resetReaderProgress: true },
    );
  });

  it('não sincroniza rascunho', async () => {
    retakes.findBundleByCode.mockResolvedValue({
      companyId: 'company-1',
      clientIsActive: true,
      clientName: 'Portaria',
      clientLogoUrl: null,
      link: { usedAt: null, expiresAt: new Date(Date.now() + 60_000) },
      registration: {
        id: registrationId,
        clientId: 'client-1',
        name: 'Maria Souza',
        isActive: true,
        submittedAt: new Date(),
        status: 'draft',
      },
    });
    retakes.consumeAndSetFace.mockResolvedValue({
      ok: true,
      registration: {
        id: registrationId,
        clientId: 'client-1',
        status: 'draft',
        faceId: null,
      },
    });

    const file = {
      buffer: Buffer.alloc(2048, 1),
      mimetype: 'image/jpeg',
    } as Express.Multer.File;
    await service.uploadPhoto('ABC123', file);
    expect(faceSync.enqueueApprovedRegistrationJob).not.toHaveBeenCalled();
  });
});
