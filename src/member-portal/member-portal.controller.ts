import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { MemberPortalService } from './member-portal.service';

@ApiTags('member-portal')
@ApiBearerAuth()
@Roles('member')
@Controller('member')
export class MemberPortalController {
  constructor(private readonly memberPortalService: MemberPortalService) {}

  @Get('me')
  @ApiOperation({ summary: 'Perfil do membro autenticado (app)' })
  getMe(@CurrentUser() user: JwtPayload) {
    return this.memberPortalService.getMe(user);
  }
}
