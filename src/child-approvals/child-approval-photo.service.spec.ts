import { NotFoundException } from '@nestjs/common';
import sharp from 'sharp';
import { ChildApprovalPhotoService } from './child-approval-photo.service';

describe('ChildApprovalPhotoService', () => {
  const token = 'a'.repeat(64);
  const invitations = { bundle: jest.fn() };
  const repository = { consentByRequest: jest.fn() };
  const storage = { getObjectBytes: jest.fn() };
  const service = new ChildApprovalPhotoService(
    invitations as never,
    repository as never,
    storage as never,
  );
  let bundle: {
    request: {
      id: string;
      unitId: string;
      expiresAt: Date;
      acceptedAt: Date | null;
      canceledAt: Date | null;
    };
    client: {
      id: string;
      isActive: boolean;
      enableChildApprove: boolean;
      timezoneOffsetMinutes: number;
    };
    child: {
      faceImageKey: string;
      birthDate: string;
      childApprovalRequired: boolean;
      isActive: boolean;
      unitId: string;
    };
    adult: {
      birthDate: string;
      isActive: boolean;
      status: string;
      unitId: string;
    };
  };

  beforeEach(() => {
    jest.resetAllMocks();
    bundle = {
      request: {
        id: 'request',
        unitId: 'unit',
        expiresAt: new Date(Date.now() + 86400_000),
        acceptedAt: null,
        canceledAt: null,
      },
      client: {
        id: 'client',
        isActive: true,
        enableChildApprove: true,
        timezoneOffsetMinutes: -240,
      },
      child: {
        faceImageKey: 'private/child/face.jpg',
        birthDate: '2014-01-13',
        childApprovalRequired: true,
        isActive: true,
        unitId: 'unit',
      },
      adult: {
        birthDate: '1990-01-01',
        isActive: true,
        status: 'approved',
        unitId: 'unit',
      },
    };
    invitations.bundle.mockResolvedValue(bundle);
    repository.consentByRequest.mockResolvedValue(undefined);
  });

  it('entrega somente miniatura JPEG do menor vinculado, sem metadados da foto original', async () => {
    const original = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: '#556677' },
    })
      .withMetadata({ exif: { IFD0: { Copyright: 'Private metadata' } } })
      .jpeg()
      .toBuffer();
    storage.getObjectBytes.mockResolvedValue({ buffer: original });
    const thumbnail = await service.load(token);
    const metadata = await sharp(thumbnail).metadata();
    expect(invitations.bundle).toHaveBeenCalledWith(token);
    expect(storage.getObjectBytes).toHaveBeenCalledWith(
      'private/child/face.jpg',
    );
    expect(metadata).toMatchObject({ format: 'jpeg', width: 240, height: 320 });
    expect(metadata.exif).toBeUndefined();
  });

  it.each([
    'expired',
    'canceled',
    'adult_unit',
    'child_unit',
    'adult_inactive',
    'adult_unapproved',
    'flag_off',
    'client_inactive',
    'revoked',
  ])('recusa a foto antes de acessar o armazenamento: %s', async (state) => {
    if (state === 'expired') bundle.request.expiresAt = new Date(0);
    if (state === 'canceled') bundle.request.canceledAt = new Date();
    if (state === 'adult_unit') bundle.adult.unitId = 'other-unit';
    if (state === 'child_unit') bundle.child.unitId = 'other-unit';
    if (state === 'adult_inactive') bundle.adult.isActive = false;
    if (state === 'adult_unapproved') bundle.adult.status = 'draft';
    if (state === 'flag_off') bundle.client.enableChildApprove = false;
    if (state === 'client_inactive') bundle.client.isActive = false;
    if (state === 'revoked') {
      bundle.request.acceptedAt = new Date();
      repository.consentByRequest.mockResolvedValue({ revokedAt: new Date() });
    }
    await expect(service.load(token)).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.getObjectBytes).not.toHaveBeenCalled();
  });

  it('link inválido não alcança a foto nem o histórico de aceite', async () => {
    invitations.bundle.mockRejectedValue(
      new NotFoundException('Link inválido.'),
    );
    await expect(service.load('invalid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.consentByRequest).not.toHaveBeenCalled();
    expect(storage.getObjectBytes).not.toHaveBeenCalled();
  });

  it('aceite ativo continua permitindo identificar o menor ao gerir a revogação', async () => {
    bundle.request.acceptedAt = new Date();
    bundle.request.expiresAt = new Date(0);
    repository.consentByRequest.mockResolvedValue({ revokedAt: null });
    storage.getObjectBytes.mockResolvedValue({
      buffer: await sharp({
        create: { width: 100, height: 100, channels: 3, background: '#556677' },
      })
        .jpeg()
        .toBuffer(),
    });
    expect(await service.load(token)).toBeInstanceOf(Buffer);
  });

  it('falha do armazenamento não expõe a chave privada', async () => {
    storage.getObjectBytes.mockRejectedValue(
      new Error(bundle.child.faceImageKey),
    );
    await expect(service.load(token)).rejects.toThrow(
      'Não foi possível carregar a foto do menor.',
    );
  });
});
