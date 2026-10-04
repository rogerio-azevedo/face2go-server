import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  BindLocationGroupsDto,
  EnsureLocationUnitDto,
  MoveLocationGroupsDto,
} from '../validation/dto/client-blocks.dto';
import { LocationReviewService } from './location-review.service';

@ApiTags('client-blocks')
@ApiBearerAuth()
@Roles('company_admin')
@Controller('condominiums/location-review')
export class LocationReviewController {
  constructor(private readonly locationReview: LocationReviewService) {}

  @Get('clients/:clientId')
  @ApiOperation({
    summary: 'Pessoas agrupadas por texto (sem vínculo) e por unidade atual',
  })
  getClientReview(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ) {
    return this.locationReview.getClientReview(user, clientId);
  }

  @Post('clients/:clientId/ensure-unit')
  @ApiOperation({ summary: 'Usar ou criar bloco e unidade pelo nome' })
  ensureUnit(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: EnsureLocationUnitDto,
  ) {
    return this.locationReview.ensureUnit(user, clientId, dto);
  }

  @Post('clients/:clientId/bind')
  @ApiOperation({
    summary: 'Vincular grupos de texto a unidades do catálogo',
  })
  bind(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: BindLocationGroupsDto,
  ) {
    return this.locationReview.bindGroups(user, clientId, dto.items);
  }

  @Post('clients/:clientId/move')
  @ApiOperation({
    summary: 'Mover as pessoas de uma unidade para outra ou desvinculá-las',
  })
  move(
    @CurrentUser() user: JwtPayload,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body() dto: MoveLocationGroupsDto,
  ) {
    return this.locationReview.moveGroups(user, clientId, dto.items);
  }
}
