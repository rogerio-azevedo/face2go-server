import { ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import type { MoveLocationPersonInput } from '../validation/client-blocks.schema';
import { CondominiumAccessService } from './condominium-access.service';
import { LocationPersonMoveRepository } from './location-person-move.repository';

@Injectable()
export class LocationPersonMoveService {
  constructor(
    private readonly access: CondominiumAccessService,
    private readonly moves: LocationPersonMoveRepository,
  ) {}

  async move(
    user: JwtPayload,
    clientId: string,
    input: MoveLocationPersonInput,
  ) {
    // Same permission as moving a whole unit; enforce it beyond the controller.
    if (user.role !== 'company_admin')
      throw new ForbiddenException('Sem permissão.');
    await this.access.assertManage(user, clientId);
    await this.moves.move(clientId, user.sub, input);
    return { success: true };
  }
}
