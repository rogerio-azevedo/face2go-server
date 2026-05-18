import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/decorators/public.decorator';
import { DatabaseService } from '../database/database.service';
import * as clientsQueries from '../database/queries/clients.queries';

@ApiTags('clients')
@Public()
@Controller('clients')
export class ClientDisplayResolveController {
  constructor(private readonly database: DatabaseService) {}

  @Get('display/resolve/:shortCode')
  @ApiOperation({
    summary: 'Resolver código curto do display TV (redireciona para clientId + token)',
  })
  async resolve(@Param('shortCode') shortCode: string) {
    const row = await clientsQueries.getClientByDisplayShortCode(
      this.database.db,
      shortCode,
    );
    if (!row?.displayToken) {
      throw new NotFoundException(
        'Código inválido ou display não configurado.',
      );
    }
    return { clientId: row.id, token: row.displayToken };
  }
}
