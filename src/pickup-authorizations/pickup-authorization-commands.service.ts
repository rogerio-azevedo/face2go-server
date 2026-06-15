import { Injectable } from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { PickupAuthorizationsService } from './pickup-authorizations.service';

/** Use-cases de criação/cancelamento de autorizações de retirada. */
@Injectable()
export class PickupAuthorizationCommandsService {
  constructor(
    private readonly pickupAuthorizationsService: PickupAuthorizationsService,
  ) {}

  createFromResponsible(user: JwtPayload, body: unknown) {
    return this.pickupAuthorizationsService.createFromResponsible(user, body);
  }

  cancelForResponsible(user: JwtPayload, authorizationId: string) {
    return this.pickupAuthorizationsService.cancelForResponsible(
      user,
      authorizationId,
    );
  }
}
