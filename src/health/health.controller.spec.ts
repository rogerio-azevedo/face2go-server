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

    it('retorna ok', () => {
        expect(controller.ping()).toEqual({ ok: true });
    });
});
