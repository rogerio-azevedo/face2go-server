import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AccessesService } from './accesses.service';

@ApiTags('accesses')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('accesses')
export class AccessesController {
  constructor(private readonly accessesService: AccessesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar acessos faciais (MongoDB), por empresa' })
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

    return this.accessesService.listForCompany(companyId, {
      clientId: clientId?.trim() || undefined,
      startDate: startDate?.trim() || undefined,
      endDate: endDate?.trim() || undefined,
      page,
    });
  }
}
