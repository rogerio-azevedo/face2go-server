import { Test, TestingModule } from '@nestjs/testing';

import { PickupAuthorizationCommandsService } from './pickup-authorization-commands.service';
import { PickupAuthorizationsService } from './pickup-authorizations.service';

describe('PickupAuthorizationCommandsService', () => {
  let service: PickupAuthorizationCommandsService;
  const pickupService = {
    createFromResponsible: jest.fn(),
    cancelForResponsible: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PickupAuthorizationCommandsService,
        {
          provide: PickupAuthorizationsService,
          useValue: pickupService,
        },
      ],
    }).compile();

    service = module.get(PickupAuthorizationCommandsService);
  });

  it('delega createFromResponsible', async () => {
    pickupService.createFromResponsible.mockResolvedValue({ id: '1' });
    const user = { sub: 'u1' } as never;
    await service.createFromResponsible(user, { studentId: 's1' });
    expect(pickupService.createFromResponsible).toHaveBeenCalled();
  });
});

describe('PickupAuthorizationsService contract', () => {
  it('cancelForResponsible exists on commands service', () => {
    expect(
      typeof PickupAuthorizationCommandsService.prototype.cancelForResponsible,
    ).toBe('function');
  });
});
