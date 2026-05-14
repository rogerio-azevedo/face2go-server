import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ClientsService } from './clients.service';

@ApiTags('clients')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar clientes da empresa' })
  list(@CurrentUser() user: JwtPayload) {
    return this.clientsService.list(user);
  }

  @Get(':clientId')
  @ApiOperation({ summary: 'Obter cliente por ID' })
  getById(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientsService.getById(user, clientId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar cliente (apenas admin da empresa)' })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.clientsService.create(user, body);
  }

  @Patch(':clientId')
  @ApiOperation({ summary: 'Atualizar cliente (apenas admin da empresa)' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.clientsService.update(user, clientId, body);
  }

  @Patch(':clientId/active')
  @ApiOperation({
    summary: 'Ativar/inativar cliente (apenas admin da empresa)',
  })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() body: unknown,
  ) {
    return this.clientsService.setActive(user, clientId, body);
  }
}
