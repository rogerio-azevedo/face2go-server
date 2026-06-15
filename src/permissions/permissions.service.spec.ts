import { Test, TestingModule } from '@nestjs/testing';

import { PermissionsService } from './permissions.service';
import { DatabaseService } from '../database/database.service';

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
      ],
    }).compile();

    service = module.get(PermissionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
