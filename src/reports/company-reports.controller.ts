import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  CompanyEnrollmentReportQueryDto,
  EnrollmentSummaryDto,
} from '../validation/dto/reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Roles('company_admin', 'company_operator')
@Controller('reports')
export class CompanyReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('enrollment/summary')
  @ApiOperation({
    summary: 'Resumo de cadastro (face/veículo) de um cliente',
  })
  @ApiOkResponse({ type: EnrollmentSummaryDto })
  summary(
    @CurrentUser() user: JwtPayload,
    @Query() query: CompanyEnrollmentReportQueryDto,
  ) {
    return this.reportsService.getSummary(user, query);
  }

  @Get('enrollment/list')
  @ApiOperation({
    summary: 'Lista paginada de cadastro (face/veículo) de um cliente',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: CompanyEnrollmentReportQueryDto,
  ) {
    return this.reportsService.getList(user, query);
  }

  @Get('enrollment/export')
  @ApiOperation({ summary: 'Exportar relatório de cadastro em CSV' })
  @ApiProduces('text/csv')
  export(
    @CurrentUser() user: JwtPayload,
    @Query() query: CompanyEnrollmentReportQueryDto,
  ) {
    return this.reportsService.exportCsv(user, query);
  }
}
