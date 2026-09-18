import { Controller, ForbiddenException, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ClientAccessesListQueryDto } from '../validation/dto/accesses.dto';
import {
  AccessesService,
  type ClientAccessListResponse,
  type FacialAccessPhotoUrlDto,
} from './accesses.service';

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

@ApiTags('client-accesses')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/accesses')
export class ClientAccessesController {
  constructor(private readonly accessesService: AccessesService) {}

  @Get(':id/photo')
  @ApiOperation({
    summary:
      'Obter URL assinada (GET) da foto facial de um acesso da unidade atual',
  })
  @ApiParam({ name: 'id', description: 'ID do documento (Mongo ObjectId).' })
  photo(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<FacialAccessPhotoUrlDto> {
    const { companyId, clientId } = requireClientTenant(user);
    return this.accessesService.getPhotoUrl(id, companyId, clientId);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar acessos faciais da unidade atual',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ClientAccessesListQueryDto,
  ): Promise<ClientAccessListResponse> {
    const { companyId, clientId } = requireClientTenant(user);
    return this.accessesService.listForClient(companyId, clientId, {
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page,
    });
  }
}
