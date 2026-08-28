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
  EnrollmentReportQueryDto,
  EnrollmentSummaryDto,
} from '../validation/dto/reports.dto';
import { ReportsService } from './reports.service';

@ApiTags('client-reports')
@ApiBearerAuth()
@Roles('client_admin', 'client_operator')
@Controller('client/reports')
export class ClientReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('enrollment/summary')
  @ApiOperation({
    summary: 'Resumo de cadastro (face/veículo) da unidade atual',
  })
  @ApiOkResponse({ type: EnrollmentSummaryDto })
  summary(
    @CurrentUser() user: JwtPayload,
    @Query() query: EnrollmentReportQueryDto,
  ) {
    return this.reportsService.getSummary(user, query);
  }

  @Get('enrollment/list')
  @ApiOperation({
    summary: 'Lista paginada de cadastro (face/veículo) da unidade atual',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: EnrollmentReportQueryDto,
  ) {
    return this.reportsService.getList(user, query);
  }

  @Get('enrollment/export')
  @ApiOperation({ summary: 'Exportar relatório de cadastro em CSV' })
  @ApiProduces('text/csv')
  export(
    @CurrentUser() user: JwtPayload,
    @Query() query: EnrollmentReportQueryDto,
  ) {
    return this.reportsService.exportCsv(user, query);
  }
}
