import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CreateClientAddressDto,
  PatchClientAddressDto,
} from '../validation/dto/client-addresses.dto';
import { ClientAddressesService } from './client-addresses.service';

@ApiTags('client-addresses')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('clients/:clientId/addresses')
export class ClientAddressesController {
  constructor(
    private readonly clientAddressesService: ClientAddressesService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar endereços do cliente' })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.clientAddressesService.list(user, clientId);
  }

  @Get(':addressId')
  @ApiOperation({ summary: 'Detalhe de um endereço do cliente' })
  getById(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return this.clientAddressesService.getById(user, clientId, addressId);
  }

  @Post()
  @ApiOperation({ summary: 'Criar endereço do cliente' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: CreateClientAddressDto,
  ) {
    return this.clientAddressesService.create(user, clientId, dto);
  }

  @Patch(':addressId')
  @ApiOperation({ summary: 'Atualizar endereço do cliente' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: PatchClientAddressDto,
  ) {
    return this.clientAddressesService.update(user, clientId, addressId, dto);
  }

  @Delete(':addressId')
  @ApiOperation({ summary: 'Excluir endereço do cliente' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return this.clientAddressesService.remove(user, clientId, addressId);
  }

  @Post(':addressId/set-primary')
  @ApiOperation({ summary: 'Marcar endereço como principal' })
  setPrimary(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return this.clientAddressesService.setPrimary(user, clientId, addressId);
  }
}
