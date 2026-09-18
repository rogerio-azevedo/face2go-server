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
  type ClientLprAccessListResponse,
  type LprAccessPhotoUrlsDto,
  LprAccessesService,
} from './lpr-accesses.service';

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

@ApiTags('client-lpr-accesses')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/lpr-accesses')
export class ClientLprAccessesController {
  constructor(private readonly lprAccessesService: LprAccessesService) {}

  @Get(':id/photo')
  @ApiOperation({
    summary:
      'Obter URLs assinadas (GET) das fotos ANPR de um acesso da unidade atual',
  })
  @ApiParam({ name: 'id', description: 'ID do documento (Mongo ObjectId).' })
  photos(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<LprAccessPhotoUrlsDto> {
    const { companyId, clientId } = requireClientTenant(user);
    return this.lprAccessesService.getPhotoUrls(id, companyId, clientId);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar acessos LPR ANPR da unidade atual',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ClientAccessesListQueryDto,
  ): Promise<ClientLprAccessListResponse> {
    const { companyId, clientId } = requireClientTenant(user);
    return this.lprAccessesService.listForClient(companyId, clientId, {
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page,
    });
  }
}
