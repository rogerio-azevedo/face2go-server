import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthPasswordService } from './auth-password.service';
import { AuthService } from './auth.service';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';

describe('AuthService', () => {
  let service: AuthService;
  let whereResponsible: jest.Mock;
  let whereMember: jest.Mock;

  beforeEach(async () => {
    const limit = jest.fn().mockResolvedValue([
      { id: 'user-1', isActive: true, role: 'member' },
    ]);
    const whereUser = jest.fn().mockReturnValue({ limit });
    const fromUser = jest.fn().mockReturnValue({ where: whereUser });

    const whereCompany = jest.fn().mockResolvedValue([]);
    const innerJoinCompany = jest.fn().mockReturnValue({ where: whereCompany });
    const fromCompany = jest.fn().mockReturnValue({ innerJoin: innerJoinCompany });

    const whereClientUser = jest.fn().mockResolvedValue([]);
    const innerJoinClientUserCompany = jest
      .fn()
      .mockReturnValue({ where: whereClientUser });
    const innerJoinClientUser = jest
      .fn()
      .mockReturnValue({ innerJoin: innerJoinClientUserCompany });
    const fromClientUser = jest.fn().mockReturnValue({ innerJoin: innerJoinClientUser });

    whereResponsible = jest.fn().mockResolvedValue([]);
    const innerJoinResponsibleCompany = jest
      .fn()
      .mockReturnValue({ where: whereResponsible });
    const innerJoinResponsible = jest
      .fn()
      .mockReturnValue({ innerJoin: innerJoinResponsibleCompany });
    const fromResponsible = jest.fn().mockReturnValue({ innerJoin: innerJoinResponsible });

    whereMember = jest.fn().mockResolvedValue([]);
    const innerJoinMemberCompany = jest.fn().mockReturnValue({ where: whereMember });
    const innerJoinMemberClient = jest
      .fn()
      .mockReturnValue({ innerJoin: innerJoinMemberCompany });
    const innerJoinMemberRole = jest
      .fn()
      .mockReturnValue({ innerJoin: innerJoinMemberClient });
    const fromMember = jest.fn().mockReturnValue({ innerJoin: innerJoinMemberRole });

    let selectCall = 0;
    const db = {
      select: jest.fn().mockImplementation(() => {
        selectCall += 1;
        switch (selectCall) {
          case 1:
            return { from: fromUser };
          case 2:
            return { from: fromCompany };
          case 3:
            return { from: fromClientUser };
          case 4:
            return { from: fromResponsible };
          case 5:
            return { from: fromMember };
          default:
            throw new Error(`unexpected select call ${selectCall}`);
        }
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: DatabaseService,
          useValue: { db },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        {
          provide: EmailService,
          useValue: {},
        },
        {
          provide: AuthPasswordService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('getAllContexts consulta responsáveis e membros com filtro adicional', async () => {
    await service.getAllContexts('user-1');

    expect(whereResponsible).toHaveBeenCalledTimes(1);
    expect(whereMember).toHaveBeenCalledTimes(1);
    expect(whereResponsible.mock.calls[0]?.[0]).toBeDefined();
    expect(whereMember.mock.calls[0]?.[0]).toBeDefined();
  });
});
