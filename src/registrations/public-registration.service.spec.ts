import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { DatabaseService } from '../database/database.service';
import * as membersQueries from '../database/queries/members.queries';
import * as readersQueries from '../database/queries/readers.queries';
import * as registrationsQueries from '../database/queries/registrations.queries';
import { R2StorageService } from '../storage/r2-storage.service';
import { PublicRegistrationService } from './public-registration.service';
import { DOCUMENT_ALREADY_MEMBER_MESSAGE } from './registration-document-unique';

const registrationId = '3c1b0e5a-6d7f-4a91-9b2c-8e4d1f0a7c33';

describe('PublicRegistrationService', () => {
  let service: PublicRegistrationService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PublicRegistrationService,
        { provide: DatabaseService, useValue: { db: {} } },
        { provide: R2StorageService, useValue: { assertObjectExists: jest.fn() } },
      ],
    }).compile();

    service = module.get(PublicRegistrationService);
    jest.restoreAllMocks();
  });

  it('devolve 409 quando o documento já está no cliente', async () => {
    jest
      .spyOn(registrationsQueries, 'getActiveRegistrationLinkWithClient')
      .mockResolvedValue({
        link: {
          id: 'link-1',
          isActive: true,
          validFrom: null,
          expiresAt: null,
        },
        client: {
          id: 'client-1',
          companyId: 'company-1',
          type: 'condominium',
          isActive: true,
          registrationConfig: null,
        },
      } as never);
    jest
      .spyOn(readersQueries, 'hasRestrictMinorsReaderByClient')
      .mockResolvedValue(false);
    jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue({ id: 'member-1' } as never);

    const body = {
      registrationId,
      name: 'Morador Teste',
      document: '52998224725',
      phone: '51999999999',
      email: 'morador@example.com',
      faceImageKey: `company-1/client-1/${registrationId}/face.jpg`,
      additionalData: { block: 'A', unit: '101' },
      truthDeclared: true,
    };

    await expect(service.submit('569SQ7AF', body)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.submit('569SQ7AF', body)).rejects.toThrow(
      DOCUMENT_ALREADY_MEMBER_MESSAGE,
    );
  });

  it('checkDocument normaliza pontuação e bloqueia no Continuar', async () => {
    jest
      .spyOn(registrationsQueries, 'getActiveRegistrationLinkWithClient')
      .mockResolvedValue({
        link: {
          id: 'link-1',
          isActive: true,
          validFrom: null,
          expiresAt: null,
        },
        client: {
          id: 'client-1',
          isActive: true,
        },
      } as never);
    const memberSpy = jest
      .spyOn(membersQueries, 'findMemberByNormalizedDocument')
      .mockResolvedValue({ id: 'member-1' } as never);

    await expect(
      service.checkDocument('569SQ7AF', { document: '529.982.247-25' }),
    ).rejects.toThrow(DOCUMENT_ALREADY_MEMBER_MESSAGE);

    expect(memberSpy).toHaveBeenCalledWith(
      {},
      'client-1',
      '52998224725',
      undefined,
    );
  });
});
