import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClientDashboardDto } from '../validation/dto/dashboard.dto';
import { DashboardService } from './dashboard.service';

@ApiTags('client-dashboard')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator', 'face_user')
@Controller('client/dashboard')
export class ClientDashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({
    summary:
      'Painel da unidade: pendências, pessoas, leitores e acessos do dia',
  })
  @ApiOkResponse({ type: ClientDashboardDto })
  getOverview(@CurrentUser() user: JwtPayload) {
    return this.dashboardService.getClientOverview(user);
  }
}
