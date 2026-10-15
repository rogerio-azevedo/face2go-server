import { Body, Controller, ForbiddenException, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdatePushTokenDto } from '../validation/dto/common.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Roles('responsible', 'member', 'client_admin', 'client_operator')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Patch('push-token')
  @ApiOperation({
    summary:
      'Registrar token Expo Push do app (responsável, membro ou admin da unidade)',
  })
  async registerPushToken(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdatePushTokenDto,
  ) {
    if (user.role === 'responsible') {
      const rid = user.responsibleId;
      if (!rid) {
        throw new ForbiddenException(
          'Usuário não possui perfil de responsável.',
        );
      }
      await this.notifications.updatePushToken(rid, body.pushToken);
      return { ok: true };
    }

    if (user.role === 'member') {
      const mid = user.memberId;
      if (!mid) {
        throw new ForbiddenException('Usuário não possui perfil de membro.');
      }
      await this.notifications.updateMemberPushToken(mid, body.pushToken);
      return { ok: true };
    }

    if (user.role === 'client_admin' || user.role === 'client_operator') {
      const clientUserId = user.clientUserId;
      if (!clientUserId) {
        throw new ForbiddenException(
          'Usuário não possui vínculo com a unidade.',
        );
      }
      await this.notifications.updateClientUserPushToken(
        clientUserId,
        body.pushToken,
      );
      return { ok: true };
    }

    throw new ForbiddenException(
      'Perfil não autorizado a registrar push token.',
    );
  }
}
