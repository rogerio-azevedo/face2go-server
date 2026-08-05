import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { listCompanyPresenceQuerySchema } from '../validation/presence-emergency.schema';
import { PresenceService } from './presence.service';

@ApiTags('presence')
@ApiBearerAuth()
@Controller()
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get('clients/:clientId/presence')
  @Roles('company_admin', 'company_operator', 'client_admin', 'client_operator')
  @ApiOperation({ summary: 'Presença atual de uma escola/unidade' })
  getClientPresence(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = listCompanyPresenceQuerySchema.parse(query);
    return this.presenceService.getClientPresence(
      user,
      clientId,
      parsed.status ?? 'in',
    );
  }

  @Get('companies/:companyId/presence')
  @Roles('company_admin', 'company_operator')
  @ApiOperation({
    summary: 'Presença agregada da empresa ou de uma escola específica',
  })
  getCompanyPresence(
    @CurrentUser() user: JwtPayload,
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed = listCompanyPresenceQuerySchema.parse(query);
    if (user.companyId !== companyId) {
      return this.presenceService.getCompanyPresence(user, parsed.clientId, parsed.status ?? 'in');
    }
    return this.presenceService.getCompanyPresence(
      user,
      parsed.clientId,
      parsed.status ?? 'in',
    );
  }
}
