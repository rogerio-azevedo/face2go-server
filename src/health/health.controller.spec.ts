import { Test } from '@nestjs/testing';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('retorna payload de health', () => {
    const payload = controller.ping();
    expect(payload.ok).toBe(true);
    expect(payload.message).toContain('API online');
    expect(payload.build).toBeDefined();
  });
});
