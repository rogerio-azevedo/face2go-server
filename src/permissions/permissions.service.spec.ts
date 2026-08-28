import { Test, TestingModule } from '@nestjs/testing';

import { CompanyFeaturesService } from '../company-features/company-features.service';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let service: PermissionsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: DatabaseService,
          useValue: { db: {} },
        },
        {
          provide: CompanyFeaturesService,
          useValue: { isEnabled: jest.fn(), assertEnabled: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(PermissionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
