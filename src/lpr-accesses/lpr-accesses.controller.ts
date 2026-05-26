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
import {
  type LprAccessPhotoUrlsDto,
  LprAccessesService,
} from './lpr-accesses.service';

@ApiTags('lpr-accesses')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('lpr-accesses')
export class LprAccessesController {
  constructor(private readonly lprAccessesService: LprAccessesService) {}

  @Get(':id/photo')
  @ApiOperation({
    summary:
      'Obter URLs assinadas (GET) das fotos ANPR armazenadas no R2 para um acesso',
  })
  @ApiParam({ name: 'id', description: 'ID do documento (Mongo ObjectId).' })
  photos(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<LprAccessPhotoUrlsDto> {
    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não associada ao usuário.');
    }
    return this.lprAccessesService.getPhotoUrls(id, companyId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar acessos LPR ANPR (MongoDB), por empresa' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query('clientId') clientId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') pageStr?: string,
  ) {
    const companyId = user.companyId;
    if (!companyId) {
      throw new ForbiddenException('Empresa não associada ao usuário.');
    }

    const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);

    return this.lprAccessesService.listForCompany(companyId, {
      clientId: clientId?.trim() || undefined,
      startDate: startDate?.trim() || undefined,
      endDate: endDate?.trim() || undefined,
      page,
    });
  }
}
