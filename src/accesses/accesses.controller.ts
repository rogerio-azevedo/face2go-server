import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CompanyAccessesListQueryDto } from '../validation/dto/accesses.dto';
import {
  AccessesService,
  type FacialAccessPhotoUrlDto,
} from './accesses.service';

@ApiTags('accesses')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('accesses')
export class AccessesController {
  constructor(private readonly accessesService: AccessesService) {}

  @Get(':id/photo')
  @ApiOperation({
    summary:
      'Obter URL assinada (GET) da foto facial armazenada no R2 para um acesso',
  })
  @ApiParam({ name: 'id', description: 'ID do documento (Mongo ObjectId).' })
  photo(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<FacialAccessPhotoUrlDto> {
    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não associada ao usuário.');
    }
    return this.accessesService.getPhotoUrl(id, companyId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar acessos faciais (MongoDB), por empresa' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: CompanyAccessesListQueryDto,
  ) {
    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não associada ao usuário.');
    }

    return this.accessesService.listForCompany(companyId, {
      clientId: query.clientId,
      startDate: query.startDate,
      endDate: query.endDate,
      page: query.page,
      name: query.name,
      block: query.block,
      unit: query.unit,
      readerId: query.readerId,
    });
  }
}
