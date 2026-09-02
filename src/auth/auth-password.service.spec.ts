import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';

import * as verificationTokensQueries from '../database/queries/verification-tokens.queries';
import { AuthPasswordService } from './auth-password.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

jest.mock('../database/queries/verification-tokens.queries');

// force deploy

describe('AuthPasswordService', () => {
  let service: AuthPasswordService;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };

  const database = { db: mockDb } as unknown as DatabaseService;
  const emailService = {
    sendPasswordResetEmail: jest.fn(),
  } as unknown as EmailService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthPasswordService,
        { provide: DatabaseService, useValue: database },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get(AuthPasswordService);
  });

  it('resetPassword rejeita token inválido', async () => {
    jest
      .spyOn(verificationTokensQueries, 'findValidVerificationToken')
      .mockResolvedValue(null);

    await expect(
      service.resetPassword({ token: 'invalid', password: 'secret1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requestPassword retorna ok mesmo sem usuário', async () => {
    await expect(
      service.requestPassword({ identifier: 'missing@example.com' }),
    ).resolves.toEqual({ ok: true });
  });
});
