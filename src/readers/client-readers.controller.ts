import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ReadersService } from './readers.service';

@ApiTags('client-readers')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/readers')
export class ClientReadersController {
  constructor(private readonly readersService: ReadersService) {}

  @Get()
  @ApiOperation({
    summary: 'Listar leitores faciais da unidade atual (id e nome)',
  })
  list(@CurrentUser() user: JwtPayload) {
    return this.readersService.listOptionsForClientTenant(user);
  }
}
