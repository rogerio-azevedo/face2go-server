import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ALLOW_IDENTITY_KEY } from '../decorators/allow-identity.decorator';

@Injectable()
export class ContextRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowIdentity = this.reflector.getAllAndOverride<boolean>(
      ALLOW_IDENTITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowIdentity) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (user?.contextType === 'identity') {
      throw new ForbiddenException('Selecione um contexto de acesso.');
    }
    return true;
  }
}
