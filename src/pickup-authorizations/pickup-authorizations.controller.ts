import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PickupAuthorizationsService } from './pickup-authorizations.service';

@ApiTags('pickup-authorizations')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator', 'client_admin')
@Controller('clients/:clientId/pickup-authorizations')
export class PickupAuthorizationsSchoolController {
  constructor(private readonly svc: PickupAuthorizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar autorizações temporárias de retirada (escola)' })
  @ApiQuery({ name: 'studentId', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Query('studentId') studentId?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.listForSchoolClient(user, clientId, { studentId, status });
  }

  @Patch(':id/mark-used')
  @ApiOperation({ summary: 'Marcar autorização como utilizada pela portaria' })
  async markUsed(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.markUsedForSchool(user, clientId, id);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancelar autorização (escola)' })
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelForSchool(user, clientId, id);
  }
}

@ApiTags('pickup-authorizations-responsible')
@ApiBearerAuth()
@Roles('responsible')
@Controller('responsible')
export class PickupAuthorizationsResponsibleController {
  constructor(private readonly svc: PickupAuthorizationsService) {}

  @Get('pickup-authorizations')
  @ApiOperation({ summary: 'Listar minhas autorizações temporárias de retirada' })
  listMine(@CurrentUser() user: JwtPayload) {
    return this.svc.listForResponsible(user);
  }

  @Post('pickup-authorizations')
  @ApiOperation({ summary: 'Criar autorização temporária de retirada' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.svc.createFromResponsible(user, body);
  }

  @Patch('pickup-authorizations/:id/cancel')
  @ApiOperation({ summary: 'Cancelar minha autorização ativa' })
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.svc.cancelForResponsible(user, id);
  }
}
