import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ClientAlertsListDto,
  ClientAlertsListQueryDto,
} from '../validation/dto/alerts.dto';
import { AlertsService } from './alerts.service';

function requireClientTenant(user: JwtPayload): {
  companyId: string;
  clientId: string;
} {
  const companyId = user.companyId?.trim();
  const clientId = user.clientId?.trim();
  if (!companyId || !clientId) {
    throw new ForbiddenException('Cliente não associado ao usuário.');
  }
  return { companyId, clientId };
}

@ApiTags('client-alerts')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/alerts')
export class ClientAlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar tentativas de acesso bloqueadas da unidade atual',
  })
  @ApiOkResponse({ type: ClientAlertsListDto })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ClientAlertsListQueryDto,
  ) {
    const { companyId, clientId } = requireClientTenant(user);
    return this.alerts.listBlockedAttempts(
      companyId,
      clientId,
      query.page ?? 1,
    );
  }
}
