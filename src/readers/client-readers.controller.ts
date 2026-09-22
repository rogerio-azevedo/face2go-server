import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReadersRemoteOpenService } from './readers-remote-open.service';
import { ReadersService } from './readers.service';

@ApiTags('client-readers')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/readers')
export class ClientReadersController {
  constructor(
    private readonly readersService: ReadersService,
    private readonly remoteOpen: ReadersRemoteOpenService,
  ) {}

  @Get('monitor/status')
  @Roles('client_admin')
  @ApiOperation({
    summary: 'Status de monitoramento dos leitores da unidade (conexão stream)',
  })
  monitorStatus(@CurrentUser() user: JwtPayload) {
    return this.readersService.getMonitorStatusForClientTenant(user);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar leitores faciais da unidade atual',
  })
  list(@CurrentUser() user: JwtPayload) {
    return this.readersService.listOptionsForClientTenant(user);
  }

  @Post(':readerId/open')
  @Roles('client_admin')
  @ApiOperation({
    summary: 'Acionar abertura remota do leitor da unidade',
  })
  openDoor(
    @CurrentUser() user: JwtPayload,
    @Param('readerId', ParseUUIDPipe) readerId: string,
  ) {
    return this.remoteOpen.openForClientTenant(user, readerId);
  }
}
