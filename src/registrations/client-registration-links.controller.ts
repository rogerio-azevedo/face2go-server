import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RegistrationLinksService } from './registration-links.service';

@ApiTags('client-registration-links')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/registration-links')
export class ClientRegistrationLinksController {
  constructor(
    private readonly registrationLinksService: RegistrationLinksService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Gerar link de cadastro de usuário do cliente (portal cliente)',
  })
  create(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.registrationLinksService.createForClientTenant(user, body);
  }

  @Get()
  @ApiOperation({ summary: 'Listar links de cadastro do meu cliente' })
  list(@CurrentUser() user: JwtPayload) {
    return this.registrationLinksService.listForClientTenant(user);
  }

  @Patch(':linkId')
  @ApiOperation({ summary: 'Ativar/desativar um link (ex.: isActive: false)' })
  setActive(
    @CurrentUser() user: JwtPayload,
    @Param('linkId', ParseUUIDPipe) linkId: string,
    @Body() body: unknown,
  ) {
    return this.registrationLinksService.setActiveForClientTenant(
      user,
      linkId,
      body,
    );
  }

  @Delete(':linkId')
  @ApiOperation({
    summary:
      'Excluir um link de cadastro (some da lista; solicitações permanecem)',
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('linkId', ParseUUIDPipe) linkId: string,
  ) {
    return this.registrationLinksService.deleteForClientTenant(user, linkId);
  }
}
