import { Body, Controller, ForbiddenException, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UpdatePushTokenDto } from '../validation/dto/common.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Roles('responsible')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Patch('push-token')
  @ApiOperation({ summary: 'Registrar token Expo Push do app (responsável)' })
  async registerPushToken(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdatePushTokenDto,
  ) {
    const rid = user.responsibleId;
    if (!rid) {
      throw new ForbiddenException('Usuário não possui perfil de responsável.');
    }
    await this.notifications.updatePushToken(rid, body.pushToken);
    return { ok: true };
  }
}
