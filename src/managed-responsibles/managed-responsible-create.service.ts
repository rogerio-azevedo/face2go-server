import { Injectable } from '@nestjs/common';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ManagedResponsiblesService } from './managed-responsibles.service';

/** Use-cases de cadastro presencial de responsáveis (Fluxo 1). */
@Injectable()
export class ManagedResponsibleCreateService {
  constructor(
    private readonly managedResponsiblesService: ManagedResponsiblesService,
  ) {}

  createManaged(user: JwtPayload, body: unknown) {
    return this.managedResponsiblesService.createManagedResponsible(user, body);
  }
}
